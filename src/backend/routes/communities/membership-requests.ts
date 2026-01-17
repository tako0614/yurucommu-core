import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { formatUsername } from '../../utils';
import { managerRoles } from './utils';
import {
  CommunityMemberRow,
  JoinRequestRow,
  MembershipContext,
  fetchCommunityId,
} from './membership-shared';

export function registerMembershipRequestRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // GET /api/communities/:identifier/requests - List pending join requests
  communities.get('/:identifier/requests', async (c: MembershipContext) => {
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

    const result = (requests.results || []).map((r: JoinRequestRow) => ({
      ap_id: r.actor_ap_id,
      username: formatUsername(r.actor_ap_id),
      preferred_username: r.preferred_username,
      name: r.name,
      icon_url: r.icon_url,
      created_at: r.created_at,
    }));

    return c.json({ requests: result });
  });

  // POST /api/communities/:identifier/requests/accept - Accept join request
  communities.post('/:identifier/requests/accept', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const body = await c.req.json<{ actor_ap_id: string }>();

    if (!body.actor_ap_id) {
      return c.json({ error: 'actor_ap_id required' }, 400);
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

    const request = await c.env.DB.prepare(`
      SELECT * FROM community_join_requests
      WHERE community_ap_id = ? AND actor_ap_id = ? AND status = 'pending'
    `).bind(community.ap_id, body.actor_ap_id).first<JoinRequestRow>();

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

  // POST /api/communities/:identifier/requests/reject - Reject join request
  communities.post('/:identifier/requests/reject', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const body = await c.req.json<{ actor_ap_id: string }>();

    if (!body.actor_ap_id) {
      return c.json({ error: 'actor_ap_id required' }, 400);
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

    const request = await c.env.DB.prepare(`
      SELECT * FROM community_join_requests
      WHERE community_ap_id = ? AND actor_ap_id = ? AND status = 'pending'
    `).bind(community.ap_id, body.actor_ap_id).first<JoinRequestRow>();

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
}
