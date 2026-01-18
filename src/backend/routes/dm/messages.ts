// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, formatUsername, signRequest, isLocal, isSafeRemoteUrl, safeJsonParse } from '../../utils';
import { MAX_DM_CONTENT_LENGTH, MAX_DM_PAGE_LIMIT, getConversationId, parseLimit } from './utils';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

type MessageRow = {
  id: string;
  sender_ap_id: string;
  content: string;
  created_at: string;
  attachments_json?: string | null;
  sender_preferred_username: string | null;
  sender_name: string | null;
  sender_icon_url: string | null;
};

type RecipientRow = {
  ap_id: string;
  inbox: string | null;
};

type DirectMessageRow = {
  ap_id: string;
  attributed_to: string;
  conversation: string;
};

type OtherApIdRow = {
  other_ap_id: string;
};

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

dm.get('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');
  const baseUrl = c.env.APP_URL;

  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  // Query messages where the actor is either sender or recipient
  let query = `
    SELECT
      o.ap_id as id,
      o.attributed_to as sender_ap_id,
      o.content,
      o.published as created_at,
      o.attachments_json,
      COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
      COALESCE(a.name, ac.name) as sender_name,
      COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND o.conversation = ?
      AND (o.attributed_to = ? OR json_extract(o.to_json, '$[0]') = ?)
  `;

  const params: Array<string | number | null> = [conversationId, actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all<MessageRow>();

  const result = (messages.results || []).reverse().map((msg) => ({
    id: msg.id,
    sender: {
      ap_id: msg.sender_ap_id,
      username: formatUsername(msg.sender_ap_id),
      preferred_username: msg.sender_preferred_username,
      name: msg.sender_name,
      icon_url: msg.sender_icon_url,
    },
    content: msg.content,
    attachments: safeJsonParse<Attachment[]>(msg.attachments_json, []),
    created_at: msg.created_at,
  }));

  return c.json({ messages: result, conversation_id: conversationId });
});

// Send message to a specific user (creates Note with direct visibility)
dm.post('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

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

  // Verify other user exists
  const otherActor = await c.env.DB.prepare(`
    SELECT ap_id, inbox FROM actors WHERE ap_id = ?
    UNION
    SELECT ap_id, inbox FROM actor_cache WHERE ap_id = ?
  `).bind(otherApId, otherApId).first<RecipientRow>();

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
    await c.env.DB.prepare(`
      INSERT INTO objects (ap_id, type, attributed_to, content, visibility, to_json, cc_json, conversation, published, is_local)
      VALUES (?, 'Note', ?, ?, 'direct', ?, ?, ?, ?, 1)
    `).bind(apId, actor.ap_id, content, toJson, ccJson, conversationId, now).run();
  } catch (e) {
    console.error('[DM] Failed to insert message:', e);
    return c.json({ error: 'Failed to send message' }, 500);
  }

  // Track recipient for efficient querying
  try {
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type)
      VALUES (?, ?, 'to')
    `).bind(apId, otherApId).run();
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
      await c.env.DB.prepare(`
        INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
        VALUES (?, 'Create', ?, ?, ?, 'inbound')
      `).bind(activityId, actor.ap_id, apId, JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId })).run();

      await c.env.DB.prepare(`
        INSERT INTO inbox (actor_ap_id, activity_ap_id)
        VALUES (?, ?)
      `).bind(otherApId, activityId).run();
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
  const message = await c.env.DB.prepare(`
    SELECT ap_id, attributed_to, conversation FROM objects
    WHERE ap_id = ? AND visibility = 'direct' AND type = 'Note'
  `).bind(messageId).first<DirectMessageRow>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only sender can edit
  if (message.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    UPDATE objects SET content = ?, updated_at = ? WHERE ap_id = ?
  `).bind(content, now, message.ap_id).run();

  return c.json({
    success: true,
    message: {
      id: message.ap_id,
      content,
      updated_at: now,
    },
  });
});

// Delete a DM message
dm.delete('/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const messageId = c.req.param('messageId');

  // Get the message
  const message = await c.env.DB.prepare(`
    SELECT ap_id, attributed_to, conversation FROM objects
    WHERE ap_id = ? AND visibility = 'direct' AND type = 'Note'
  `).bind(messageId).first<DirectMessageRow>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only sender can delete
  if (message.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Delete the message
  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?').bind(message.ap_id).run();

  // Clean up object_recipients
  await c.env.DB.prepare('DELETE FROM object_recipients WHERE object_ap_id = ?').bind(message.ap_id).run();

  return c.json({ success: true });
});

// Legacy endpoints for backwards compatibility

dm.get('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const conversationId = c.req.param('id');
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');

  let query = `
    SELECT
      o.ap_id as id,
      o.attributed_to as sender_ap_id,
      o.content,
      o.published as created_at,
      o.attachments_json,
      COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
      COALESCE(a.name, ac.name) as sender_name,
      COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND o.conversation = ?
      AND (o.attributed_to = ? OR json_extract(o.to_json, '$[0]') = ?)
  `;

  const params: Array<string | number | null> = [conversationId, actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all<MessageRow>();

  const result = (messages.results || []).reverse().map((msg) => ({
    id: msg.id,
    sender: {
      ap_id: msg.sender_ap_id,
      username: formatUsername(msg.sender_ap_id),
      preferred_username: msg.sender_preferred_username,
      name: msg.sender_name,
      icon_url: msg.sender_icon_url,
    },
    content: msg.content,
    created_at: msg.created_at,
  }));

  return c.json({ messages: result });
});

dm.post('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

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
  // Only match messages where the actor is either sender or recipient (authorization check)
  const existingMsg = await c.env.DB.prepare(`
    SELECT
      CASE
        WHEN attributed_to = ? THEN json_extract(to_json, '$[0]')
        ELSE attributed_to
      END as other_ap_id
    FROM objects
    WHERE conversation = ? AND visibility = 'direct'
      AND (attributed_to = ? OR json_extract(to_json, '$[0]') = ?)
    LIMIT 1
  `).bind(actor.ap_id, conversationId, actor.ap_id, actor.ap_id).first<OtherApIdRow>();

  if (!existingMsg?.other_ap_id) {
    // Either conversation doesn't exist or actor is not a participant
    return c.json({ error: 'Forbidden' }, 403);
  }

  const otherApId = existingMsg.other_ap_id;
  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = new Date().toISOString();

  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, visibility, to_json, cc_json, conversation, published, is_local)
    VALUES (?, 'Note', ?, ?, 'direct', ?, ?, ?, ?, 1)
  `).bind(apId, actor.ap_id, content, toJson, ccJson, conversationId, now).run();

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type)
    VALUES (?, ?, 'to')
  `).bind(apId, otherApId).run();

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
