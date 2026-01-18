// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, formatUsername, signRequest, isLocal, isSafeRemoteUrl, safeJsonParse } from '../../utils';
import { MAX_DM_CONTENT_LENGTH, MAX_DM_PAGE_LIMIT, getConversationId, parseLimit } from './utils';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

dm.get('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');
  const baseUrl = c.env.APP_URL;

  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  // Build where clause with database-level authorization
  // Only return messages where the current actor is sender OR the toJson contains actor's ap_id
  const whereClause: {
    visibility: string;
    type: string;
    conversation: string;
    published?: { lt: string };
    OR: Array<{ attributedTo: string } | { toJson: { contains: string } }>;
  } = {
    visibility: 'direct',
    type: 'Note',
    conversation: conversationId,
    // Database-level authorization: only messages where actor is sender or recipient
    OR: [
      { attributedTo: actor.ap_id },
      { toJson: { contains: actor.ap_id } }
    ]
  };

  if (before) {
    whereClause.published = { lt: before };
  }

  // Query messages with authorization in the where clause
  const messages = await prisma.object.findMany({
    where: whereClause,
    orderBy: { published: 'desc' },
    take: limit
  });

  // Additional code-level validation for security in depth
  const filteredMessages = messages.filter((msg) => {
    if (msg.attributedTo === actor.ap_id) return true;
    const toRecipients = safeJsonParse<string[]>(msg.toJson, []);
    return toRecipients.includes(actor.ap_id);
  });

  // Get author info for all messages
  const authorApIds = Array.from(new Set(filteredMessages.map(m => m.attributedTo)));

  // Get local actors
  const localActors = await prisma.actor.findMany({
    where: { apId: { in: authorApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  });
  const localActorMap = new Map(localActors.map(a => [a.apId, a]));

  // Get cached actors for remote users
  const remoteApIds = authorApIds.filter(id => !localActorMap.has(id));
  const cachedActors = remoteApIds.length > 0
    ? await prisma.actorCache.findMany({
        where: { apId: { in: remoteApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
      })
    : [];
  const cachedActorMap = new Map(cachedActors.map(a => [a.apId, a]));

  const result = filteredMessages.reverse().map((msg) => {
    const localActor = localActorMap.get(msg.attributedTo);
    const cachedActor = cachedActorMap.get(msg.attributedTo);
    const authorInfo = localActor || cachedActor;

    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: authorInfo?.preferredUsername || null,
        name: authorInfo?.name || null,
        icon_url: authorInfo?.iconUrl || null,
      },
      content: msg.content,
      attachments: safeJsonParse<Attachment[]>(msg.attachmentsJson, []),
      created_at: msg.published,
    };
  });

  return c.json({ messages: result, conversation_id: conversationId });
});

