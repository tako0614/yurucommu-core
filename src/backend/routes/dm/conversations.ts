// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { PrismaClient } from '../../../generated/prisma';
import type { Env, Variables } from '../../types';
import { formatUsername, safeJsonParse } from '../../utils';
import { getConversationId, resolveConversationId } from './utils';

type HonoEnv = { Bindings: Env; Variables: Variables };
type ActorInfo = { preferredUsername: string | null; name: string | null; iconUrl: string | null };

const ACTOR_INFO_SELECT = {
  apId: true,
  preferredUsername: true,
  name: true,
  iconUrl: true,
} as const;

/** Fetch actor info from local actors (preferred) with cache fallback, keyed by apId. */
async function buildActorInfoMap(
  prisma: PrismaClient,
  apIds: string[],
): Promise<Map<string, ActorInfo>> {
  if (apIds.length === 0) return new Map();

  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({ where: { apId: { in: apIds } }, select: ACTOR_INFO_SELECT }),
    prisma.actorCache.findMany({ where: { apId: { in: apIds } }, select: ACTOR_INFO_SELECT }),
  ]);

  const map = new Map<string, ActorInfo>();
  for (const a of cachedActors) map.set(a.apId, a);
  for (const a of localActors) map.set(a.apId, a); // local takes precedence
  return map;
}

/** Extract the other participant's AP ID from a DM object. */
function getOtherParticipant(obj: { attributedTo: string; toJson: string }, actorApId: string): string {
  if (obj.attributedTo === actorApId) {
    return safeJsonParse<string[]>(obj.toJson, [])[0] || '';
  }
  return obj.attributedTo;
}

/** Prisma where clause for DM objects involving a given actor. */
function dmWhereForActor(actorApId: string, actorApIdJson: string) {
  return {
    visibility: 'direct' as const,
    type: 'Note' as const,
    conversation: { not: null } as const,
    OR: [
      { attributedTo: actorApId },
      { toJson: { contains: actorApIdJson } },
    ],
  };
}

/** Sort comparator: descending by time string, with fallback. */
function byTimeDesc(a: string | null, b: string | null): number {
  return (b || '').localeCompare(a || '');
}

const dm = new Hono<HonoEnv>();

