// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import { eq, and, ne, desc, like, inArray, notInArray, count, sql } from 'drizzle-orm';
import { actors, actorCache, objects, objectRecipients, dmTyping, dmReadStatus, dmArchivedConversations, blocks, communityMembers, communities } from '../../../db';
import { formatUsername } from '../../utils';
import { getConversationId, resolveConversationId } from './utils';
import {
  type HonoEnv,
  ACTOR_INFO_FIELDS,
  ACTOR_CACHE_INFO_FIELDS,
  buildActorInfoMap,
  formatActorProfile,
  dmWhereForActor,
  byTimeDesc,
  parseOtherApId,
  groupConversations,
  findRepliedConversations,
  uniqueValues,
} from './conversations-helpers';

// -- Routes --

const dm = new Hono<HonoEnv>();

dm.get('/contacts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');
  const actorApIdJson = JSON.stringify(actor.ap_id);
  const dmWhere = dmWhereForActor(actor.ap_id, actorApIdJson);

  // Clean up orphaned read status entries for conversations that no longer exist
  const validConversations = await db.selectDistinct({ conversation: objects.conversation })
    .from(objects)
    .where(dmWhere!);

  const validConversationIds = validConversations
    .map((c) => c.conversation)
    .filter((c): c is string => c !== null);

  if (validConversationIds.length > 0) {
    await db.delete(dmReadStatus).where(
      and(
        eq(dmReadStatus.actorApId, actor.ap_id),
        notInArray(dmReadStatus.conversationId, validConversationIds),
      ),
    );
  } else {
    await db.delete(dmReadStatus).where(eq(dmReadStatus.actorApId, actor.ap_id));
  }

  // Get archived conversation IDs to exclude
  const archivedConversations = await db.select({ conversationId: dmArchivedConversations.conversationId })
    .from(dmArchivedConversations)
    .where(eq(dmArchivedConversations.actorApId, actor.ap_id));
  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));

  // Get DM conversations for this actor with limit to prevent DoS
  const dmObjects = await db.select({
    conversation: objects.conversation,
    attributedTo: objects.attributedTo,
    toJson: objects.toJson,
    published: objects.published,
    content: objects.content,
  })
    .from(objects)
    .where(dmWhere!)
    .orderBy(desc(objects.published))
    .limit(2000);

  const conversationMap = groupConversations(
    dmObjects,
    actor.ap_id,
    (id) => !archivedSet.has(id),
  );

  // Get read status for all conversations
  const readStatuses = await db.select()
    .from(dmReadStatus)
    .where(eq(dmReadStatus.actorApId, actor.ap_id));
  const readStatusMap = new Map(readStatuses.map((r) => [r.conversationId, r.lastReadAt]));

  // Calculate unread counts for each conversation using batch query
  const conversationIds = Array.from(conversationMap.keys());
  const unreadCounts = new Map<string, number>();

  if (conversationIds.length > 0) {
    // Group conversations by their lastReadAt time for efficient querying
    const lastReadAtMap = new Map<string, string[]>();
    for (const convId of conversationIds) {
      const lastReadAt = readStatusMap.get(convId) || '1970-01-01T00:00:00Z';
      const convIds = lastReadAtMap.get(lastReadAt) || [];
      convIds.push(convId);
      lastReadAtMap.set(lastReadAt, convIds);
    }

    await Promise.all(
      Array.from(lastReadAtMap.entries()).map(async ([lastReadAt, convIds]) => {
        const unreadMessages = await db.select({
          conversation: objects.conversation,
          count: count(),
        })
          .from(objects)
          .where(
            and(
              inArray(objects.conversation, convIds),
              eq(objects.visibility, 'direct'),
              ne(objects.attributedTo, actor.ap_id),
              sql`${objects.published} > ${lastReadAt}`,
            ),
          )
          .groupBy(objects.conversation);

        for (const msg of unreadMessages) {
          if (msg.conversation) {
            unreadCounts.set(msg.conversation, msg.count);
          }
        }
      }),
    );
  }

  const otherApIds = uniqueValues(conversationMap, (c) => c.otherApId);
  const actorInfoMap = await buildActorInfoMap(db, otherApIds);

  const contactsResult = Array.from(conversationMap.values())
    .map((conv) => ({
      type: 'user' as const,
      ...formatActorProfile(conv.otherApId, actorInfoMap.get(conv.otherApId)),
      conversation_id: conv.conversation,
      last_message: conv.lastContent ? {
        content: conv.lastContent,
        is_mine: conv.lastSender === actor.ap_id,
      } : null,
      last_message_at: conv.lastMessageAt,
      unread_count: unreadCounts.get(conv.conversation) || 0,
    }))
    .sort((a, b) => byTimeDesc(a.last_message_at, b.last_message_at));

  // Get communities the user is a member of (for group chat)
  const communityMemberships = await db.select({
    communityApId: communityMembers.communityApId,
    community: {
      apId: communities.apId,
      preferredUsername: communities.preferredUsername,
      name: communities.name,
      iconUrl: communities.iconUrl,
      memberCount: communities.memberCount,
    },
  })
    .from(communityMembers)
    .innerJoin(communities, eq(communityMembers.communityApId, communities.apId))
    .where(eq(communityMembers.actorApId, actor.ap_id));

  // Batch get last messages for all communities to avoid N+1
  const communityApIds = communityMemberships.map((cm) => cm.community.apId);
  const lastMessagesMap = new Map<string, { content: string; attributedTo: string; published: string }>();

  if (communityApIds.length > 0) {
    const recentMessages = await db.select({
      communityApId: objects.communityApId,
      content: objects.content,
      attributedTo: objects.attributedTo,
      published: objects.published,
    })
      .from(objects)
      .where(inArray(objects.communityApId, communityApIds))
      .orderBy(desc(objects.published))
      .limit(communityApIds.length * 10);

    for (const msg of recentMessages) {
      if (msg.communityApId && !lastMessagesMap.has(msg.communityApId)) {
        lastMessagesMap.set(msg.communityApId, {
          content: msg.content,
          attributedTo: msg.attributedTo,
          published: msg.published,
        });
      }
    }
  }

  const communitiesResult = communityMemberships
    .map((cm) => {
      const lastMessage = lastMessagesMap.get(cm.community.apId);
      return {
        type: 'community' as const,
        ap_id: cm.community.apId,
        username: formatUsername(cm.community.apId),
        preferred_username: cm.community.preferredUsername,
        name: cm.community.name,
        icon_url: cm.community.iconUrl,
        member_count: cm.community.memberCount,
        last_message: lastMessage?.content ? {
          content: lastMessage.content,
          is_mine: lastMessage.attributedTo === actor.ap_id,
        } : null,
        last_message_at: lastMessage?.published || null,
      };
    })
    .sort((a, b) =>
      byTimeDesc(a.last_message_at, b.last_message_at) || a.name.localeCompare(b.name),
    );

  // Count pending requests: DMs from people we haven't replied to
  const incomingDMs = await db.selectDistinct({ conversation: objects.conversation })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, 'direct'),
        eq(objects.type, 'Note'),
        like(objects.toJson, `%${actorApIdJson}%`),
      ),
    );

  const incomingConversations = incomingDMs
    .map((dm) => dm.conversation)
    .filter((c): c is string => c !== null);

  const repliedConversations = await findRepliedConversations(db, incomingConversations, actor.ap_id);
  const requestCount = incomingConversations.filter((c) => !repliedConversations.has(c)).length;

  return c.json({
    mutual_followers: contactsResult,
    communities: communitiesResult,
    request_count: requestCount,
  });
});

