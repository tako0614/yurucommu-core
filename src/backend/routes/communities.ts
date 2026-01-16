import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { communityApId, generateId, formatUsername, generateKeyPair } from '../utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();
const managerRoles = new Set(['owner', 'moderator']);

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
  `).bind(actor?.ap_id || '', actor?.ap_id || '', apId, identifier).first<any>();

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
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

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
  const values: any[] = [];

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

// POST /api/communities/:name/join - Join a community
communities.post('/:identifier/join', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  let inviteId: string | undefined;
  try {
    const body = await c.req.json<{ invite_id?: string }>();
    inviteId = body.invite_id?.trim() || undefined;
  } catch {
    inviteId = undefined;
  }

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

  if (community.join_policy === 'approval') {
    await c.env.DB.prepare(`
      INSERT INTO community_join_requests (community_ap_id, actor_ap_id, status, created_at, processed_at)
      VALUES (?, ?, 'pending', ?, NULL)
      ON CONFLICT(community_ap_id, actor_ap_id)
      DO UPDATE SET status = 'pending', created_at = excluded.created_at, processed_at = NULL
    `).bind(community.ap_id, actor.ap_id, now).run();

    return c.json({ success: true, status: 'pending' });
  }

  if (community.join_policy === 'invite') {
    if (!inviteId) {
      return c.json({ error: 'Invite required', status: 'invite_required' }, 403);
    }

    const invite = await c.env.DB.prepare(`
      SELECT * FROM community_invites
      WHERE id = ? AND community_ap_id = ? AND used_at IS NULL
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).bind(inviteId, community.ap_id).first<any>();

    if (!invite) {
      return c.json({ error: 'Invalid or expired invite', status: 'invite_required' }, 403);
    }

    if (invite.invited_ap_id && invite.invited_ap_id !== actor.ap_id) {
      return c.json({ error: 'Invite not for this account', status: 'invite_required' }, 403);
    }

    await c.env.DB.prepare(`
      INSERT INTO community_members (community_ap_id, actor_ap_id, role, joined_at)
      VALUES (?, ?, 'member', ?)
    `).bind(community.ap_id, actor.ap_id, now).run();

    await c.env.DB.prepare('UPDATE communities SET member_count = member_count + 1 WHERE ap_id = ?')
      .bind(community.ap_id).run();

    await c.env.DB.prepare(`
      UPDATE community_invites
      SET used_by_ap_id = ?, used_at = ?
      WHERE id = ?
    `).bind(actor.ap_id, now, inviteId).run();

    return c.json({ success: true, status: 'joined' });
  }

  // Open join
  await c.env.DB.prepare(`
    INSERT INTO community_members (community_ap_id, actor_ap_id, role, joined_at)
    VALUES (?, ?, 'member', ?)
  `).bind(community.ap_id, actor.ap_id, now).run();

  await c.env.DB.prepare('UPDATE communities SET member_count = member_count + 1 WHERE ap_id = ?')
    .bind(community.ap_id).run();

  return c.json({ success: true, status: 'joined' });
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

  // Don't allow the last owner to leave
  if (membership.role === 'owner') {
    const ownerCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'owner'"
    ).bind(community.ap_id).first<any>();
    if (ownerCount?.count <= 1) {
      return c.json({ error: 'Cannot leave: you are the only owner' }, 400);
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

// GET /api/communities/:name/requests - List pending join requests
communities.get('/:identifier/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const requests = await c.env.DB.prepare(`
    SELECT r.actor_ap_id, r.created_at,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url
    FROM community_join_requests r
    LEFT JOIN actors a ON r.actor_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON r.actor_ap_id = ac.ap_id
    WHERE r.community_ap_id = ? AND r.status = 'pending'
    ORDER BY r.created_at DESC
  `).bind(community.ap_id).all();

  const result = (requests.results || []).map((r: any) => ({
    ap_id: r.actor_ap_id,
    username: formatUsername(r.actor_ap_id),
    preferred_username: r.preferred_username,
    name: r.name,
    icon_url: r.icon_url,
    created_at: r.created_at,
  }));

  return c.json({ requests: result });
});

// POST /api/communities/:name/requests/accept - Accept join request
communities.post('/:identifier/requests/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ actor_ap_id: string }>();

  if (!body.actor_ap_id) {
    return c.json({ error: 'actor_ap_id required' }, 400);
  }

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const request = await c.env.DB.prepare(`
    SELECT * FROM community_join_requests
    WHERE community_ap_id = ? AND actor_ap_id = ? AND status = 'pending'
  `).bind(community.ap_id, body.actor_ap_id).first<any>();

  if (!request) {
    return c.json({ error: 'Join request not found' }, 404);
  }

  const existingMember = await c.env.DB.prepare(
    'SELECT 1 FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, body.actor_ap_id).first();

  if (!existingMember) {
    const now = new Date().toISOString();
    await c.env.DB.prepare(`
      INSERT INTO community_members (community_ap_id, actor_ap_id, role, joined_at)
      VALUES (?, ?, 'member', ?)
    `).bind(community.ap_id, body.actor_ap_id, now).run();

    await c.env.DB.prepare('UPDATE communities SET member_count = member_count + 1 WHERE ap_id = ?')
      .bind(community.ap_id).run();
  }

  await c.env.DB.prepare(`
    UPDATE community_join_requests
    SET status = 'accepted', processed_at = ?
    WHERE community_ap_id = ? AND actor_ap_id = ?
  `).bind(new Date().toISOString(), community.ap_id, body.actor_ap_id).run();

  return c.json({ success: true });
});

// POST /api/communities/:name/requests/reject - Reject join request
communities.post('/:identifier/requests/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ actor_ap_id: string }>();

  if (!body.actor_ap_id) {
    return c.json({ error: 'actor_ap_id required' }, 400);
  }

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const request = await c.env.DB.prepare(`
    SELECT * FROM community_join_requests
    WHERE community_ap_id = ? AND actor_ap_id = ? AND status = 'pending'
  `).bind(community.ap_id, body.actor_ap_id).first<any>();

  if (!request) {
    return c.json({ error: 'Join request not found' }, 404);
  }

  await c.env.DB.prepare(`
    UPDATE community_join_requests
    SET status = 'rejected', processed_at = ?
    WHERE community_ap_id = ? AND actor_ap_id = ?
  `).bind(new Date().toISOString(), community.ap_id, body.actor_ap_id).run();

  return c.json({ success: true });
});

// GET /api/communities/:identifier/invites - List invites
communities.get('/:identifier/invites', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const invites = await c.env.DB.prepare(`
    SELECT i.id, i.invited_ap_id, i.invited_by_ap_id, i.created_at, i.expires_at, i.used_at, i.used_by_ap_id,
           COALESCE(a.preferred_username, ac.preferred_username) as invited_by_username,
           COALESCE(a.name, ac.name) as invited_by_name
    FROM community_invites i
    LEFT JOIN actors a ON i.invited_by_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON i.invited_by_ap_id = ac.ap_id
    WHERE i.community_ap_id = ?
    ORDER BY i.created_at DESC
  `).bind(community.ap_id).all();

  const result = (invites.results || []).map((inv: any) => ({
    id: inv.id,
    invited_ap_id: inv.invited_ap_id,
    invited_by: {
      ap_id: inv.invited_by_ap_id,
      username: formatUsername(inv.invited_by_ap_id),
      preferred_username: inv.invited_by_username,
      name: inv.invited_by_name,
    },
    created_at: inv.created_at,
    expires_at: inv.expires_at,
    used_at: inv.used_at,
    used_by_ap_id: inv.used_by_ap_id,
    is_valid: !inv.used_at && (!inv.expires_at || new Date(inv.expires_at) > new Date()),
  }));

  return c.json({ invites: result });
});

// POST /api/communities/:name/invites - Create invite
communities.post('/:identifier/invites', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  let invitedApId: string | null = null;
  let expiresInHours: number | null = null;
  try {
    const body = await c.req.json<{ invited_ap_id?: string; expires_in_hours?: number }>();
    invitedApId = body.invited_ap_id?.trim() || null;
    expiresInHours = body.expires_in_hours || null;
  } catch {
    invitedApId = null;
    expiresInHours = null;
  }

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const inviteId = generateId();
  const now = new Date();
  const expiresAt = expiresInHours ? new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString() : null;

  await c.env.DB.prepare(`
    INSERT INTO community_invites (id, community_ap_id, invited_by_ap_id, invited_ap_id, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(inviteId, community.ap_id, actor.ap_id, invitedApId, now.toISOString(), expiresAt).run();

  return c.json({ invite_id: inviteId, expires_at: expiresAt });
});

// DELETE /api/communities/:identifier/invites/:inviteId - Revoke invite
communities.delete('/:identifier/invites/:inviteId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const inviteId = c.req.param('inviteId');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const member = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const invite = await c.env.DB.prepare(
    'SELECT id FROM community_invites WHERE id = ? AND community_ap_id = ?'
  ).bind(inviteId, community.ap_id).first();

  if (!invite) {
    return c.json({ error: 'Invite not found' }, 404);
  }

  await c.env.DB.prepare('DELETE FROM community_invites WHERE id = ?').bind(inviteId).run();

  return c.json({ success: true });
});