dm.get('/contacts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');
  const actorApIdJson = JSON.stringify(actor.ap_id);
  const dmWhere = dmWhereForActor(actor.ap_id, actorApIdJson);

  // Clean up orphaned read status entries for conversations that no longer exist
  const validConversations = await prisma.object.findMany({
    where: dmWhere,
    select: { conversation: true },
    distinct: ['conversation'],
  });

  const validConversationIds = validConversations
    .map((c) => c.conversation)
    .filter((c): c is string => c !== null);

  // Delete orphaned read status entries
  await prisma.dmReadStatus.deleteMany({
    where: {
      actorApId: actor.ap_id,
      ...(validConversationIds.length > 0
        ? { conversationId: { notIn: validConversationIds } }
        : {}),
    },
  });

  // Get archived conversation IDs to exclude
  const archivedConversations = await prisma.dmArchivedConversation.findMany({
    where: { actorApId: actor.ap_id },
    select: { conversationId: true },
  });
  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));

  // Get DM conversations for this actor with limit to prevent DoS
  const dmObjects = await prisma.object.findMany({
    where: dmWhere,
    orderBy: { published: 'desc' },
    select: {
      conversation: true,
      attributedTo: true,
      toJson: true,
      published: true,
      content: true,
    },
    take: 2000,
  });

  // Group by conversation and get other participant (first = most recent per conversation)
  const conversationMap = new Map<string, {
    conversation: string;
    otherApId: string;
    lastMessageAt: string;
    lastContent: string | null;
    lastSender: string;
  }>();

  for (const obj of dmObjects) {
    if (!obj.conversation || archivedSet.has(obj.conversation) || conversationMap.has(obj.conversation)) continue;

    const otherApId = getOtherParticipant(obj, actor.ap_id);
    if (!otherApId) continue;

    conversationMap.set(obj.conversation, {
      conversation: obj.conversation,
      otherApId,
      lastMessageAt: obj.published,
      lastContent: obj.content,
      lastSender: obj.attributedTo,
    });
  }

  // Get read status for all conversations
  const readStatuses = await prisma.dmReadStatus.findMany({
    where: { actorApId: actor.ap_id },
  });
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

    // For each group with the same lastReadAt, batch query unread counts
    await Promise.all(
      Array.from(lastReadAtMap.entries()).map(async ([lastReadAt, convIds]) => {
        const unreadMessages = await prisma.object.groupBy({
          by: ['conversation'],
          where: {
            conversation: { in: convIds },
            visibility: 'direct',
            attributedTo: { not: actor.ap_id },
            published: { gt: lastReadAt },
          },
          _count: { apId: true },
        });

        for (const msg of unreadMessages) {
          if (msg.conversation) {
            unreadCounts.set(msg.conversation, msg._count.apId);
          }
        }
      }),
    );
  }

  // Get actor info for all other participants
  const otherApIds = [...new Set(Array.from(conversationMap.values()).map((c) => c.otherApId))];
  const actorInfoMap = await buildActorInfoMap(prisma, otherApIds);

  // Build contacts result
  const contactsResult = Array.from(conversationMap.values())
    .map((conv) => {
      const actorInfo = actorInfoMap.get(conv.otherApId);
      return {
        type: 'user' as const,
        ap_id: conv.otherApId,
        username: formatUsername(conv.otherApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null,
        conversation_id: conv.conversation,
        last_message: conv.lastContent ? {
          content: conv.lastContent,
          is_mine: conv.lastSender === actor.ap_id,
        } : null,
        last_message_at: conv.lastMessageAt,
        unread_count: unreadCounts.get(conv.conversation) || 0,
      };
    })
    .sort((a, b) => byTimeDesc(a.last_message_at, b.last_message_at));

  // Get communities the user is a member of (for group chat)
  const communityMemberships = await prisma.communityMember.findMany({
    where: { actorApId: actor.ap_id },
    include: {
      community: {
        select: {
          apId: true,
          preferredUsername: true,
          name: true,
          iconUrl: true,
          memberCount: true,
        },
      },
    },
  });

  // Batch get last messages for all communities to avoid N+1
  const communityApIds = communityMemberships.map((cm) => cm.community.apId);
  const lastMessagesMap = new Map<string, { content: string; attributedTo: string; published: string }>();

  if (communityApIds.length > 0) {
    const recentMessages = await prisma.object.findMany({
      where: { communityApId: { in: communityApIds } },
      orderBy: { published: 'desc' },
      select: { communityApId: true, content: true, attributedTo: true, published: true },
      take: communityApIds.length * 10,
    });

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

  // Map communities to result format
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
  const incomingDMs = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      toJson: { contains: actorApIdJson },
    },
    select: { conversation: true },
    distinct: ['conversation'],
  });

  const incomingConversations = incomingDMs
    .map((dm) => dm.conversation)
    .filter((c): c is string => c !== null);

  const ourReplies = incomingConversations.length > 0
    ? await prisma.object.findMany({
        where: {
          conversation: { in: incomingConversations },
          attributedTo: actor.ap_id,
        },
        select: { conversation: true },
        distinct: ['conversation'],
      })
    : [];

  const repliedConversations = new Set(ourReplies.map((r) => r.conversation));
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
  const prisma = c.get('prisma');
  const actorApIdJson = JSON.stringify(actor.ap_id);

  const incomingDMs = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      toJson: { contains: actorApIdJson },
    },
    orderBy: { published: 'desc' },
    select: {
      apId: true,
      attributedTo: true,
      content: true,
      published: true,
      conversation: true,
    },
    take: 1000,
  });

  // Batch get all conversations where we've replied to avoid N+1
  const allConversations = [...new Set(
    incomingDMs.map((dm) => dm.conversation).filter((c): c is string => c !== null),
  )];
  const ourRepliesInConversations = allConversations.length > 0
    ? await prisma.object.findMany({
        where: {
          conversation: { in: allConversations },
          attributedTo: actor.ap_id,
        },
        select: { conversation: true },
        distinct: ['conversation'],
      })
    : [];

  const repliedConversationsSet = new Set(ourRepliesInConversations.map((r) => r.conversation));

  // Filter to only unreplied conversations (one per conversation, most recent first)
  const seenConversations = new Set<string>();
  const requests = incomingDMs.reduce<Array<{
    id: string;
    senderApId: string;
    content: string;
    createdAt: string;
    conversation: string | null;
  }>>((acc, dm) => {
    if (!dm.conversation || seenConversations.has(dm.conversation)) return acc;
    if (repliedConversationsSet.has(dm.conversation)) return acc;

    seenConversations.add(dm.conversation);
    acc.push({
      id: dm.apId,
      senderApId: dm.attributedTo,
      content: dm.content,
      createdAt: dm.published,
      conversation: dm.conversation,
    });
    return acc;
  }, []);

  // Get sender info
  const senderApIds = [...new Set(requests.map((r) => r.senderApId))];
  const actorInfoMap = await buildActorInfoMap(prisma, senderApIds);

  const result = requests.map((r) => {
    const actorInfo = actorInfoMap.get(r.senderApId);
    return {
      id: r.id,
      sender: {
        ap_id: r.senderApId,
        username: formatUsername(r.senderApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null,
      },
      content: r.content,
      created_at: r.createdAt,
      conversation: r.conversation,
    };
  });

  return c.json({ requests: result });
});

