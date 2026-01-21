// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { formatUsername } from '../../utils';
import { getConversationId, resolveConversationId } from './utils';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

dm.get('/contacts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  // Clean up orphaned read status entries for conversations that no longer exist
  // Get all conversations this actor is involved in
  const validConversations = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      conversation: { not: null },
      OR: [
        { attributedTo: actor.ap_id },
        { toJson: { contains: actor.ap_id } },
      ],
    },
    select: { conversation: true },
    distinct: ['conversation'],
  });

  const validConversationIds = validConversations
    .map((c) => c.conversation)
    .filter((c): c is string => c !== null);

  // Delete orphaned read status entries
  if (validConversationIds.length > 0) {
    await prisma.dmReadStatus.deleteMany({
      where: {
        actorApId: actor.ap_id,
        conversationId: { notIn: validConversationIds },
      },
    });
  } else {
    // No valid conversations, delete all read status for this actor
    await prisma.dmReadStatus.deleteMany({
      where: { actorApId: actor.ap_id },
    });
  }

  // Get archived conversation IDs to exclude
  const archivedConversations = await prisma.dmArchivedConversation.findMany({
    where: { actorApId: actor.ap_id },
    select: { conversationId: true },
  });
  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));

  // Get DM conversations for this actor with limit to prevent DoS
  // We fetch enough messages to get unique conversations but cap for safety
  const dmObjects = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      conversation: { not: null },
      OR: [
        { attributedTo: actor.ap_id },
        { toJson: { contains: actor.ap_id } },
      ],
    },
    orderBy: { published: 'desc' },
    select: {
      conversation: true,
      attributedTo: true,
      toJson: true,
      published: true,
      content: true,
    },
    take: 2000, // Enough to cover many conversations while preventing unbounded results
  });

  // Group by conversation and get other participant
  const conversationMap = new Map<string, {
    conversation: string;
    otherApId: string;
    lastMessageAt: string;
    lastContent: string | null;
    lastSender: string;
  }>();

  for (const obj of dmObjects) {
    if (!obj.conversation) continue;
    if (archivedSet.has(obj.conversation)) continue;

    // Determine the other participant
    let otherApId: string;
    if (obj.attributedTo === actor.ap_id) {
      // We sent this - other is the recipient
      try {
        const toArray = JSON.parse(obj.toJson);
        otherApId = toArray[0];
      } catch (err) {
        // MEDIUM FIX: Log JSON parse error for debugging
        console.warn('[DM] Failed to parse toJson for contact:', err, { conversation: obj.conversation });
        continue;
      }
    } else {
      // We received this - other is the sender
      otherApId = obj.attributedTo;
    }

    if (!otherApId || otherApId === '') continue;

    // Only store first (most recent) message per conversation
    if (!conversationMap.has(obj.conversation)) {
      conversationMap.set(obj.conversation, {
        conversation: obj.conversation,
        otherApId,
        lastMessageAt: obj.published,
        lastContent: obj.content,
        lastSender: obj.attributedTo,
      });
    }
  }

  // Get read status for all conversations
  const readStatuses = await prisma.dmReadStatus.findMany({
    where: { actorApId: actor.ap_id },
  });
  const readStatusMap = new Map(readStatuses.map((r) => [r.conversationId, r.lastReadAt]));

  // Calculate unread counts for each conversation using batch query
  const conversationIds = Array.from(conversationMap.keys());
  const unreadCounts = new Map<string, number>();

  // Initialize all conversations with 0 unread count
  for (const convId of conversationIds) {
    unreadCounts.set(convId, 0);
  }

  // Batch query to get unread messages for all conversations at once
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
    const countPromises = Array.from(lastReadAtMap.entries()).map(async ([lastReadAt, convIds]) => {
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
    });

    await Promise.all(countPromises);
  }

  // Get actor info for all other participants
  const otherApIds = Array.from(new Set(Array.from(conversationMap.values()).map((c) => c.otherApId)));

  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const actorInfoMap = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>();
  for (const a of cachedActors) {
    actorInfoMap.set(a.apId, a);
  }
  for (const a of localActors) {
    actorInfoMap.set(a.apId, a); // Local actors take precedence
  }

  // Build contacts result
  const contactsResult = Array.from(conversationMap.values()).map((conv) => {
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
  });

  // Sort by last message at
  contactsResult.sort((a, b) => {
    const aTime = a.last_message_at || '';
    const bTime = b.last_message_at || '';
    return bTime.localeCompare(aTime);
  });

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
    // Fetch recent messages for all communities (get enough to ensure at least one per community)
    const recentMessages = await prisma.object.findMany({
      where: {
        communityApId: { in: communityApIds },
      },
      orderBy: { published: 'desc' },
      select: { communityApId: true, content: true, attributedTo: true, published: true },
      take: communityApIds.length * 10,
    });

    // Keep only the latest message per community
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
  const communitiesResult = communityMemberships.map((cm) => {
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
  });

  // Sort communities by last message at
  communitiesResult.sort((a, b) => {
    const aTime = a.last_message_at || '';
    const bTime = b.last_message_at || '';
    return bTime.localeCompare(aTime) || a.name.localeCompare(b.name);
  });

  // Count pending requests: DMs from people we haven't replied to
  // Get all incoming DM conversations
  const incomingDMs = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      toJson: { contains: actor.ap_id },
    },
    select: { conversation: true },
    distinct: ['conversation'],
  });

  // Batch get all conversations where we've replied
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

  // Get incoming DMs where we haven't replied (with limit to prevent DoS)
  const incomingDMs = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      toJson: { contains: actor.ap_id },
    },
    orderBy: { published: 'desc' },
    select: {
      apId: true,
      attributedTo: true,
      content: true,
      published: true,
      conversation: true,
    },
    take: 1000, // Cap for safety while covering typical usage
  });

  // Batch get all conversations where we've replied to avoid N+1
  const allConversations = [...new Set(incomingDMs.map((dm) => dm.conversation).filter((c): c is string => c !== null))];
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

  // Filter to only unreplied conversations
  const requests: Array<{
    id: string;
    senderApId: string;
    content: string;
    createdAt: string;
    conversation: string | null;
  }> = [];

  const seenConversations = new Set<string>();

  for (const dm of incomingDMs) {
    if (!dm.conversation || seenConversations.has(dm.conversation)) continue;

    // Check if we've replied in this conversation (using batched data)
    if (!repliedConversationsSet.has(dm.conversation)) {
      seenConversations.add(dm.conversation);
      requests.push({
        id: dm.apId,
        senderApId: dm.attributedTo,
        content: dm.content,
        createdAt: dm.published,
        conversation: dm.conversation,
      });
    }
  }

  // Get sender info
  const senderApIds = Array.from(new Set(requests.map((r) => r.senderApId)));
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: senderApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: senderApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const actorInfoMap = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>();
  for (const a of cachedActors) {
    actorInfoMap.set(a.apId, a);
  }
  for (const a of localActors) {
    actorInfoMap.set(a.apId, a);
  }

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

  // Clean up object_recipients
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
  // This endpoint can be used to pre-approve without sending a message
  // For now, we just return success since no separate state is needed
  return c.json({ success: true, message: 'Reply to the conversation to accept' });
});

