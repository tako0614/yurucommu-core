import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, formatUsername } from '../../utils';
import { managerRoles } from './utils';
import {
  CommunityMemberRow,
  InviteRow,
  MembershipContext,
  fetchCommunityId,
} from './membership-shared';

export function registerMembershipInviteRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // GET /api/communities/:identifier/invites - List invites
  communities.get('/:identifier/invites', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const member = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

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
    `).bind(community.ap_id).all<InviteRow>();

    const result = (invites.results || []).map((inv: InviteRow) => ({
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

  // POST /api/communities/:identifier/invites - Create invite
  communities.post('/:identifier/invites', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
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

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const member = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

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
  communities.delete('/:identifier/invites/:inviteId', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const inviteId = c.req.param('inviteId');

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const member = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

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
}