// GET /api/communities/:name/messages - Get chat messages (AP Native: uses objects with audience)
communities.get('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const limit = parseInt(c.req.query('limit') || '50');
  const before = c.req.query('before');

  // Get community
  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<any>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check membership
  const membership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  const policy = community.post_policy || 'members';
  const role = membership?.role;
  const isManager = role === 'owner' || role === 'moderator';

  if (policy !== 'anyone' && !membership) {
    return c.json({ error: 'Not a community member' }, 403);
  }
  if (policy === 'mods' && !isManager) {
    return c.json({ error: 'Moderator role required' }, 403);
  }
  if (policy === 'owners' && role !== 'owner') {
    return c.json({ error: 'Owner role required' }, 403);
  }

  // Query objects addressed to this community (via object_recipients or audience_json)
  let query = `
    SELECT o.ap_id, o.content, o.published,
           o.attributed_to,
           COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
           COALESCE(a.name, ac.name) as sender_name,
           COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.type = 'Note'
      AND EXISTS (
        SELECT 1 FROM object_recipients orec
        WHERE orec.object_ap_id = o.ap_id
          AND orec.recipient_ap_id = ?
          AND orec.type = 'audience'
      )
  `;
  const params: any[] = [community.ap_id];

  if (before) {
    query += ' AND o.published < ?';
    params.push(before);
  }

  query += ' ORDER BY o.published DESC LIMIT ?';
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all();

  const result = (messages.results || []).reverse().map((msg: any) => ({
    id: msg.ap_id,
    sender: {
      ap_id: msg.attributed_to,
      username: formatUsername(msg.attributed_to),
      preferred_username: msg.sender_preferred_username,
      name: msg.sender_name,
      icon_url: msg.sender_icon_url,
    },
    content: msg.content,
    created_at: msg.published,
  }));

  return c.json({ messages: result });
});

