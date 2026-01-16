import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId, formatUsername } from '../utils';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get contacts - from dm_contacts table + communities
dm.get('/contacts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  // Get contacts from dm_contacts table (people user follows or received messages from)
  const contacts = await c.env.DB.prepare(`
    SELECT
      a.ap_id,
      a.preferred_username,
      a.name,
      a.icon_url,
      dc.id as conversation_id,
      dc.last_message_at,
      lm.content as last_message_content,
      lm.sender_ap_id as last_message_sender_ap_id
    FROM dm_contacts dmc
    JOIN actors a ON dmc.contact_ap_id = a.ap_id
    LEFT JOIN dm_conversations dc ON
      (dc.participant1_ap_id = ? AND dc.participant2_ap_id = a.ap_id) OR
      (dc.participant1_ap_id = a.ap_id AND dc.participant2_ap_id = ?)
    LEFT JOIN (
      SELECT dm1.conversation_id, dm1.content, dm1.sender_ap_id
      FROM dm_messages dm1
      WHERE dm1.created_at = (
        SELECT MAX(dm2.created_at) FROM dm_messages dm2 WHERE dm2.conversation_id = dm1.conversation_id
      )
    ) lm ON lm.conversation_id = dc.id
    WHERE dmc.owner_ap_id = ?
    ORDER BY dc.last_message_at DESC NULLS LAST, a.name ASC
  `).bind(actor.ap_id, actor.ap_id, actor.ap_id).all();

  // Get communities the user is a member of
  const communities = await c.env.DB.prepare(`
    SELECT
      c.ap_id,
      c.preferred_username,
      c.name,
      c.icon_url,
      c.member_count,
      c.last_message_at,
      lm.content as last_message_content,
      lm.sender_ap_id as last_message_sender_ap_id
    FROM community_members cm
    JOIN communities c ON cm.community_ap_id = c.ap_id
    LEFT JOIN (
      SELECT cm1.community_ap_id, cm1.content, cm1.sender_ap_id
      FROM community_messages cm1
      WHERE cm1.created_at = (
        SELECT MAX(cm2.created_at) FROM community_messages cm2 WHERE cm2.community_ap_id = cm1.community_ap_id
      )
    ) lm ON lm.community_ap_id = c.ap_id
    WHERE cm.actor_ap_id = ?
    ORDER BY c.last_message_at DESC NULLS LAST, c.name ASC
  `).bind(actor.ap_id).all();

  const contactsResult = (contacts.results || []).map((f: any) => ({
    type: 'user' as const,
    ap_id: f.ap_id,
    username: formatUsername(f.ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    conversation_id: f.conversation_id,
    last_message: f.last_message_content ? {
      content: f.last_message_content,
      is_mine: f.last_message_sender_ap_id === actor.ap_id,
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
    last_message: c.last_message_content ? {
      content: c.last_message_content,
      is_mine: c.last_message_sender_ap_id === actor.ap_id,
    } : null,
    last_message_at: c.last_message_at,
  }));

  // Get pending request count
  const requestCount = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM dm_requests WHERE recipient_ap_id = ? AND status = 'pending'
  `).bind(actor.ap_id).first<any>();

  return c.json({
    mutual_followers: contactsResult,
    communities: communitiesResult,
    request_count: requestCount?.count || 0,
  });
});

// Get message requests
dm.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const requests = await c.env.DB.prepare(`
    SELECT
      r.id,
      r.sender_ap_id,
      r.content,
      r.created_at,
      a.preferred_username,
      a.name,
      a.icon_url
    FROM dm_requests r
    JOIN actors a ON r.sender_ap_id = a.ap_id
    WHERE r.recipient_ap_id = ? AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `).bind(actor.ap_id).all();

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
  }));

  return c.json({ requests: result });
});

// Accept message request
dm.post('/requests/:id/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const requestId = c.req.param('id');

  const request = await c.env.DB.prepare(`
    SELECT * FROM dm_requests WHERE id = ? AND recipient_ap_id = ? AND status = 'pending'
  `).bind(requestId, actor.ap_id).first<any>();

  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }

  const now = new Date().toISOString();

  // Update request status
  await c.env.DB.prepare(`
    UPDATE dm_requests SET status = 'accepted', updated_at = ? WHERE id = ?
  `).bind(now, requestId).run();

  // Add sender to recipient's contacts
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO dm_contacts (owner_ap_id, contact_ap_id, added_reason)
    VALUES (?, ?, 'message_received')
  `).bind(actor.ap_id, request.sender_ap_id).run();

  // Create conversation and move the message
  const [participant1, participant2] = [actor.ap_id, request.sender_ap_id].sort();
  let conversation = await c.env.DB.prepare(`
    SELECT id FROM dm_conversations
    WHERE (participant1_ap_id = ? AND participant2_ap_id = ?) OR (participant1_ap_id = ? AND participant2_ap_id = ?)
  `).bind(actor.ap_id, request.sender_ap_id, request.sender_ap_id, actor.ap_id).first<any>();

  if (!conversation) {
    const conversationId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO dm_conversations (id, participant1_ap_id, participant2_ap_id, created_at, last_message_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(conversationId, participant1, participant2, request.created_at, request.created_at).run();
    conversation = { id: conversationId };
  }

  // Move the message to dm_messages
  const messageId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO dm_messages (id, conversation_id, sender_ap_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(messageId, conversation.id, request.sender_ap_id, request.content, request.created_at).run();

  return c.json({ success: true });
});

// Reject message request
dm.post('/requests/:id/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const requestId = c.req.param('id');

  const request = await c.env.DB.prepare(`
    SELECT * FROM dm_requests WHERE id = ? AND recipient_ap_id = ? AND status = 'pending'
  `).bind(requestId, actor.ap_id).first<any>();

  if (!request) {
    return c.json({ error: 'Request not found' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE dm_requests SET status = 'rejected', updated_at = datetime('now') WHERE id = ?
  `).bind(requestId).run();

  return c.json({ success: true });
});

// Get conversations for current user (legacy endpoint, still used for individual chats)
dm.get('/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const conversations = await c.env.DB.prepare(`
    SELECT
      dc.id,
      dc.participant1_ap_id,
      dc.participant2_ap_id,
      dc.last_message_at,
      dc.created_at,
      CASE
        WHEN dc.participant1_ap_id = ? THEN dc.participant2_ap_id
        ELSE dc.participant1_ap_id
      END as other_ap_id,
      COALESCE(a1.preferred_username, a2.preferred_username, ac1.preferred_username, ac2.preferred_username) as other_preferred_username,
      COALESCE(a1.name, a2.name, ac1.name, ac2.name) as other_name,
      COALESCE(a1.icon_url, a2.icon_url, ac1.icon_url, ac2.icon_url) as other_icon_url,
      lm.content as last_message_content,
      lm.sender_ap_id as last_message_sender_ap_id
    FROM dm_conversations dc
    LEFT JOIN actors a1 ON dc.participant2_ap_id = a1.ap_id AND dc.participant1_ap_id = ?
    LEFT JOIN actors a2 ON dc.participant1_ap_id = a2.ap_id AND dc.participant2_ap_id = ?
    LEFT JOIN actor_cache ac1 ON dc.participant2_ap_id = ac1.ap_id AND dc.participant1_ap_id = ?
    LEFT JOIN actor_cache ac2 ON dc.participant1_ap_id = ac2.ap_id AND dc.participant2_ap_id = ?
    LEFT JOIN (
      SELECT dm1.conversation_id, dm1.content, dm1.sender_ap_id
      FROM dm_messages dm1
      WHERE dm1.created_at = (
        SELECT MAX(dm2.created_at) FROM dm_messages dm2 WHERE dm2.conversation_id = dm1.conversation_id
      )
    ) lm ON lm.conversation_id = dc.id
    WHERE dc.participant1_ap_id = ? OR dc.participant2_ap_id = ?
    ORDER BY dc.last_message_at DESC NULLS LAST
  `).bind(
    actor.ap_id,
    actor.ap_id, actor.ap_id,
    actor.ap_id, actor.ap_id,
    actor.ap_id, actor.ap_id
  ).all();

  const result = (conversations.results || []).map((conv: any) => ({
    id: conv.id,
    other_participant: {
      ap_id: conv.other_ap_id,
      username: formatUsername(conv.other_ap_id),
      preferred_username: conv.other_preferred_username,
      name: conv.other_name,
      icon_url: conv.other_icon_url,
    },
    last_message: conv.last_message_content ? {
      content: conv.last_message_content,
      is_mine: conv.last_message_sender_ap_id === actor.ap_id,
    } : null,
    last_message_at: conv.last_message_at,
    created_at: conv.created_at,
  }));

  return c.json({ conversations: result });
});

// Create or return existing conversation
dm.post('/conversations', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ participant_ap_id: string }>();
  if (!body.participant_ap_id) {
    return c.json({ error: 'participant_ap_id is required' }, 400);
  }

  const otherApId = body.participant_ap_id;

  // Verify other actor exists (in actors or actor_cache)
  const localActor = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?').bind(otherApId).first();
  const cachedActor = await c.env.DB.prepare('SELECT ap_id FROM actor_cache WHERE ap_id = ?').bind(otherApId).first();

  if (!localActor && !cachedActor) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  // Check if conversation already exists (order doesn't matter)
  let conversation = await c.env.DB.prepare(`
    SELECT * FROM dm_conversations
    WHERE (participant1_ap_id = ? AND participant2_ap_id = ?) OR (participant1_ap_id = ? AND participant2_ap_id = ?)
  `).bind(actor.ap_id, otherApId, otherApId, actor.ap_id).first<any>();

  if (conversation) {
    // Get other participant info
    const otherInfo = await c.env.DB.prepare(`
      SELECT ap_id, preferred_username, name, icon_url FROM actors WHERE ap_id = ?
      UNION
      SELECT ap_id, preferred_username, name, icon_url FROM actor_cache WHERE ap_id = ?
    `).bind(otherApId, otherApId).first<any>();

    return c.json({
      conversation: {
        id: conversation.id,
        other_participant: {
          ap_id: otherApId,
          username: formatUsername(otherApId),
          preferred_username: otherInfo?.preferred_username,
          name: otherInfo?.name,
          icon_url: otherInfo?.icon_url,
        },
        last_message_at: conversation.last_message_at,
        created_at: conversation.created_at,
      }
    });
  }

  // Create new conversation with consistent ordering (alphabetically)
  const [participant1, participant2] = [actor.ap_id, otherApId].sort();
  const conversationId = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO dm_conversations (id, participant1_ap_id, participant2_ap_id, created_at)
    VALUES (?, ?, ?, ?)
  `).bind(conversationId, participant1, participant2, now).run();

  // Get other participant info
  const otherInfo = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url FROM actors WHERE ap_id = ?
    UNION
    SELECT ap_id, preferred_username, name, icon_url FROM actor_cache WHERE ap_id = ?
  `).bind(otherApId, otherApId).first<any>();

  return c.json({
    conversation: {
      id: conversationId,
      other_participant: {
        ap_id: otherApId,
        username: formatUsername(otherApId),
        preferred_username: otherInfo?.preferred_username,
        name: otherInfo?.name,
        icon_url: otherInfo?.icon_url,
      },
      last_message_at: null,
      created_at: now,
    }
  }, 201);
});

// Get messages in a conversation
dm.get('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const conversationId = c.req.param('id');
  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before');

  // Verify user is part of this conversation
  const conversation = await c.env.DB.prepare(`
    SELECT * FROM dm_conversations WHERE id = ? AND (participant1_ap_id = ? OR participant2_ap_id = ?)
  `).bind(conversationId, actor.ap_id, actor.ap_id).first<any>();

  if (!conversation) {
    return c.json({ error: 'Conversation not found or access denied' }, 404);
  }

  let query = `
    SELECT
      dm.id,
      dm.conversation_id,
      dm.sender_ap_id,
      dm.content,
      dm.created_at,
      COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
      COALESCE(a.name, ac.name) as sender_name,
      COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM dm_messages dm
    LEFT JOIN actors a ON dm.sender_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON dm.sender_ap_id = ac.ap_id
    WHERE dm.conversation_id = ?
  `;

  const params: any[] = [conversationId];

  if (before) {
    query += ` AND dm.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY dm.created_at DESC LIMIT ?`;
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all();

  // Reverse to get chronological order (oldest first)
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

// Send a message in a conversation
dm.post('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const conversationId = c.req.param('id');
  const body = await c.req.json<{ content: string }>();

  if (!body.content || body.content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }

  // Verify user is part of this conversation
  const conversation = await c.env.DB.prepare(`
    SELECT * FROM dm_conversations WHERE id = ? AND (participant1_ap_id = ? OR participant2_ap_id = ?)
  `).bind(conversationId, actor.ap_id, actor.ap_id).first<any>();

  if (!conversation) {
    return c.json({ error: 'Conversation not found or access denied' }, 404);
  }

  const messageId = generateId();
  const now = new Date().toISOString();

  // Insert message and update conversation last_message_at
  await c.env.DB.prepare(`
    INSERT INTO dm_messages (id, conversation_id, sender_ap_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(messageId, conversationId, actor.ap_id, body.content.trim(), now).run();

  await c.env.DB.prepare(`
    UPDATE dm_conversations SET last_message_at = ? WHERE id = ?
  `).bind(now, conversationId).run();

  return c.json({
    message: {
      id: messageId,
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

// ============================================================
// USER-BASED DM ENDPOINTS (no conversation creation needed)
// ============================================================

// Get messages with a specific user (by their ap_id)
dm.get('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before');

  // Find existing conversation
  const conversation = await c.env.DB.prepare(`
    SELECT id FROM dm_conversations
    WHERE (participant1_ap_id = ? AND participant2_ap_id = ?) OR (participant1_ap_id = ? AND participant2_ap_id = ?)
  `).bind(actor.ap_id, otherApId, otherApId, actor.ap_id).first<any>();

  if (!conversation) {
    // No conversation yet - return empty messages
    return c.json({ messages: [], conversation_id: null });
  }

  let query = `
    SELECT
      dm.id,
      dm.conversation_id,
      dm.sender_ap_id,
      dm.content,
      dm.created_at,
      COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
      COALESCE(a.name, ac.name) as sender_name,
      COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM dm_messages dm
    LEFT JOIN actors a ON dm.sender_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON dm.sender_ap_id = ac.ap_id
    WHERE dm.conversation_id = ?
  `;

  const params: any[] = [conversation.id];

  if (before) {
    query += ` AND dm.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY dm.created_at DESC LIMIT ?`;
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

  return c.json({ messages: result, conversation_id: conversation.id });
});

// Send message to a specific user (creates conversation if in contacts, or request if not)
dm.post('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const body = await c.req.json<{ content: string }>();

  if (!body.content || body.content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }

  // Verify other user exists
  const otherActor = await c.env.DB.prepare(`
    SELECT ap_id FROM actors WHERE ap_id = ?
  `).bind(otherApId).first();

  if (!otherActor) {
    return c.json({ error: 'User not found' }, 404);
  }

  const now = new Date().toISOString();

  // Check if sender is in their own dm_contacts (allowed to message directly)
  const isInMyContacts = await c.env.DB.prepare(`
    SELECT 1 FROM dm_contacts WHERE owner_ap_id = ? AND contact_ap_id = ?
  `).bind(actor.ap_id, otherApId).first();

  // Check if recipient has sender in their contacts (can receive direct message)
  const isInTheirContacts = await c.env.DB.prepare(`
    SELECT 1 FROM dm_contacts WHERE owner_ap_id = ? AND contact_ap_id = ?
  `).bind(otherApId, actor.ap_id).first();

  // If sender is not in recipient's contacts, create a message request
  if (!isInTheirContacts) {
    // Check if request already exists
    const existingRequest = await c.env.DB.prepare(`
      SELECT * FROM dm_requests WHERE recipient_ap_id = ? AND sender_ap_id = ?
    `).bind(otherApId, actor.ap_id).first<any>();

    if (existingRequest) {
      if (existingRequest.status === 'rejected') {
        return c.json({ error: 'Your message request was declined' }, 403);
      }
      return c.json({ error: 'Message request already sent' }, 400);
    }

    // Create message request
    const requestId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO dm_requests (id, recipient_ap_id, sender_ap_id, content, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).bind(requestId, otherApId, actor.ap_id, body.content.trim()).run();

    return c.json({
      request_sent: true,
      message: 'Message request sent. Waiting for approval.',
    }, 201);
  }

  // Direct message - recipient has sender in their contacts
  // Find or create conversation
  let conversation = await c.env.DB.prepare(`
    SELECT id FROM dm_conversations
    WHERE (participant1_ap_id = ? AND participant2_ap_id = ?) OR (participant1_ap_id = ? AND participant2_ap_id = ?)
  `).bind(actor.ap_id, otherApId, otherApId, actor.ap_id).first<any>();

  if (!conversation) {
    // Create new conversation
    const [participant1, participant2] = [actor.ap_id, otherApId].sort();
    const conversationId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO dm_conversations (id, participant1_ap_id, participant2_ap_id, created_at)
      VALUES (?, ?, ?, ?)
    `).bind(conversationId, participant1, participant2, now).run();
    conversation = { id: conversationId };
  }

  // Insert message
  const messageId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO dm_messages (id, conversation_id, sender_ap_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(messageId, conversation.id, actor.ap_id, body.content.trim(), now).run();

  await c.env.DB.prepare(`
    UPDATE dm_conversations SET last_message_at = ? WHERE id = ?
  `).bind(now, conversation.id).run();

  // Add sender to recipient's dm_contacts if not already (for reply)
  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO dm_contacts (owner_ap_id, contact_ap_id, added_reason)
    VALUES (?, ?, 'message_received')
  `).bind(otherApId, actor.ap_id).run();

  return c.json({
    message: {
      id: messageId,
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
    conversation_id: conversation.id,
  }, 201);
});

export default dm;