// Get message requests (DMs from people we haven't replied to)
dm.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');
  const actorApIdJson = JSON.stringify(actor.ap_id);

  const incomingDMs = await db.select({
    apId: objects.apId,
    attributedTo: objects.attributedTo,
    content: objects.content,
    published: objects.published,
    conversation: objects.conversation,
  })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, 'direct'),
        eq(objects.type, 'Note'),
        like(objects.toJson, `%${actorApIdJson}%`),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(1000);

  const allConversations = [...new Set(
    incomingDMs.map((dm) => dm.conversation).filter((c): c is string => c !== null),
  )];
  const repliedConversationsSet = await findRepliedConversations(db, allConversations, actor.ap_id);

  // Filter to only unreplied conversations (one per conversation, most recent first)
  const seenConversations = new Set<string>();
  const requests: Array<{
    id: string;
    senderApId: string;
    content: string;
    createdAt: string;
    conversation: string | null;
  }> = [];

  for (const dm of incomingDMs) {
    if (!dm.conversation || seenConversations.has(dm.conversation)) continue;
    if (repliedConversationsSet.has(dm.conversation)) continue;

    seenConversations.add(dm.conversation);
    requests.push({
      id: dm.apId,
      senderApId: dm.attributedTo,
      content: dm.content,
      createdAt: dm.published,
      conversation: dm.conversation,
    });
  }

  const senderApIds = [...new Set(requests.map((r) => r.senderApId))];
  const actorInfoMap = await buildActorInfoMap(db, senderApIds);

  const result = requests.map((r) => ({
    id: r.id,
    sender: formatActorProfile(r.senderApId, actorInfoMap.get(r.senderApId)),
    content: r.content,
    created_at: r.createdAt,
    conversation: r.conversation,
  }));

  return c.json({ requests: result });
});