// POST /api/communities/:name/messages - Send a chat message (AP Native: creates Note addressed to Group)
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
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  const policy = community.post_policy || 'members';
  const role = membership?.role;
  const isManager = role === 'owner' || role === 'moderator';

  if (policy !== 'anyone' && !membership) {
    return c.json({ error: 'Not a member' }, 403);
  }
  if (policy === 'mods' && !isManager) {
    return c.json({ error: 'Moderator role required' }, 403);
  }
  if (policy === 'owners' && role !== 'owner') {
    return c.json({ error: 'Owner role required' }, 403);
  }

  const objectId = generateId();
  const objectApId = `${baseUrl}/ap/objects/${objectId}`;
  const now = new Date().toISOString();

  // Create Note object addressed to the Group (AP native)
  // to = [group followers/members], audience = [group]
  const toJson = JSON.stringify([community.ap_id]);
  const audienceJson = JSON.stringify([community.ap_id]);

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, to_json, audience_json, visibility, published, local)
    VALUES (?, 'Note', ?, ?, ?, ?, 'group', ?, 1)
  `).bind(objectApId, actor.ap_id, body.content.trim(), toJson, audienceJson, now).run();

  // Add to object_recipients for efficient querying
  await c.env.DB.prepare(`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (?, ?, 'audience', ?)
  `).bind(objectApId, community.ap_id, now).run();

  // Create Create activity
  const activityId = generateId();
  const activityApId = `${baseUrl}/ap/activities/${activityId}`;
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, to_json, published, local)
    VALUES (?, 'Create', ?, ?, ?, ?, 1)
  `).bind(activityApId, actor.ap_id, objectApId, toJson, now).run();

  // Update last_message_at
  await c.env.DB.prepare('UPDATE communities SET last_message_at = ? WHERE ap_id = ?')
    .bind(now, community.ap_id).run();

  return c.json({
    message: {
      id: objectApId,
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

// PATCH /api/communities/:identifier/messages/:messageId - Edit a message
communities.patch('/:identifier/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const messageId = decodeURIComponent(c.req.param('messageId'));
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ content: string }>();

  if (!body.content || body.content.trim() === '') {
    return c.json({ error: 'Message content is required' }, 400);
  }

  // Check community exists
  const community = await c.env.DB.prepare('SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<any>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community
  const message = await c.env.DB.prepare(`
    SELECT o.ap_id, o.attributed_to
    FROM objects o
    JOIN object_recipients orec ON o.ap_id = orec.object_ap_id
    WHERE o.ap_id = ? AND orec.recipient_ap_id = ? AND orec.type = 'audience'
  `).bind(messageId, community.ap_id).first<any>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only author can edit
  if (message.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Only the author can edit this message' }, 403);
  }

  // Update message
  await c.env.DB.prepare(`
    UPDATE objects SET content = ?, updated_at = datetime('now') WHERE ap_id = ?
  `).bind(body.content.trim(), messageId).run();

  return c.json({ success: true });
});

// DELETE /api/communities/:identifier/messages/:messageId - Delete a message
communities.delete('/:identifier/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const messageId = decodeURIComponent(c.req.param('messageId'));
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  // Check community exists
  const community = await c.env.DB.prepare('SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<any>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community
  const message = await c.env.DB.prepare(`
    SELECT o.ap_id, o.attributed_to
    FROM objects o
    JOIN object_recipients orec ON o.ap_id = orec.object_ap_id
    WHERE o.ap_id = ? AND orec.recipient_ap_id = ? AND orec.type = 'audience'
  `).bind(messageId, community.ap_id).first<any>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Check permission: author can delete, or moderator/owner can delete any
  const membership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  const isAuthor = message.attributed_to === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);

  if (!isAuthor && !isManager) {
    return c.json({ error: 'Permission denied' }, 403);
  }

  // Delete message
  await c.env.DB.prepare('DELETE FROM object_recipients WHERE object_ap_id = ?').bind(messageId).run();
  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?').bind(messageId).run();

  return c.json({ success: true });
});

// DELETE /api/communities/:identifier/members/:actorApId - Remove a member
communities.delete('/:identifier/members/:actorApId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const targetApId = decodeURIComponent(c.req.param('actorApId'));
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check if actor has permission to remove members
  const actorMembership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!actorMembership || !managerRoles.has(actorMembership.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Check target membership
  const targetMembership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, targetApId).first<any>();

  if (!targetMembership) {
    return c.json({ error: 'User is not a member' }, 404);
  }

  // Owners can only be removed by other owners
  if (targetMembership.role === 'owner' && actorMembership.role !== 'owner') {
    return c.json({ error: 'Only owners can remove other owners' }, 403);
  }

  // Can't remove yourself this way (use /leave instead)
  if (targetApId === actor.ap_id) {
    return c.json({ error: 'Use /leave endpoint to leave the community' }, 400);
  }

  // Remove member
  await c.env.DB.prepare('DELETE FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?')
    .bind(community.ap_id, targetApId).run();

  // Update member count
  await c.env.DB.prepare('UPDATE communities SET member_count = member_count - 1 WHERE ap_id = ? AND member_count > 0')
    .bind(community.ap_id).run();

  return c.json({ success: true });
});

