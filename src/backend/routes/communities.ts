import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { communityApId, generateId, formatUsername } from '../utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/communities - List all communities
communities.get('/', async (c) => {
  const actor = c.get('actor');

  const result = await c.env.DB.prepare(`
    SELECT c.ap_id, c.preferred_username, c.name, c.summary, c.icon_url, c.visibility, c.join_policy, c.post_policy, c.member_count, c.created_at, c.last_message_at,
           CASE WHEN cm.actor_ap_id IS NOT NULL THEN 1 ELSE 0 END as is_member
    FROM communities c
    LEFT JOIN community_members cm ON c.ap_id = cm.community_ap_id AND cm.actor_ap_id = ?
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at ASC
  `).bind(actor?.ap_id || '').all();

  const communitiesList = (result.results || []).map((community: any) => ({
    ap_id: community.ap_id,
    name: community.preferred_username,
    display_name: community.name,
    summary: community.summary,
    icon_url: community.icon_url,
    visibility: community.visibility,
    join_policy: community.join_policy,
    post_policy: community.post_policy,
    member_count: community.member_count,
    created_at: community.created_at,
    last_message_at: community.last_message_at,
    is_member: !!community.is_member,
  }));

  return c.json({ communities: communitiesList });
});

// POST /api/communities - Create a new community
communities.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    name: string;
    display_name?: string;
    summary?: string;
  }>();

  if (!body.name || body.name.trim().length < 2) {
    return c.json({ error: 'Name must be at least 2 characters' }, 400);
  }

  // Validate name format (alphanumeric and underscores only)
  if (!/^[a-zA-Z0-9_]+$/.test(body.name)) {
    return c.json({ error: 'Name can only contain letters, numbers, and underscores' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const apId = communityApId(baseUrl, body.name);
  const now = new Date().toISOString();

  // Check if community name already exists
  const existing = await c.env.DB.prepare('SELECT ap_id FROM communities WHERE preferred_username = ?')
    .bind(body.name).first();
  if (existing) {
    return c.json({ error: 'Community name already taken' }, 409);
  }

  // Create community
  await c.env.DB.prepare(`
    INSERT INTO communities (ap_id, preferred_username, name, summary, visibility, join_policy, post_policy, member_count, created_by, created_at)
    VALUES (?, ?, ?, ?, 'public', 'open', 'members', 1, ?, ?)
  `).bind(apId, body.name, body.display_name || body.name, body.summary || '', actor.ap_id, now).run();

  // Add creator as member
  await c.env.DB.prepare(`
    INSERT INTO community_members (id, community_ap_id, actor_ap_id, role, joined_at)
    VALUES (?, ?, ?, 'admin', ?)
  `).bind(generateId(), apId, actor.ap_id, now).run();

  return c.json({
    community: {
      ap_id: apId,
      name: body.name,
      display_name: body.display_name || body.name,
      summary: body.summary || '',
      icon_url: null,
      visibility: 'public',
      join_policy: 'open',
      post_policy: 'members',
      member_count: 1,
      created_at: now,
      is_member: true,
    }
  }, 201);
});

// GET /api/communities/:name - Get community by name or ap_id
communities.get('/:identifier', async (c) => {
  const identifier = c.req.param('identifier');
  const actor = c.get('actor');
  const baseUrl = c.env.APP_URL;

  // Check if identifier is a full AP ID or just a name/username
  let apId: string;
  if (identifier.startsWith('http')) {
    apId = identifier;
  } else {
    apId = communityApId(baseUrl, identifier);
  }

  // Try to fetch the community
  const community = await c.env.DB.prepare(`
    SELECT c.*,
           CASE WHEN cm.actor_ap_id IS NOT NULL THEN 1 ELSE 0 END as is_member,
           cm.role as member_role
    FROM communities c
    LEFT JOIN community_members cm ON c.ap_id = cm.community_ap_id AND cm.actor_ap_id = ?
    WHERE c.ap_id = ? OR c.preferred_username = ?
  `).bind(actor?.ap_id || '', apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Get member count (for verification)
  const memberCountResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ?
  `).bind(community.ap_id).first<any>();

  // Get posts in this community
  const postsResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM objects WHERE community_ap_id = ?
  `).bind(community.ap_id).first<any>();

  return c.json({
    community: {
      ap_id: community.ap_id,
      name: community.preferred_username,
      display_name: community.name,
      summary: community.summary,
      icon_url: community.icon_url,
      visibility: community.visibility,
      join_policy: community.join_policy,
      post_policy: community.post_policy,
      member_count: memberCountResult?.count || community.member_count || 0,
      post_count: postsResult?.count || 0,
      created_by: community.created_by,
      created_at: community.created_at,
      is_member: !!community.is_member,
      member_role: community.member_role || null,
    }
  });
});

// POST /api/communities/:name/join - Join a community
communities.post('/:identifier/join', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  // Check community exists
  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<any>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check if already member
  const existing = await c.env.DB.prepare(
    'SELECT * FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first();
  if (existing) {
    return c.json({ error: 'Already a member' }, 409);
  }

  const now = new Date().toISOString();

  // Add member
  await c.env.DB.prepare(`
    INSERT INTO community_members (id, community_ap_id, actor_ap_id, role, joined_at)
    VALUES (?, ?, ?, 'member', ?)
  `).bind(generateId(), community.ap_id, actor.ap_id, now).run();

  // Update member count
  await c.env.DB.prepare('UPDATE communities SET member_count = member_count + 1 WHERE ap_id = ?')
    .bind(community.ap_id).run();

  return c.json({ success: true });
});

// POST /api/communities/:name/leave - Leave a community
communities.post('/:identifier/leave', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  // Check community exists
  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<any>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check membership
  const membership = await c.env.DB.prepare(
    'SELECT * FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();
  if (!membership) {
    return c.json({ error: 'Not a member' }, 400);
  }

  // Don't allow admin to leave if they're the only admin
  if (membership.role === 'admin') {
    const adminCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'admin'"
    ).bind(community.ap_id).first<any>();
    if (adminCount?.count <= 1) {
      return c.json({ error: 'Cannot leave: you are the only admin' }, 400);
    }
  }

  // Remove member
  await c.env.DB.prepare('DELETE FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?')
    .bind(community.ap_id, actor.ap_id).run();

  // Update member count
  await c.env.DB.prepare('UPDATE communities SET member_count = member_count - 1 WHERE ap_id = ? AND member_count > 0')
    .bind(community.ap_id).run();

  return c.json({ success: true });
});