// Accept request = just reply to the message (creates conversation)
// No separate accept action needed in AP model

// Reject request = delete messages from a sender and optionally block
dm.post('/requests/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const body = await c.req.json<{ sender_ap_id: string; block?: boolean }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.sender_ap_id);

  const messagesToDelete = await db.select({ apId: objects.apId })
    .from(objects)
    .where(
      and(
        eq(objects.conversation, conversationId),
        eq(objects.attributedTo, body.sender_ap_id),
      ),
    );

  const messageApIds = messagesToDelete.map((m) => m.apId);

  if (messageApIds.length > 0) {
    await db.delete(objectRecipients).where(inArray(objectRecipients.objectApId, messageApIds));
  }

  await db.delete(objects).where(
    and(
      eq(objects.conversation, conversationId),
      eq(objects.visibility, 'direct'),
      eq(objects.attributedTo, body.sender_ap_id),
    ),
  );

  if (body.block) {
    await db.insert(blocks)
      .values({
        blockerApId: actor.ap_id,
        blockedApId: body.sender_ap_id,
      })
      .onConflictDoNothing();
  }

  return c.json({ success: true });
});

// Accept request = reply and mark as accepted (alternative to just sending a message)
dm.post('/requests/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ sender_ap_id: string }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  return c.json({ success: true, message: 'Reply to the conversation to accept' });
});

dm.get('/conversations', async (c) => {
  return c.redirect('/api/dm/contacts');
});

