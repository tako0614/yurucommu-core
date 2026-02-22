import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { formatUsername, parseLimit, parseOffset } from '../../utils';
import {
  MembershipContext,
  batchLoadActorInfo,
  fetchCommunityId,
  memberKey,
  requireManager,
  resolveCommunityApId,
} from './membership-shared';

const MAX_MEMBER_BATCH_SIZE = 100;

function validateBatchApIds(ids: unknown): string | null {
  if (!Array.isArray(ids) || ids.length === 0) return 'actor_ap_ids array is required';
  if (ids.some((id) => typeof id !== 'string' || id.trim().length === 0)) return 'actor_ap_ids array is required';
  if (ids.length > MAX_MEMBER_BATCH_SIZE) return `Batch size exceeds maximum of ${MAX_MEMBER_BATCH_SIZE}`;
  return null;
}

export function registerMembershipMemberRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // DELETE /api/communities/:identifier/members/:actorApId - Remove a member
  communities.delete('/:identifier/members/:actorApId', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const targetApId = decodeURIComponent(c.req.param('actorApId'));
    const prisma = c.get('prisma');

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const actorMembership = await requireManager(prisma, community.apId, actor.ap_id);
    if (!actorMembership) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    if (targetApId === actor.ap_id) {
      return c.json({ error: 'Use /leave endpoint to leave the community' }, 400);
    }

    const targetMembership = await prisma.communityMember.findUnique({
      where: memberKey(community.apId, targetApId),
    });
    if (!targetMembership) {
      return c.json({ error: 'User is not a member' }, 404);
    }

    if (targetMembership.role === 'owner' && actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can remove other owners' }, 403);
    }

    await prisma.$transaction(async (tx) => {
      await tx.communityMember.delete({
        where: memberKey(community.apId, targetApId),
      });
      await tx.community.update({
        where: { apId: community.apId },
        data: { memberCount: { decrement: 1 } },
      });
    });

    return c.json({ success: true });
  });

  // PATCH /api/communities/:identifier/members/:actorApId - Update member role
  communities.patch('/:identifier/members/:actorApId', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const targetApId = decodeURIComponent(c.req.param('actorApId'));
    const prisma = c.get('prisma');
    const body = await c.req.json<{ role: 'owner' | 'moderator' | 'member' }>();

    if (!body.role || !['owner', 'moderator', 'member'].includes(body.role)) {
      return c.json({ error: 'Invalid role' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Only owners can change roles
    const actorMembership = await prisma.communityMember.findUnique({
      where: memberKey(community.apId, actor.ap_id),
    });
    if (!actorMembership || actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can change member roles' }, 403);
    }

    const targetMembership = await prisma.communityMember.findUnique({
      where: memberKey(community.apId, targetApId),
    });
    if (!targetMembership) {
      return c.json({ error: 'User is not a member' }, 404);
    }

    // Can't demote yourself if you're the last owner
    if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await prisma.communityMember.count({
        where: { communityApId: community.apId, role: 'owner' },
      });
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot demote: you are the only owner' }, 400);
      }
    }

    await prisma.communityMember.update({
      where: memberKey(community.apId, targetApId),
      data: { role: body.role },
    });

    return c.json({ success: true });
  });

  // GET /api/communities/:identifier/members - List members
  communities.get('/:identifier/members', async (c: MembershipContext) => {
    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
    const baseUrl = c.env.APP_URL;
    const apId = resolveCommunityApId(baseUrl, identifier);
    const limit = parseLimit(c.req.query('limit'), 100, 500);
    const offset = parseOffset(c.req.query('offset'), 0, 10000);

    const community = await prisma.community.findFirst({
      where: { OR: [{ apId }, { preferredUsername: identifier }] },
      select: { apId: true },
    });
    if (!community) {
      return c.json({ members: [] });
    }

    const members = await prisma.communityMember.findMany({
      where: { communityApId: community.apId },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }],
      take: limit,
      skip: offset,
    });

    const memberApIds = members.map((m) => m.actorApId);
    const actorInfoMap = await batchLoadActorInfo(prisma, memberApIds);

    const result = members.map((m) => {
      const actorInfo = actorInfoMap.get(m.actorApId);
      return {
        ap_id: m.actorApId,
        username: formatUsername(m.actorApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null,
        role: m.role,
        joined_at: m.joinedAt,
      };
    });

    return c.json({ members: result });
  });

  // POST /api/communities/:identifier/members/batch/remove - Bulk remove members
  communities.post('/:identifier/members/batch/remove', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
    const body = await c.req.json<{ actor_ap_ids: string[] }>();

    const validationError = validateBatchApIds(body.actor_ap_ids);
    if (validationError) return c.json({ error: validationError }, 400);

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const actorMembership = await requireManager(prisma, community.apId, actor.ap_id);
    if (!actorMembership) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const results: { ap_id: string; success: boolean; error?: string }[] = [];

    for (const targetApId of body.actor_ap_ids) {
      try {
        if (targetApId === actor.ap_id) {
          results.push({ ap_id: targetApId, success: false, error: 'Cannot remove yourself' });
          continue;
        }

        const targetMembership = await prisma.communityMember.findUnique({
          where: memberKey(community.apId, targetApId),
        });
        if (!targetMembership) {
          results.push({ ap_id: targetApId, success: false, error: 'Not a member' });
          continue;
        }

        if (actorMembership.role !== 'owner' && targetMembership.role === 'owner') {
          results.push({ ap_id: targetApId, success: false, error: 'Cannot remove owner' });
          continue;
        }

        await prisma.$transaction(async (tx) => {
          await tx.communityMember.delete({
            where: memberKey(community.apId, targetApId),
          });
          await tx.community.update({
            where: { apId: community.apId },
            data: { memberCount: { decrement: 1 } },
          });
        });

        results.push({ ap_id: targetApId, success: true });
      } catch {
        results.push({ ap_id: targetApId, success: false, error: 'Internal error' });
      }
    }

    const removedCount = results.filter((r) => r.success).length;
    return c.json({ results, removed_count: removedCount });
  });

  // POST /api/communities/:identifier/members/batch/role - Bulk update member roles
  communities.post('/:identifier/members/batch/role', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
    const body = await c.req.json<{ actor_ap_ids: string[]; role: 'owner' | 'moderator' | 'member' }>();

    const validationError = validateBatchApIds(body.actor_ap_ids);
    if (validationError) return c.json({ error: validationError }, 400);

    if (!body.role || !['owner', 'moderator', 'member'].includes(body.role)) {
      return c.json({ error: 'Valid role is required' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Only owners can change roles
    const actorMembership = await prisma.communityMember.findUnique({
      where: memberKey(community.apId, actor.ap_id),
    });
    if (!actorMembership || actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can change roles' }, 403);
    }

    const results: { ap_id: string; success: boolean; error?: string }[] = [];

    for (const targetApId of body.actor_ap_ids) {
      try {
        const targetMembership = await prisma.communityMember.findUnique({
          where: memberKey(community.apId, targetApId),
        });
        if (!targetMembership) {
          results.push({ ap_id: targetApId, success: false, error: 'Not a member' });
          continue;
        }

        // Can't demote yourself if you're the last owner
        if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
          const ownerCount = await prisma.communityMember.count({
            where: { communityApId: community.apId, role: 'owner' },
          });
          if (ownerCount <= 1) {
            results.push({ ap_id: targetApId, success: false, error: 'Cannot demote: only owner' });
            continue;
          }
        }

        await prisma.communityMember.update({
          where: memberKey(community.apId, targetApId),
          data: { role: body.role },
        });

        results.push({ ap_id: targetApId, success: true });
      } catch {
        results.push({ ap_id: targetApId, success: false, error: 'Internal error' });
      }
    }

    return c.json({ results, updated_count: results.filter((r) => r.success).length });
  });
}