// PATCH /api/communities/:identifier/members/:actorApId - Update member role
communities.patch('/:identifier/members/:actorApId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const targetApId = decodeURIComponent(c.req.param('actorApId'));
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ role: 'owner' | 'moderator' | 'member' }>();

  if (!body.role || !['owner', 'moderator', 'member'].includes(body.role)) {
    return c.json({ error: 'Invalid role' }, 400);
  }

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Only owners can change roles
  const actorMembership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!actorMembership || actorMembership.role !== 'owner') {
    return c.json({ error: 'Only owners can change member roles' }, 403);
  }

  // Check target membership
  const targetMembership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, targetApId).first<any>();

  if (!targetMembership) {
    return c.json({ error: 'User is not a member' }, 404);
  }

  // Can't demote yourself if you're the last owner
  if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
    const ownerCount = await c.env.DB.prepare(
      "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'owner'"
    ).bind(community.ap_id).first<any>();
    if (ownerCount?.count <= 1) {
      return c.json({ error: 'Cannot demote: you are the only owner' }, 400);
    }
  }

  // Update role
  await c.env.DB.prepare(
    'UPDATE community_members SET role = ? WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(body.role, community.ap_id, targetApId).run();

  return c.json({ success: true });
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

// POST /api/communities/:identifier/members/batch/remove - Bulk remove members
communities.post('/:identifier/members/batch/remove', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ actor_ap_ids: string[] }>();

  if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
    return c.json({ error: 'actor_ap_ids array is required' }, 400);
  }

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check permissions
  const actorMembership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!actorMembership || !managerRoles.has(actorMembership.role)) {
    return c.json({ error: 'Permission denied' }, 403);
  }

  const results: { ap_id: string; success: boolean; error?: string }[] = [];

  for (const targetApId of body.actor_ap_ids) {
    try {
      // Can't remove yourself via batch
      if (targetApId === actor.ap_id) {
        results.push({ ap_id: targetApId, success: false, error: 'Cannot remove yourself' });
        continue;
      }

      // Check target membership
      const targetMembership = await c.env.DB.prepare(
        'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
      ).bind(community.ap_id, targetApId).first<any>();

      if (!targetMembership) {
        results.push({ ap_id: targetApId, success: false, error: 'Not a member' });
        continue;
      }

      // Non-owners can't remove owners
      if (actorMembership.role !== 'owner' && targetMembership.role === 'owner') {
        results.push({ ap_id: targetApId, success: false, error: 'Cannot remove owner' });
        continue;
      }

      // Remove member
      await c.env.DB.prepare('DELETE FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?')
        .bind(community.ap_id, targetApId).run();

      results.push({ ap_id: targetApId, success: true });
    } catch (e) {
      results.push({ ap_id: targetApId, success: false, error: 'Internal error' });
    }
  }

  // Update member count
  const removedCount = results.filter(r => r.success).length;
  if (removedCount > 0) {
    await c.env.DB.prepare('UPDATE communities SET member_count = member_count - ? WHERE ap_id = ?')
      .bind(removedCount, community.ap_id).run();
  }

  return c.json({ results, removed_count: removedCount });
});

