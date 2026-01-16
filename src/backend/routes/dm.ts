// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId, objectApId, activityApId, formatUsername, signRequest, isLocal, isSafeRemoteUrl } from '../utils';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_DM_CONTENT_LENGTH = 5000;
const MAX_DM_PAGE_LIMIT = 100;

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

// Generate a conversation ID for two participants (deterministic)
function getConversationId(baseUrl: string, ap1: string, ap2: string): string {
  const [p1, p2] = [ap1, ap2].sort();
  // Create a stable conversation ID based on the two participants
  const hash = btoa(`${p1}:${p2}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  return `${baseUrl}/ap/conversations/${hash}`;
}

async function resolveConversationId(
  db: D1Database,
  baseUrl: string,
  actorApId: string,
  otherApId: string
): Promise<string> {
  const existing = await db.prepare(`
    SELECT o.conversation
    FROM objects o
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND o.conversation IS NOT NULL
      AND o.conversation != ''
      AND (
        (o.attributed_to = ? AND json_extract(o.to_json, '$[0]') = ?)
        OR (o.attributed_to = ? AND json_extract(o.to_json, '$[0]') = ?)
      )
    ORDER BY o.published DESC
    LIMIT 1
  `).bind(actorApId, otherApId, otherApId, actorApId).first<any>();

  return existing?.conversation || getConversationId(baseUrl, actorApId, otherApId);
}

// Get conversations list - aggregated from direct objects
dm.get('/contacts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const baseUrl = c.env.APP_URL;

  await c.env.DB.prepare(`
    DELETE FROM dm_read_status
    WHERE actor_ap_id = ?
      AND conversation_id NOT IN (
        SELECT DISTINCT o.conversation
        FROM objects o
        WHERE o.visibility = 'direct'
          AND o.type = 'Note'
          AND o.conversation IS NOT NULL
          AND o.conversation != ''
          AND (o.attributed_to = ? OR json_extract(o.to_json, '$[0]') = ?)
      )
  `).bind(actor.ap_id, actor.ap_id, actor.ap_id).run();

  // Get distinct conversations where this actor is sender or recipient
  // A conversation is a unique (sender, recipient) pair in direct messages
  // Also includes unread count based on dm_read_status
  const conversations = await c.env.DB.prepare(`
    WITH my_dms AS (
      SELECT DISTINCT
        o.conversation,
        CASE
          WHEN o.attributed_to = ? THEN json_extract(o.to_json, '$[0]')
          ELSE o.attributed_to
        END as other_ap_id,
        MAX(o.published) as last_message_at
      FROM objects o
      WHERE o.visibility = 'direct'
        AND o.type = 'Note'
        AND (
          o.attributed_to = ?
          OR json_extract(o.to_json, '$[0]') = ?
        )
      GROUP BY o.conversation
    )
    SELECT
      md.conversation,
      md.other_ap_id,
      md.last_message_at,
      COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
      COALESCE(a.name, ac.name) as name,
      COALESCE(a.icon_url, ac.icon_url) as icon_url,
      (
        SELECT o2.content FROM objects o2
        WHERE o2.conversation = md.conversation
        ORDER BY o2.published DESC LIMIT 1
      ) as last_content,
      (
        SELECT o2.attributed_to FROM objects o2
        WHERE o2.conversation = md.conversation
        ORDER BY o2.published DESC LIMIT 1
      ) as last_sender,
      (
        SELECT COUNT(*) FROM objects o3
        WHERE o3.conversation = md.conversation
          AND o3.visibility = 'direct'
          AND o3.attributed_to != ?
          AND o3.published > COALESCE(
            (SELECT last_read_at FROM dm_read_status WHERE actor_ap_id = ? AND conversation_id = md.conversation),
            '1970-01-01T00:00:00Z'
          )
      ) as unread_count
    FROM my_dms md
    LEFT JOIN actors a ON md.other_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON md.other_ap_id = ac.ap_id
    WHERE md.other_ap_id IS NOT NULL AND md.other_ap_id != ''
      AND NOT EXISTS (
        SELECT 1 FROM dm_archived_conversations dac
        WHERE dac.actor_ap_id = ? AND dac.conversation_id = md.conversation
      )
    ORDER BY md.last_message_at DESC
  `).bind(actor.ap_id, actor.ap_id, actor.ap_id, actor.ap_id, actor.ap_id, actor.ap_id).all();

  // Get communities the user is a member of (for group chat)
  const communities = await c.env.DB.prepare(`
    SELECT
      c.ap_id,
      c.preferred_username,
      c.name,
      c.icon_url,
      c.member_count,
      (SELECT MAX(o.published) FROM objects o WHERE o.audience_json LIKE '%' || c.ap_id || '%') as last_message_at,
      (SELECT o.content FROM objects o WHERE o.audience_json LIKE '%' || c.ap_id || '%' ORDER BY o.published DESC LIMIT 1) as last_content,
      (SELECT o.attributed_to FROM objects o WHERE o.audience_json LIKE '%' || c.ap_id || '%' ORDER BY o.published DESC LIMIT 1) as last_sender
    FROM community_members cm
    JOIN communities c ON cm.community_ap_id = c.ap_id
    WHERE cm.actor_ap_id = ?
    ORDER BY last_message_at DESC NULLS LAST, c.name ASC
  `).bind(actor.ap_id).all();

  const contactsResult = (conversations.results || []).map((f: any) => ({
    type: 'user' as const,
    ap_id: f.other_ap_id,
    username: formatUsername(f.other_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    conversation_id: f.conversation,
    last_message: f.last_content ? {
      content: f.last_content,
      is_mine: f.last_sender === actor.ap_id,
    } : null,
    last_message_at: f.last_message_at,
    unread_count: f.unread_count || 0,
  }));

  const communitiesResult = (communities.results || []).map((c: any) => ({
    type: 'community' as const,
    ap_id: c.ap_id,
    username: formatUsername(c.ap_id),
    preferred_username: c.preferred_username,
    name: c.name,
    icon_url: c.icon_url,
    member_count: c.member_count,
    last_message: c.last_content ? {
      content: c.last_content,
      is_mine: c.last_sender === actor.ap_id,
    } : null,
    last_message_at: c.last_message_at,
  }));

  // Pending requests: direct messages from people we haven't replied to
  // (No message from us to them in the same conversation)
  const requestCount = await c.env.DB.prepare(`
    SELECT COUNT(DISTINCT o.conversation) as count
    FROM objects o
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND json_extract(o.to_json, '$[0]') = ?
      AND NOT EXISTS (
        SELECT 1 FROM objects o2
        WHERE o2.conversation = o.conversation
        AND o2.attributed_to = ?
      )
  `).bind(actor.ap_id, actor.ap_id).first<any>();

  return c.json({
    mutual_followers: contactsResult,
    communities: communitiesResult,
    request_count: requestCount?.count || 0,
  });
});

// Get message requests (DMs from people we haven't replied to)
dm.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const requests = await c.env.DB.prepare(`
    SELECT
      o.ap_id as id,
      o.attributed_to as sender_ap_id,
      o.content,
      o.published as created_at,
      o.conversation,
      COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
      COALESCE(a.name, ac.name) as name,
      COALESCE(a.icon_url, ac.icon_url) as icon_url
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND json_extract(o.to_json, '$[0]') = ?
      AND NOT EXISTS (
        SELECT 1 FROM objects o2
        WHERE o2.conversation = o.conversation
        AND o2.attributed_to = ?
      )
    ORDER BY o.published DESC
  `).bind(actor.ap_id, actor.ap_id).all();

  const result = (requests.results || []).map((r: any) => ({
    id: r.id,
    sender: {
      ap_id: r.sender_ap_id,
      username: formatUsername(r.sender_ap_id),
      preferred_username: r.preferred_username,
      name: r.name,
      icon_url: r.icon_url,
    },
    content: r.content,
    created_at: r.created_at,
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

  const body = await c.req.json<{ sender_ap_id: string; block?: boolean }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.sender_ap_id);

  // Clean up object_recipients
  await c.env.DB.prepare(`
    DELETE FROM object_recipients
    WHERE object_ap_id IN (
      SELECT ap_id FROM objects WHERE conversation = ? AND attributed_to = ?
    )
  `).bind(conversationId, body.sender_ap_id).run();

  // Delete all messages in this conversation from the sender
  await c.env.DB.prepare(`
    DELETE FROM objects
    WHERE conversation = ?
      AND visibility = 'direct'
      AND attributed_to = ?
  `).bind(conversationId, body.sender_ap_id).run();

  // Optionally block the sender
  if (body.block) {
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO blocks (blocker_ap_id, blocked_ap_id)
      VALUES (?, ?)
    `).bind(actor.ap_id, body.sender_ap_id).run();
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
dm.get('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');
  const baseUrl = c.env.APP_URL;

  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

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
  `;

  const params: any[] = [conversationId];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all();

  const result = (messages.results || []).reverse().map((msg: any) => ({
    id: msg.id,
    sender: {
      ap_id: msg.sender_ap_id,
      username: formatUsername(msg.sender_ap_id),
      preferred_username: msg.sender_preferred_username,
      name: msg.sender_name,
      icon_url: msg.sender_icon_url,
    },
    content: msg.content,
    attachments: JSON.parse(msg.attachments_json || '[]'),
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
  `).bind(otherApId, otherApId).first<any>();

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

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, visibility, to_json, cc_json, conversation, published, is_local)
    VALUES (?, 'Note', ?, ?, 'direct', ?, ?, ?, ?, 1)
  `).bind(apId, actor.ap_id, content, toJson, ccJson, conversationId, now).run();

  // Track recipient for efficient querying
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type)
    VALUES (?, ?, 'to')
  `).bind(apId, otherApId).run();

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
    const activityId = activityApId(baseUrl, generateId());
    await c.env.DB.prepare(`
      INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
      VALUES (?, 'Create', ?, ?, ?, 'inbound')
    `).bind(activityId, actor.ap_id, apId, JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId })).run();

    await c.env.DB.prepare(`
      INSERT INTO inbox (actor_ap_id, activity_ap_id)
      VALUES (?, ?)
    `).bind(otherApId, activityId).run();
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
  `).bind(messageId).first<any>();

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
  `).bind(messageId).first<any>();

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