// Accept request = just reply to the message (creates conversation)
// No separate accept action needed in AP model

// Reject request = delete messages from a sender and optionally block
dm.post('/requests/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const body = await c.req.json<{ sender_ap_id: string; block?: boolean }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.sender_ap_id);

  // Get message IDs to delete
  const messagesToDelete = await prisma.object.findMany({
    where: {
      conversation: conversationId,
      attributedTo: body.sender_ap_id,
    },
    select: { apId: true },
  });

  const messageApIds = messagesToDelete.map((m) => m.apId);

  if (messageApIds.length > 0) {
    await prisma.objectRecipient.deleteMany({
      where: { objectApId: { in: messageApIds } },
    });
  }

  // Delete all messages in this conversation from the sender
  await prisma.object.deleteMany({
    where: {
      conversation: conversationId,
      visibility: 'direct',
      attributedTo: body.sender_ap_id,
    },
  });

  // Optionally block the sender
  if (body.block) {
    await prisma.block.upsert({
      where: {
        blockerApId_blockedApId: {
          blockerApId: actor.ap_id,
          blockedApId: body.sender_ap_id,
        },
      },
      update: {},
      create: {
        blockerApId: actor.ap_id,
        blockedApId: body.sender_ap_id,
      },
    });
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

  // In the AP model, accepting just means we allow the conversation
  // The actual acceptance is implicit when we send a reply
  return c.json({ success: true, message: 'Reply to the conversation to accept' });
});

// Get messages with a specific user

dm.get('/conversations', async (c) => {
  return c.redirect('/api/dm/contacts');
});

dm.post('/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const body = await c.req.json<{ participant_ap_id: string }>();
  if (!body.participant_ap_id) {
    return c.json({ error: 'participant_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.participant_ap_id);

  // Get other participant info (try local actors first, then cache)
  const localActor = await prisma.actor.findUnique({
    where: { apId: body.participant_ap_id },
    select: ACTOR_INFO_SELECT,
  });

  const cachedActor = localActor ? null : await prisma.actorCache.findUnique({
    where: { apId: body.participant_ap_id },
    select: ACTOR_INFO_SELECT,
  });

  const otherInfo = localActor || cachedActor;
  if (!otherInfo) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  return c.json({
    conversation: {
      id: conversationId,
      other_participant: {
        ap_id: body.participant_ap_id,
        username: formatUsername(body.participant_ap_id),
        preferred_username: otherInfo.preferredUsername,
        name: otherInfo.name,
        icon_url: otherInfo.iconUrl,
      },
      last_message_at: null,
      created_at: new Date().toISOString(),
    },
  });
});


dm.post('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const now = new Date().toISOString();
  await prisma.dmTyping.upsert({
    where: {
      actorApId_recipientApId: {
        actorApId: actor.ap_id,
        recipientApId: otherApId,
      },
    },
    update: { lastTypedAt: now },
    create: {
      actorApId: actor.ap_id,
      recipientApId: otherApId,
      lastTypedAt: now,
    },
  });

  return c.json({ success: true, typed_at: now });
});

dm.get('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const typingKey = {
    actorApId_recipientApId: {
      actorApId: otherApId,
      recipientApId: actor.ap_id,
    },
  };

  const typing = await prisma.dmTyping.findUnique({
    where: typingKey,
    select: { lastTypedAt: true },
  });

  if (!typing?.lastTypedAt) {
    return c.json({ is_typing: false, last_typed_at: null });
  }

  const lastTypedMs = Date.parse(typing.lastTypedAt);
  const elapsedMs = Date.now() - lastTypedMs;
  const isValid = Number.isFinite(lastTypedMs);
  const isTyping = isValid && elapsedMs <= 8000;
  const isExpired = !isValid || elapsedMs > 5 * 60 * 1000;

  if (isExpired) {
    await prisma.dmTyping.delete({ where: typingKey });
    return c.json({ is_typing: false, last_typed_at: null });
  }

  return c.json({ is_typing: isTyping, last_typed_at: typing.lastTypedAt });
});