// POST /api/communities/:identifier/members/batch/role - Bulk update member roles
communities.post('/:identifier/members/batch/role', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ actor_ap_ids: string[]; role: 'owner' | 'moderator' | 'member' }>();

  if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
    return c.json({ error: 'actor_ap_ids array is required' }, 400);
  }
  if (!body.role || !['owner', 'moderator', 'member'].includes(body.role)) {
    return c.json({ error: 'Valid role is required' }, 400);
  }

  const community = await c.env.DB.prepare(
    'SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?'
  ).bind(apId, identifier).first<any>();

  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Only owners can change roles
  const actorMembership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<any>();

  if (!actorMembership || actorMembership.role !== 'owner') {
    return c.json({ error: 'Only owners can change roles' }, 403);
  }

  const results: { ap_id: string; success: boolean; error?: string }[] = [];

  for (const targetApId of body.actor_ap_ids) {
    try {
      // Check target membership
      const targetMembership = await c.env.DB.prepare(
        'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
      ).bind(community.ap_id, targetApId).first<any>();

      if (!targetMembership) {
        results.push({ ap_id: targetApId, success: false, error: 'Not a member' });
        continue;
      }

      // Can't demote yourself if you're the last owner
      if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
        const ownerCount = await c.env.DB.prepare(
          "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'owner'"
        ).bind(community.ap_id).first<any>();
        if (ownerCount?.count <= 1) {
          results.push({ ap_id: targetApId, success: false, error: 'Cannot demote: only owner' });
          continue;
        }
      }

      // Update role
      await c.env.DB.prepare(
        'UPDATE community_members SET role = ? WHERE community_ap_id = ? AND actor_ap_id = ?'
      ).bind(body.role, community.ap_id, targetApId).run();

      results.push({ ap_id: targetApId, success: true });
    } catch (e) {
      results.push({ ap_id: targetApId, success: false, error: 'Internal error' });
    }
  }

  return c.json({ results, updated_count: results.filter(r => r.success).length });
});

export default communities;