dm.get('/conversations', async (c) => {
  // Redirect to contacts
  return c.redirect('/api/dm/contacts');
});

dm.post('/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ participant_ap_id: string }>();
  if (!body.participant_ap_id) {
    return c.json({ error: 'participant_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.participant_ap_id);

  // Get other participant info
  const otherInfo = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url FROM actors WHERE ap_id = ?
    UNION
    SELECT ap_id, preferred_username, name, icon_url FROM actor_cache WHERE ap_id = ?
  `).bind(body.participant_ap_id, body.participant_ap_id).first<any>();

  if (!otherInfo) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  return c.json({
    conversation: {
      id: conversationId,
      other_participant: {
        ap_id: body.participant_ap_id,
        username: formatUsername(body.participant_ap_id),
        preferred_username: otherInfo.preferred_username,
        name: otherInfo.name,
        icon_url: otherInfo.icon_url,
      },
      last_message_at: null,
      created_at: new Date().toISOString(),
    }
  });
});

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

  const params: any[] = [conversationId, actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all();

  const result = (messages.results || []).reverse().map((msg: any) => ({
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
  const existingMsg = await c.env.DB.prepare(`
    SELECT
      CASE
        WHEN attributed_to = ? THEN json_extract(to_json, '$[0]')
        ELSE attributed_to
      END as other_ap_id
    FROM objects
    WHERE conversation = ? AND visibility = 'direct'
    LIMIT 1
  `).bind(actor.ap_id, conversationId).first<any>();

  if (!existingMsg?.other_ap_id) {
    return c.json({ error: 'Conversation not found' }, 404);
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
dm.post('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO dm_typing (actor_ap_id, recipient_ap_id, last_typed_at)
    VALUES (?, ?, ?)
    ON CONFLICT(actor_ap_id, recipient_ap_id)
    DO UPDATE SET last_typed_at = excluded.last_typed_at
  `).bind(actor.ap_id, otherApId, now).run();

  return c.json({ success: true, typed_at: now });
});

dm.get('/user/:encodedApId/typing', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const typing = await c.env.DB.prepare(`
    SELECT last_typed_at
    FROM dm_typing
    WHERE actor_ap_id = ? AND recipient_ap_id = ?
  `).bind(otherApId, actor.ap_id).first<any>();

  if (!typing?.last_typed_at) {
    return c.json({ is_typing: false, last_typed_at: null });
  }

  const lastTypedAt = typing.last_typed_at as string;
  const lastTypedMs = Date.parse(lastTypedAt);
  const nowMs = Date.now();
  const isTyping = Number.isFinite(lastTypedMs) && (nowMs - lastTypedMs) <= 8000;
  const isExpired = !Number.isFinite(lastTypedMs) || (nowMs - lastTypedMs) > 5 * 60 * 1000;

  if (isExpired) {
    await c.env.DB.prepare(`
      DELETE FROM dm_typing
      WHERE actor_ap_id = ? AND recipient_ap_id = ?
    `).bind(otherApId, actor.ap_id).run();
    return c.json({ is_typing: false, last_typed_at: null });
  }

  return c.json({ is_typing: isTyping, last_typed_at: lastTypedAt });
});

