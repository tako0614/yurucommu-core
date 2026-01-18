import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { formatUsername } from '../../utils';
import { managerRoles } from './utils';
import {
  CommunityMemberRow,
  CountRow,
  MemberListRow,
  MembershipContext,
  fetchCommunityId,
  resolveCommunityApId,
} from './membership-shared';

export function registerMembershipMemberRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // DELETE /api/communities/:identifier/members/:actorApId - Remove a member
  communities.delete('/:identifier/members/:actorApId', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const targetApId = decodeURIComponent(c.req.param('actorApId'));

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check if actor has permission to remove members
    const actorMembership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

    if (!actorMembership || !managerRoles.has(actorMembership.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Check target membership
    const targetMembership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, targetApId).first<CommunityMemberRow>();

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
  communities.patch('/:identifier/members/:actorApId', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const targetApId = decodeURIComponent(c.req.param('actorApId'));
    const body = await c.req.json<{ role: 'owner' | 'moderator' | 'member' }>();

    if (!body.role || !['owner', 'moderator', 'member'].includes(body.role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Only owners can change roles
    const actorMembership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

    if (!actorMembership || actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can change member roles' }, 403);
    }

    // Check target membership
    const targetMembership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, targetApId).first<CommunityMemberRow>();

    if (!targetMembership) {
      return c.json({ error: 'User is not a member' }, 404);
    }

    // Can't demote yourself if you're the last owner
    if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'owner'"
      ).bind(community.ap_id).first<CountRow>();
      if ((ownerCount?.count ?? 0) <= 1) {
        return c.json({ error: 'Cannot demote: you are the only owner' }, 400);
      }
    }

    // Update role
    await c.env.DB.prepare(
      'UPDATE community_members SET role = ? WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(body.role, community.ap_id, targetApId).run();

    return c.json({ success: true });
  });

  // GET /api/communities/:identifier/members - List members
  communities.get('/:identifier/members', async (c: MembershipContext) => {
    const identifier = c.req.param('identifier');
    const baseUrl = c.env.APP_URL;
    const apId = resolveCommunityApId(baseUrl, identifier);

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
    `).bind(apId, identifier).all<MemberListRow>();

    const result = (members.results || []).map((m) => ({
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
  communities.post('/:identifier/members/batch/remove', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const body = await c.req.json<{ actor_ap_ids: string[] }>();

    if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
      return c.json({ error: 'actor_ap_ids array is required' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check permissions
    const actorMembership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

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
        ).bind(community.ap_id, targetApId).first<CommunityMemberRow>();

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
    const removedCount = results.filter((r) => r.success).length;
    if (removedCount > 0) {
      await c.env.DB.prepare('UPDATE communities SET member_count = member_count - ? WHERE ap_id = ?')
        .bind(removedCount, community.ap_id).run();
    }

    return c.json({ results, removed_count: removedCount });
  });

  // POST /api/communities/:identifier/members/batch/role - Bulk update member roles
  communities.post('/:identifier/members/batch/role', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const body = await c.req.json<{ actor_ap_ids: string[]; role: 'owner' | 'moderator' | 'member' }>();

    if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
      return c.json({ error: 'actor_ap_ids array is required' }, 400);
    }
    if (!body.role || !['owner', 'moderator', 'member'].includes(body.role)) {
      return c.json({ error: 'Valid role is required' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Only owners can change roles
    const actorMembership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

    if (!actorMembership || actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can change roles' }, 403);
    }

    const results: { ap_id: string; success: boolean; error?: string }[] = [];

    for (const targetApId of body.actor_ap_ids) {
      try {
        // Check target membership
        const targetMembership = await c.env.DB.prepare(
          'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
        ).bind(community.ap_id, targetApId).first<CommunityMemberRow>();

        if (!targetMembership) {
          results.push({ ap_id: targetApId, success: false, error: 'Not a member' });
          continue;
        }

        // Can't demote yourself if you're the last owner
        if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
          const ownerCount = await c.env.DB.prepare(
            "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'owner'"
          ).bind(community.ap_id).first<CountRow>();
          if ((ownerCount?.count ?? 0) <= 1) {
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

    return c.json({ results, updated_count: results.filter((r) => r.success).length });
  });
}