// Get messages with a specific user

dm.get('/conversations', async (c) => {
  // Redirect to contacts
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
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
  });

  const cachedActor = localActor ? null : await prisma.actorCache.findUnique({
    where: { apId: body.participant_ap_id },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
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
    }
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

  const typing = await prisma.dmTyping.findUnique({
    where: {
      actorApId_recipientApId: {
        actorApId: otherApId,
        recipientApId: actor.ap_id,
      },
    },
    select: { lastTypedAt: true },
  });

  if (!typing?.lastTypedAt) {
    return c.json({ is_typing: false, last_typed_at: null });
  }

  const lastTypedAt = typing.lastTypedAt;
  const lastTypedMs = Date.parse(lastTypedAt);
  const nowMs = Date.now();
  const isTyping = Number.isFinite(lastTypedMs) && (nowMs - lastTypedMs) <= 8000;
  const isExpired = !Number.isFinite(lastTypedMs) || (nowMs - lastTypedMs) > 5 * 60 * 1000;

  if (isExpired) {
    await prisma.dmTyping.delete({
      where: {
        actorApId_recipientApId: {
          actorApId: otherApId,
          recipientApId: actor.ap_id,
        },
      },
    });
    return c.json({ is_typing: false, last_typed_at: null });
  }

  return c.json({ is_typing: isTyping, last_typed_at: lastTypedAt });
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
        conversationId: conversationId,
      },
    },
    update: { lastReadAt: now },
    create: {
      actorApId: actor.ap_id,
      conversationId: conversationId,
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
        conversationId: conversationId,
      },
    },
    update: {},
    create: {
      actorApId: actor.ap_id,
      conversationId: conversationId,
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
      conversationId: conversationId,
    },
  });

  return c.json({ success: true });
});