// Mark conversation as read
dm.post('/user/:encodedApId/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = await resolveConversationId(prisma, baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await prisma.dmReadStatus.upsert({
    where: {
      actorApId_conversationId: {
        actorApId: actor.ap_id,
        conversationId,
      },
    },
    update: { lastReadAt: now },
    create: {
      actorApId: actor.ap_id,
      conversationId,
      lastReadAt: now,
    },
  });

  return c.json({ success: true, last_read_at: now });
});

// Archive a conversation (hide from inbox)
dm.post('/user/:encodedApId/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await prisma.dmArchivedConversation.upsert({
    where: {
      actorApId_conversationId: {
        actorApId: actor.ap_id,
        conversationId,
      },
    },
    update: {},
    create: {
      actorApId: actor.ap_id,
      conversationId,
      archivedAt: now,
    },
  });

  return c.json({ success: true, archived_at: now });
});

// Unarchive a conversation
dm.delete('/user/:encodedApId/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  await prisma.dmArchivedConversation.deleteMany({
    where: {
      actorApId: actor.ap_id,
      conversationId,
    },
  });

  return c.json({ success: true });
});

// Get archived conversations
dm.get('/archived', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');
  const actorApIdJson = JSON.stringify(actor.ap_id);

  const archivedConversations = await prisma.dmArchivedConversation.findMany({
    where: { actorApId: actor.ap_id },
    select: { conversationId: true, archivedAt: true },
  });

  if (archivedConversations.length === 0) {
    return c.json({ archived: [] });
  }

  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));

  const dmObjects = await prisma.object.findMany({
    where: dmWhereForActor(actor.ap_id, actorApIdJson),
    orderBy: { published: 'desc' },
    select: {
      conversation: true,
      attributedTo: true,
      toJson: true,
      published: true,
    },
    take: 2000,
  });

  // Group by conversation and get other participant (only archived ones)
  const conversationMap = new Map<string, {
    conversation: string;
    otherApId: string;
    lastMessageAt: string;
  }>();

  for (const obj of dmObjects) {
    if (!obj.conversation || !archivedSet.has(obj.conversation) || conversationMap.has(obj.conversation)) continue;

    const otherApId = getOtherParticipant(obj, actor.ap_id);
    if (!otherApId) continue;

    conversationMap.set(obj.conversation, {
      conversation: obj.conversation,
      otherApId,
      lastMessageAt: obj.published,
    });
  }

  // Get actor info for all other participants
  const otherApIds = [...new Set(Array.from(conversationMap.values()).map((c) => c.otherApId))];
  const actorInfoMap = await buildActorInfoMap(prisma, otherApIds);

  const archived = Array.from(conversationMap.values())
    .map((conv) => {
      const actorInfo = actorInfoMap.get(conv.otherApId);
      return {
        ap_id: conv.otherApId,
        username: formatUsername(conv.otherApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null,
        conversation_id: conv.conversation,
        last_message_at: conv.lastMessageAt,
      };
    })
    .sort((a, b) => byTimeDesc(a.last_message_at, b.last_message_at));

  return c.json({ archived });
});

export default dm;