// Mark conversation as read
dm.post('/user/:encodedApId/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = await resolveConversationId(c.env.DB, baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    VALUES (?, ?, ?)
    ON CONFLICT(actor_ap_id, conversation_id)
    DO UPDATE SET last_read_at = excluded.last_read_at
  `).bind(actor.ap_id, conversationId, now).run();

  return c.json({ success: true, last_read_at: now });
});

// Archive a conversation (hide from inbox)
dm.post('/user/:encodedApId/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at)
    VALUES (?, ?, ?)
    ON CONFLICT(actor_ap_id, conversation_id) DO NOTHING
  `).bind(actor.ap_id, conversationId, now).run();

  return c.json({ success: true, archived_at: now });
});

// Unarchive a conversation
dm.delete('/user/:encodedApId/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  if (!otherApId) return c.json({ error: 'ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  await c.env.DB.prepare(`
    DELETE FROM dm_archived_conversations WHERE actor_ap_id = ? AND conversation_id = ?
  `).bind(actor.ap_id, conversationId).run();

  return c.json({ success: true });
});

// Get archived conversations
dm.get('/archived', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const baseUrl = c.env.APP_URL;

  // Get archived conversation IDs
  const archivedIds = await c.env.DB.prepare(`
    SELECT conversation_id, archived_at FROM dm_archived_conversations WHERE actor_ap_id = ?
  `).bind(actor.ap_id).all();

  const archivedSet = new Set((archivedIds.results || []).map((a: any) => a.conversation_id));
  if (archivedSet.size === 0) return c.json({ archived: [] });

  // Get conversation details for archived ones
  const conversations = await c.env.DB.prepare(`
    WITH my_dms AS (
      SELECT DISTINCT
        o.conversation,
        CASE
          WHEN o.attributed_to = ? THEN json_extract(o.to_json, '$[0]')
          ELSE o.attributed_to
        END as other_ap_id,
        MAX(o.published) as last_message_at
      FROM objects o
      WHERE o.visibility = 'direct'
        AND o.type = 'Note'
        AND (o.attributed_to = ? OR json_extract(o.to_json, '$[0]') = ?)
      GROUP BY o.conversation
    )
    SELECT
      md.conversation,
      md.other_ap_id,
      md.last_message_at,
      COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
      COALESCE(a.name, ac.name) as name,
      COALESCE(a.icon_url, ac.icon_url) as icon_url
    FROM my_dms md
    LEFT JOIN actors a ON md.other_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON md.other_ap_id = ac.ap_id
    WHERE md.other_ap_id IS NOT NULL AND md.other_ap_id != ''
    ORDER BY md.last_message_at DESC
  `).bind(actor.ap_id, actor.ap_id, actor.ap_id).all();

  const archived = (conversations.results || [])
    .filter((c: any) => archivedSet.has(c.conversation))
    .map((f: any) => ({
      ap_id: f.other_ap_id,
      username: formatUsername(f.other_ap_id),
      preferred_username: f.preferred_username,
      name: f.name,
      icon_url: f.icon_url,
      conversation_id: f.conversation,
      last_message_at: f.last_message_at,
    }));

  return c.json({ archived });
});

export default dm;
