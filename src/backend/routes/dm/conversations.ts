// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Context } from 'hono';
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

// ── Shared helpers ──────────────────────────────────────────────────

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

/** Build the standard actor profile shape used across all DM responses. */
function formatActorProfile(apId: string, info: ActorInfo | undefined) {
  return {
    ap_id: apId,
    username: formatUsername(apId),
    preferred_username: info?.preferredUsername || null,
    name: info?.name || null,
    icon_url: info?.iconUrl || null,
  };
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

/** Decode and validate the :encodedApId route param. Returns null on failure after sending 400. */
function parseOtherApId(c: Context<HonoEnv>): string | null {
  const apId = decodeURIComponent(c.req.param('encodedApId'));
  if (!apId) {
    c.status(400);
    return null;
  }
  return apId;
}

type DmObject = {
  conversation: string | null;
  attributedTo: string;
  toJson: string;
  published: string;
  content?: string | null;
};

/**
 * Group DM objects by conversation, keeping only the first (most recent) per conversation.
 * `filterFn` controls which conversations to include.
 */
function groupConversations(
  dmObjects: DmObject[],
  actorApId: string,
  filterFn: (conversationId: string) => boolean,
): Map<string, { conversation: string; otherApId: string; lastMessageAt: string; lastContent: string | null; lastSender: string }> {
  const map = new Map<string, { conversation: string; otherApId: string; lastMessageAt: string; lastContent: string | null; lastSender: string }>();

  for (const obj of dmObjects) {
    if (!obj.conversation || !filterFn(obj.conversation) || map.has(obj.conversation)) continue;

    const otherApId = getOtherParticipant(obj, actorApId);
    if (!otherApId) continue;

    map.set(obj.conversation, {
      conversation: obj.conversation,
      otherApId,
      lastMessageAt: obj.published,
      lastContent: obj.content ?? null,
      lastSender: obj.attributedTo,
    });
  }

  return map;
}

/** Find the set of conversation IDs where the actor has sent at least one message. */
async function findRepliedConversations(
  prisma: PrismaClient,
  conversationIds: string[],
  actorApId: string,
): Promise<Set<string | null>> {
  if (conversationIds.length === 0) return new Set();

  const replies = await prisma.object.findMany({
    where: {
      conversation: { in: conversationIds },
      attributedTo: actorApId,
    },
    select: { conversation: true },
    distinct: ['conversation'],
  });

  return new Set(replies.map((r) => r.conversation));
}

/** Collect unique values from a map's entries via accessor function. */
function uniqueValues<V>(map: Map<string, V>, accessor: (v: V) => string): string[] {
  return [...new Set(Array.from(map.values()).map(accessor))];
}

// ── Routes ──────────────────────────────────────────────────────────

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

  const conversationMap = groupConversations(
    dmObjects,
    actor.ap_id,
    (id) => !archivedSet.has(id),
  );

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

  const otherApIds = uniqueValues(conversationMap, (c) => c.otherApId);
  const actorInfoMap = await buildActorInfoMap(prisma, otherApIds);

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

  const repliedConversations = await findRepliedConversations(prisma, incomingConversations, actor.ap_id);
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

  const allConversations = [...new Set(
    incomingDMs.map((dm) => dm.conversation).filter((c): c is string => c !== null),
  )];
  const repliedConversationsSet = await findRepliedConversations(prisma, allConversations, actor.ap_id);

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
  const actorInfoMap = await buildActorInfoMap(prisma, senderApIds);

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
  const prisma = c.get('prisma');

  const body = await c.req.json<{ sender_ap_id: string; block?: boolean }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.sender_ap_id);

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

  await prisma.object.deleteMany({
    where: {
      conversation: conversationId,
      visibility: 'direct',
      attributedTo: body.sender_ap_id,
    },
  });

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

  return c.json({ success: true, message: 'Reply to the conversation to accept' });
});

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
      other_participant: formatActorProfile(body.participant_ap_id, otherInfo),
      last_message_at: null,
      created_at: new Date().toISOString(),
    },
  });
});


dm.post('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = parseOtherApId(c);
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

  const otherApId = parseOtherApId(c);
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

  const otherApId = parseOtherApId(c);
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

  const otherApId = parseOtherApId(c);
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

  const otherApId = parseOtherApId(c);
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

  const conversationMap = groupConversations(
    dmObjects,
    actor.ap_id,
    (id) => archivedSet.has(id),
  );

  const otherApIds = uniqueValues(conversationMap, (c) => c.otherApId);
  const actorInfoMap = await buildActorInfoMap(prisma, otherApIds);

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