// Get archived conversations
dm.get('/archived', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  // Get archived conversation IDs
  const archivedConversations = await prisma.dmArchivedConversation.findMany({
    where: { actorApId: actor.ap_id },
    select: { conversationId: true, archivedAt: true },
  });

  if (archivedConversations.length === 0) {
    return c.json({ archived: [] });
  }

  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));

  // Get all DM conversations for this actor (with limit)
  const dmObjects = await prisma.object.findMany({
    where: {
      visibility: 'direct',
      type: 'Note',
      conversation: { not: null },
      OR: [
        { attributedTo: actor.ap_id },
        { toJson: { contains: actor.ap_id } },
      ],
    },
    orderBy: { published: 'desc' },
    select: {
      conversation: true,
      attributedTo: true,
      toJson: true,
      published: true,
    },
    take: 2000, // Cap for safety
  });

  // Group by conversation and get other participant (only archived ones)
  const conversationMap = new Map<string, {
    conversation: string;
    otherApId: string;
    lastMessageAt: string;
  }>();

  for (const obj of dmObjects) {
    if (!obj.conversation) continue;
    if (!archivedSet.has(obj.conversation)) continue;

    // Determine the other participant
    let otherApId: string;
    if (obj.attributedTo === actor.ap_id) {
      try {
        const toArray = JSON.parse(obj.toJson);
        otherApId = toArray[0];
      } catch (err) {
        // MEDIUM FIX: Log JSON parse error for debugging
        console.warn('[DM] Failed to parse toJson for archived:', err, { conversation: obj.conversation });
        continue;
      }
    } else {
      otherApId = obj.attributedTo;
    }

    if (!otherApId || otherApId === '') continue;

    if (!conversationMap.has(obj.conversation)) {
      conversationMap.set(obj.conversation, {
        conversation: obj.conversation,
        otherApId,
        lastMessageAt: obj.published,
      });
    }
  }

  // Get actor info for all other participants
  const otherApIds = Array.from(new Set(Array.from(conversationMap.values()).map((c) => c.otherApId)));

  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const actorInfoMap = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>();
  for (const a of cachedActors) {
    actorInfoMap.set(a.apId, a);
  }
  for (const a of localActors) {
    actorInfoMap.set(a.apId, a);
  }

  const archived = Array.from(conversationMap.values()).map((conv) => {
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
  });

  // Sort by last message at
  archived.sort((a, b) => {
    const aTime = a.last_message_at || '';
    const bTime = b.last_message_at || '';
    return bTime.localeCompare(aTime);
  });

  return c.json({ archived });
});

export default dm;