// Send message to a specific user (creates Note with direct visibility)
dm.post('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const body = await c.req.json<{ content: string }>();
  const baseUrl = c.env.APP_URL;

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Message content is required' }, 400);
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)` }, 400);
  }

  // Verify other user exists (check both local actors and cached remote actors)
  const localActor = await prisma.actor.findUnique({
    where: { apId: otherApId },
    select: { apId: true, inbox: true }
  });

  const cachedActor = !localActor
    ? await prisma.actorCache.findUnique({
        where: { apId: otherApId },
        select: { apId: true, inbox: true }
      })
    : null;

  const otherActor = localActor || cachedActor;

  if (!otherActor) {
    return c.json({ error: 'User not found' }, 404);
  }

  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = new Date().toISOString();
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  // Create Note object with direct visibility
  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);

  try {
    await prisma.object.create({
      data: {
        apId: apId,
        type: 'Note',
        attributedTo: actor.ap_id,
        content: content,
        visibility: 'direct',
        toJson: toJson,
        ccJson: ccJson,
        conversation: conversationId,
        published: now,
        isLocal: 1
      }
    });
  } catch (e) {
    console.error('[DM] Failed to insert message:', e);
    return c.json({ error: 'Failed to send message' }, 500);
  }

  // Track recipient for efficient querying
  try {
    // Check if recipient is a local actor (ObjectRecipient has FK to Actor)
    const recipientIsLocal = await prisma.actor.findUnique({
      where: { apId: otherApId },
      select: { apId: true }
    });

    if (recipientIsLocal) {
      await prisma.objectRecipient.upsert({
        where: {
          objectApId_recipientApId: {
            objectApId: apId,
            recipientApId: otherApId
          }
        },
        create: {
          objectApId: apId,
          recipientApId: otherApId,
          type: 'to'
        },
        update: {} // No update needed, just ensure it exists
      });
    }
  } catch (e) {
    console.error('[DM] Failed to track recipient:', e);
    // Non-critical error, continue
  }

  // Send to recipient's inbox if they're remote
  if (!isLocal(otherApId, baseUrl) && otherActor.inbox) {
    try {
      if (!isSafeRemoteUrl(otherActor.inbox)) {
        console.warn(`[DM] Blocked unsafe inbox URL: ${otherActor.inbox}`);
      } else {
        const createActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activityApId(baseUrl, generateId()),
          type: 'Create',
          actor: actor.ap_id,
          to: [otherApId],
          object: {
            id: apId,
            type: 'Note',
            attributedTo: actor.ap_id,
            to: [otherApId],
            content,
            published: now,
            conversation: conversationId,
          },
        };

        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', otherActor.inbox, JSON.stringify(createActivity));

        await fetch(otherActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(createActivity),
        });
      }
    } catch (e) {
      console.error('Failed to deliver DM:', e);
    }
  }

  // Record in inbox for the recipient (if local)
  if (isLocal(otherApId, baseUrl)) {
    try {
      const activityId = activityApId(baseUrl, generateId());
      await prisma.activity.create({
        data: {
          apId: activityId,
          type: 'Create',
          actorApId: actor.ap_id,
          objectApId: apId,
          rawJson: JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId }),
          direction: 'inbound'
        }
      });

      await prisma.inbox.create({
        data: {
          actorApId: otherApId,
          activityApId: activityId
        }
      });
    } catch (e) {
      console.error('[DM] Failed to record inbox notification:', e);
      // Non-critical error, message was still created
    }
  }

  return c.json({
    message: {
      id: apId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content,
      created_at: now,
    },
    conversation_id: conversationId,
  }, 201);
});

// Edit a DM message
dm.patch('/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const messageId = c.req.param('messageId');
  const body = await c.req.json<{ content: string }>();

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Content is required' }, 400);
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)` }, 400);
  }

  // Get the message
  const message = await prisma.object.findFirst({
    where: {
      apId: messageId,
      visibility: 'direct',
      type: 'Note'
    },
    select: { apId: true, attributedTo: true, conversation: true }
  });

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only sender can edit
  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const now = new Date().toISOString();

  await prisma.object.update({
    where: { apId: message.apId },
    data: {
      content: content,
      updated: now
    }
  });

  return c.json({
    success: true,
    message: {
      id: message.apId,
      content,
      updated_at: now,
    },
  });
});

// Delete a DM message
dm.delete('/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const messageId = c.req.param('messageId');

  // Get the message
  const message = await prisma.object.findFirst({
    where: {
      apId: messageId,
      visibility: 'direct',
      type: 'Note'
    },
    select: { apId: true, attributedTo: true, conversation: true }
  });

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only sender can delete
  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Delete the message
  await prisma.object.delete({
    where: { apId: message.apId }
  });

  // Clean up object_recipients
  await prisma.objectRecipient.deleteMany({
    where: { objectApId: message.apId }
  });

  return c.json({ success: true });
});

// Legacy endpoints for backwards compatibility

