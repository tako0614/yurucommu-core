import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId, generateKeyPair } from '../../utils';
import { managerRoles } from './utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

type CommunityListRow = {
  ap_id: string;
  preferred_username: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  visibility: string;
  join_policy: string;
  post_policy: string;
  member_count: number;
  created_at: string;
  last_message_at: string | null;
  is_member: number;
  join_status: string | null;
};

type CommunityDetailRow = {
  ap_id: string;
  preferred_username: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  visibility: string;
  join_policy: string;
  post_policy: string;
  member_count: number;
  created_by: string;
  created_at: string;
  is_member: number;
  member_role: string | null;
  join_status: string | null;
};

type CommunityIdRow = {
  ap_id: string;
};

type CommunityMemberRow = {
  role: 'owner' | 'moderator' | 'member';
};

type CountRow = {
  count: number;
};

// GET /api/communities - List all communities
communities.get('/', async (c) => {
  const actor = c.get('actor');

  const result = await c.env.DB.prepare(`
    SELECT c.ap_id, c.preferred_username, c.name, c.summary, c.icon_url, c.visibility, c.join_policy, c.post_policy, c.member_count, c.created_at, c.last_message_at,
           CASE WHEN cm.actor_ap_id IS NOT NULL THEN 1 ELSE 0 END as is_member,
           cjr.status as join_status
    FROM communities c
    LEFT JOIN community_members cm ON c.ap_id = cm.community_ap_id AND cm.actor_ap_id = ?
    LEFT JOIN community_join_requests cjr
      ON c.ap_id = cjr.community_ap_id AND cjr.actor_ap_id = ? AND cjr.status = 'pending'
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at ASC
  `).bind(actor?.ap_id || '', actor?.ap_id || '').all();

  const communitiesList = (result.results || []).map((community: CommunityListRow) => ({
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
    join_status: community.join_status || null,
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

  // Generate AP endpoints
  const inbox = `${apId}/inbox`;
  const outbox = `${apId}/outbox`;
  const followersUrl = `${apId}/followers`;

  // Generate key pair for ActivityPub
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // Check if community name already exists
  const existing = await c.env.DB.prepare('SELECT ap_id FROM communities WHERE preferred_username = ?')
    .bind(body.name).first();
  if (existing) {
    return c.json({ error: 'Community name already taken' }, 409);
  }

  // Create community
  await c.env.DB.prepare(`
    INSERT INTO communities (ap_id, preferred_username, name, summary, inbox, outbox, followers_url, public_key_pem, private_key_pem, visibility, join_policy, post_policy, member_count, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'public', 'open', 'members', 1, ?, ?)
  `).bind(apId, body.name, body.display_name || body.name, body.summary || '', inbox, outbox, followersUrl, publicKeyPem, privateKeyPem, actor.ap_id, now).run();

  // Add creator as member (owner role)
  await c.env.DB.prepare(`
    INSERT INTO community_members (community_ap_id, actor_ap_id, role, joined_at)
    VALUES (?, ?, 'owner', ?)
  `).bind(apId, actor.ap_id, now).run();

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
           cm.role as member_role,
           cjr.status as join_status
    FROM communities c
    LEFT JOIN community_members cm ON c.ap_id = cm.community_ap_id AND cm.actor_ap_id = ?
    LEFT JOIN community_join_requests cjr
      ON c.ap_id = cjr.community_ap_id AND cjr.actor_ap_id = ? AND cjr.status = 'pending'
    WHERE c.ap_id = ? OR c.preferred_username = ?
  `).bind(actor?.ap_id || '', actor?.ap_id || '', apId, identifier).first<CommunityDetailRow>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Get member count (for verification)
  const memberCountResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ?
  `).bind(community.ap_id).first<CountRow>();

  // Get posts in this community
  const postsResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as count FROM objects WHERE community_ap_id = ?
  `).bind(community.ap_id).first<CountRow>();

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
      join_status: community.join_status || null,
    }
  });
});

// PATCH /api/communities/:identifier/settings - Update community settings
communities.patch('/:identifier/settings', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<CommunityIdRow>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{
    display_name?: string;
    summary?: string;
    icon_url?: string;
    visibility?: 'public' | 'private';
    join_policy?: 'open' | 'approval' | 'invite';
    post_policy?: 'anyone' | 'members' | 'mods' | 'owners';
  }>();

  const updates: string[] = [];
  const values: Array<string | number | null> = [];

  if (body.display_name !== undefined) {
    updates.push('name = ?');
    values.push(body.display_name);
  }
  if (body.summary !== undefined) {
    updates.push('summary = ?');
    values.push(body.summary);
  }
  if (body.icon_url !== undefined) {
    updates.push('icon_url = ?');
    values.push(body.icon_url);
  }
  if (body.visibility !== undefined) {
    if (!['public', 'private'].includes(body.visibility)) {
      return c.json({ error: 'Invalid visibility' }, 400);
    }
    updates.push('visibility = ?');
    values.push(body.visibility);
  }
  if (body.join_policy !== undefined) {
    if (!['open', 'approval', 'invite'].includes(body.join_policy)) {
      return c.json({ error: 'Invalid join_policy' }, 400);
    }
    updates.push('join_policy = ?');
    values.push(body.join_policy);
  }
  if (body.post_policy !== undefined) {
    if (!['anyone', 'members', 'mods', 'owners'].includes(body.post_policy)) {
      return c.json({ error: 'Invalid post_policy' }, 400);
    }
    updates.push('post_policy = ?');
    values.push(body.post_policy);
  }

  if (updates.length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  values.push(community.ap_id);
  await c.env.DB.prepare(`UPDATE communities SET ${updates.join(', ')} WHERE ap_id = ?`)
    .bind(...values).run();

  return c.json({ success: true });
});


export default communities;
