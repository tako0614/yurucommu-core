import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId } from '../../utils';
import {
  CommunityMemberRow,
  CountRow,
  InviteCheckRow,
  MembershipContext,
  fetchCommunityDetails,
} from './membership-shared';

export function registerMembershipJoinRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // POST /api/communities/:identifier/join - Join a community
  communities.post('/:identifier/join', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');

    let inviteId: string | undefined;
    try {
      const body = await c.req.json<{ invite_id?: string }>();
      inviteId = body.invite_id?.trim() || undefined;
    } catch {
      inviteId = undefined;
    }

    // Check community exists
    const { community } = await fetchCommunityDetails(c, identifier);
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
      `).bind(inviteId, community.ap_id).first<InviteCheckRow>();

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

  // POST /api/communities/:identifier/leave - Leave a community
  communities.post('/:identifier/leave', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');

    // Check community exists
    const { community } = await fetchCommunityDetails(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check membership
    const membership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();
    if (!membership) {
      return c.json({ error: 'Not a member' }, 400);
    }

    // Don't allow the last owner to leave
    if (membership.role === 'owner') {
      const ownerCount = await c.env.DB.prepare(
        "SELECT COUNT(*) as count FROM community_members WHERE community_ap_id = ? AND role = 'owner'"
      ).bind(community.ap_id).first<CountRow>();
      if ((ownerCount?.count ?? 0) <= 1) {
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
}

