import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId, generateId, formatUsername } from '../../utils';
import { managerRoles } from './utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

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

export default communities;
