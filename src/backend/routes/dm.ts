// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId, objectApId, activityApId, formatUsername, signRequest, isLocal } from '../utils';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

// Generate a conversation ID for two participants (deterministic)
function getConversationId(baseUrl: string, ap1: string, ap2: string): string {
  const [p1, p2] = [ap1, ap2].sort();
  // Create a stable conversation ID based on the two participants
  const hash = btoa(`${p1}:${p2}`).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
  return `${baseUrl}/ap/conversations/${hash}`;
}

// Get conversations list - aggregated from direct objects
dm.get('/contacts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const baseUrl = c.env.APP_URL;

  // Get distinct conversations where this actor is sender or recipient
  // A conversation is a unique (sender, recipient) pair in direct messages
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
      ) as last_sender
    FROM my_dms md
    LEFT JOIN actors a ON md.other_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON md.other_ap_id = ac.ap_id
    WHERE md.other_ap_id IS NOT NULL AND md.other_ap_id != ''
    ORDER BY md.last_message_at DESC
  `).bind(actor.ap_id, actor.ap_id, actor.ap_id).all();

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

// Get messages with a specific user
dm.get('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const limit = parseInt(c.req.query('limit') || '50');
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

  if (!body.content || body.content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
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
  `).bind(apId, actor.ap_id, body.content.trim(), toJson, ccJson, conversationId, now).run();

  // Track recipient for efficient querying
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type)
    VALUES (?, ?, 'to')
  `).bind(apId, otherApId).run();

  // Send to recipient's inbox if they're remote
  if (!isLocal(otherApId, baseUrl) && otherActor.inbox) {
    try {
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
          content: body.content.trim(),
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
      content: body.content.trim(),
      created_at: now,
    },
    conversation_id: conversationId,
  }, 201);
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
  const limit = parseInt(c.req.query('limit') || '50');
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

  if (!body.content || body.content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
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
  `).bind(apId, actor.ap_id, body.content.trim(), toJson, ccJson, conversationId, now).run();

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
      content: body.content.trim(),
      created_at: now,
    }
  }, 201);
});

export default dm;