dm.post('/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const body = await c.req.json<{ participant_ap_id: string }>();
  if (!body.participant_ap_id) {
    return c.json({ error: 'participant_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.participant_ap_id);

  const localActor = await db.select(ACTOR_INFO_FIELDS)
    .from(actors)
    .where(eq(actors.apId, body.participant_ap_id))
    .get();

  const cachedActor = localActor ? null : await db.select(ACTOR_CACHE_INFO_FIELDS)
    .from(actorCache)
    .where(eq(actorCache.apId, body.participant_ap_id))
    .get();

  const otherInfo = localActor || cachedActor;
  if (!otherInfo) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  return c.json({
    conversation: {
      id: conversationId,
      other_participant: formatActorProfile(body.participant_ap_id, otherInfo),
      last_message_at: null,
      created_at: new Date().toISOString(),
    },
  });
});


dm.post('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const now = new Date().toISOString();
  await db.insert(dmTyping)
    .values({
      actorApId: actor.ap_id,
      recipientApId: otherApId,
      lastTypedAt: now,
    })
    .onConflictDoUpdate({
      target: [dmTyping.actorApId, dmTyping.recipientApId],
      set: { lastTypedAt: now },
    });

  return c.json({ success: true, typed_at: now });
});

dm.get('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const typing = await db.select({ lastTypedAt: dmTyping.lastTypedAt })
    .from(dmTyping)
    .where(
      and(
        eq(dmTyping.actorApId, otherApId),
        eq(dmTyping.recipientApId, actor.ap_id),
      ),
    )
    .get();

  if (!typing?.lastTypedAt) {
    return c.json({ is_typing: false, last_typed_at: null });
  }

  const lastTypedMs = Date.parse(typing.lastTypedAt);
  const elapsedMs = Date.now() - lastTypedMs;
  const isValid = Number.isFinite(lastTypedMs);
  const isTyping = isValid && elapsedMs <= 8000;
  const isExpired = !isValid || elapsedMs > 5 * 60 * 1000;

  if (isExpired) {
    await db.delete(dmTyping).where(
      and(
        eq(dmTyping.actorApId, otherApId),
        eq(dmTyping.recipientApId, actor.ap_id),
      ),
    );
    return c.json({ is_typing: false, last_typed_at: null });
  }

  return c.json({ is_typing: isTyping, last_typed_at: typing.lastTypedAt });
});

// Mark conversation as read
dm.post('/user/:encodedApId/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = await resolveConversationId(db, baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await db.insert(dmReadStatus)
    .values({
      actorApId: actor.ap_id,
      conversationId,
      lastReadAt: now,
    })
    .onConflictDoUpdate({
      target: [dmReadStatus.actorApId, dmReadStatus.conversationId],
      set: { lastReadAt: now },
    });

  return c.json({ success: true, last_read_at: now });
});

// Archive a conversation (hide from inbox)
dm.post('/user/:encodedApId/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await db.insert(dmArchivedConversations)
    .values({
      actorApId: actor.ap_id,
      conversationId,
      archivedAt: now,
    })
    .onConflictDoNothing();

  return c.json({ success: true, archived_at: now });
});

// Unarchive a conversation
dm.delete('/user/:encodedApId/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  await db.delete(dmArchivedConversations).where(
    and(
      eq(dmArchivedConversations.actorApId, actor.ap_id),
      eq(dmArchivedConversations.conversationId, conversationId),
    ),
  );

  return c.json({ success: true });
});

// Get archived conversations
dm.get('/archived', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('prisma');
  const actorApIdJson = JSON.stringify(actor.ap_id);

  const archivedConversations = await db.select({
    conversationId: dmArchivedConversations.conversationId,
    archivedAt: dmArchivedConversations.archivedAt,
  })
    .from(dmArchivedConversations)
    .where(eq(dmArchivedConversations.actorApId, actor.ap_id));

  if (archivedConversations.length === 0) {
    return c.json({ archived: [] });
  }

  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));

  const dmObjects = await db.select({
    conversation: objects.conversation,
    attributedTo: objects.attributedTo,
    toJson: objects.toJson,
    published: objects.published,
  })
    .from(objects)
    .where(dmWhereForActor(actor.ap_id, actorApIdJson)!)
    .orderBy(desc(objects.published))
    .limit(2000);

  const conversationMap = groupConversations(
    dmObjects,
    actor.ap_id,
    (id) => archivedSet.has(id),
  );

  const otherApIds = uniqueValues(conversationMap, (c) => c.otherApId);
  const actorInfoMap = await buildActorInfoMap(db, otherApIds);

  const archived = Array.from(conversationMap.values())
    .map((conv) => ({
      ...formatActorProfile(conv.otherApId, actorInfoMap.get(conv.otherApId)),
      conversation_id: conv.conversation,
      last_message_at: conv.lastMessageAt,
    }))
    .sort((a, b) => byTimeDesc(a.last_message_at, b.last_message_at));

  return c.json({ archived });
});

export default dm;
