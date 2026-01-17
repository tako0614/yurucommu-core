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

export default dm;