// GET /api/communities/:name/messages - Get chat messages
communities.get('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before');

  // Check membership
  const membership = await c.env.DB.prepare(`
    SELECT cm.* FROM community_members cm
    JOIN communities c ON cm.community_ap_id = c.ap_id
    WHERE (c.ap_id = ? OR c.preferred_username = ?) AND cm.actor_ap_id = ?
  `).bind(apId, identifier, actor.ap_id).first();
  if (!membership) {
    return c.json({ error: 'Not a member' }, 403);
  }

  let query = `
    SELECT cm.*,
           COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
           COALESCE(a.name, ac.name) as sender_name,
           COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM community_messages cm
    LEFT JOIN actors a ON cm.sender_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON cm.sender_ap_id = ac.ap_id
    JOIN communities c ON cm.community_ap_id = c.ap_id
    WHERE c.ap_id = ? OR c.preferred_username = ?
  `;
  const params: any[] = [apId, identifier];

  if (before) {
    query += ' AND cm.created_at < ?';
    params.push(before);
  }

  query += ' ORDER BY cm.created_at DESC LIMIT ?';
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

// POST /api/communities/:name/messages - Send a chat message
communities.post('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ content: string }>();

  if (!body.content || body.content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }

  // Check community exists and user is member
  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<any>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const membership = await c.env.DB.prepare(
    'SELECT * FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first();
  if (!membership) {
    return c.json({ error: 'Not a member' }, 403);
  }

  const messageId = generateId();
  const now = new Date().toISOString();

  // Insert message
  await c.env.DB.prepare(`
    INSERT INTO community_messages (id, community_ap_id, sender_ap_id, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(messageId, community.ap_id, actor.ap_id, body.content.trim(), now).run();

  // Update last_message_at
  await c.env.DB.prepare('UPDATE communities SET last_message_at = ? WHERE ap_id = ?')
    .bind(now, community.ap_id).run();

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

// GET /api/communities/:name/members - List members
communities.get('/:identifier/members', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const members = await c.env.DB.prepare(`
    SELECT cm.role, cm.joined_at,
           COALESCE(a.ap_id, ac.ap_id) as actor_ap_id,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url
    FROM community_members cm
    LEFT JOIN actors a ON cm.actor_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON cm.actor_ap_id = ac.ap_id
    JOIN communities c ON cm.community_ap_id = c.ap_id
    WHERE c.ap_id = ? OR c.preferred_username = ?
    ORDER BY cm.role DESC, cm.joined_at ASC
  `).bind(apId, identifier).all();

  const result = (members.results || []).map((m: any) => ({
    ap_id: m.actor_ap_id,
    username: formatUsername(m.actor_ap_id),
    preferred_username: m.preferred_username,
    name: m.name,
    icon_url: m.icon_url,
    role: m.role,
    joined_at: m.joined_at,
  }));

  return c.json({ members: result });
});

export default communities;