dm.get('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const conversationId = c.req.param('id');
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');

  // Build where clause with database-level authorization
  const whereClause: {
    visibility: string;
    type: string;
    conversation: string;
    published?: { lt: string };
    OR: Array<{ attributedTo: string } | { toJson: { contains: string } }>;
  } = {
    visibility: 'direct',
    type: 'Note',
    conversation: conversationId,
    // Database-level authorization: only messages where actor is sender or recipient
    OR: [
      { attributedTo: actor.ap_id },
      { toJson: { contains: actor.ap_id } }
    ]
  };

  if (before) {
    whereClause.published = { lt: before };
  }

  // Query messages with authorization in the where clause
  const messages = await prisma.object.findMany({
    where: whereClause,
    orderBy: { published: 'desc' },
    take: limit
  });

  // Additional code-level validation for security in depth
  const filteredMessages = messages.filter((msg) => {
    if (msg.attributedTo === actor.ap_id) return true;
    const toRecipients = safeJsonParse<string[]>(msg.toJson, []);
    return toRecipients.includes(actor.ap_id);
  });

  // Get author info for all messages
  const authorApIds = Array.from(new Set(filteredMessages.map(m => m.attributedTo)));

  // Get local actors
  const localActors = await prisma.actor.findMany({
    where: { apId: { in: authorApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  });
  const localActorMap = new Map(localActors.map(a => [a.apId, a]));

  // Get cached actors for remote users
  const remoteApIds = authorApIds.filter(id => !localActorMap.has(id));
  const cachedActors = remoteApIds.length > 0
    ? await prisma.actorCache.findMany({
        where: { apId: { in: remoteApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
      })
    : [];
  const cachedActorMap = new Map(cachedActors.map(a => [a.apId, a]));

  const result = filteredMessages.reverse().map((msg) => {
    const localActor = localActorMap.get(msg.attributedTo);
    const cachedActor = cachedActorMap.get(msg.attributedTo);
    const authorInfo = localActor || cachedActor;

    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: authorInfo?.preferredUsername || null,
        name: authorInfo?.name || null,
        icon_url: authorInfo?.iconUrl || null,
      },
      content: msg.content,
      created_at: msg.published,
    };
  });

  return c.json({ messages: result });
});

dm.post('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const conversationId = c.req.param('id');
  const body = await c.req.json<{ content: string }>();
  const baseUrl = c.env.APP_URL;

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Message content is required' }, 400);
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)` }, 400);
  }

  // Find the other participant from the conversation
  // Get messages in this conversation where the actor is a participant
  const existingMessages = await prisma.object.findMany({
    where: {
      conversation: conversationId,
      visibility: 'direct'
    },
    select: {
      attributedTo: true,
      toJson: true
    },
    take: 10
  });

  // Find the other participant
  let otherApId: string | null = null;
  for (const msg of existingMessages) {
    if (msg.attributedTo === actor.ap_id) {
      // Actor is sender, get recipient from toJson
      const recipients = safeJsonParse<string[]>(msg.toJson, []);
      if (recipients.length > 0) {
        otherApId = recipients[0];
        break;
      }
    } else {
      // Actor might be recipient, check toJson
      const recipients = safeJsonParse<string[]>(msg.toJson, []);
      if (recipients.includes(actor.ap_id)) {
        otherApId = msg.attributedTo;
        break;
      }
    }
  }

  if (!otherApId) {
    // Either conversation doesn't exist or actor is not a participant
    return c.json({ error: 'Forbidden' }, 403);
  }

  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = new Date().toISOString();

  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);

  await prisma.object.create({
    data: {
      apId: apId,
      type: 'Note',
      attributedTo: actor.ap_id,
      content: content,
      visibility: 'direct',
      toJson: toJson,
      ccJson: ccJson,
      conversation: conversationId,
      published: now,
      isLocal: 1
    }
  });

  // Track recipient if they're a local actor
  try {
    const recipientIsLocal = await prisma.actor.findUnique({
      where: { apId: otherApId },
      select: { apId: true }
    });

    if (recipientIsLocal) {
      await prisma.objectRecipient.upsert({
        where: {
          objectApId_recipientApId: {
            objectApId: apId,
            recipientApId: otherApId
          }
        },
        create: {
          objectApId: apId,
          recipientApId: otherApId,
          type: 'to'
        },
        update: {}
      });
    }
  } catch (e) {
    console.error('[DM] Failed to track recipient:', e);
  }

  return c.json({
    message: {
      id: apId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content,
      created_at: now,
    }
  }, 201);
});

// Typing indicator (local only)

export default dm;
