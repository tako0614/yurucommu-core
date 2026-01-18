import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { formatUsername } from '../../utils';
import { managerRoles } from './utils';
import {
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
    const prisma = c.get('prisma');

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check if actor has permission to remove members
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

    if (!actorMembership || !managerRoles.has(actorMembership.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    // Check target membership
    const targetMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId,
        },
      },
    });

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
    await prisma.communityMember.delete({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId,
        },
      },
    });

    // Update member count
    await prisma.community.update({
      where: { apId: community.apId },
      data: { memberCount: { decrement: 1 } },
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
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

    if (!actorMembership || actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can change member roles' }, 403);
    }

    // Check target membership
    const targetMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId,
        },
      },
    });

    if (!targetMembership) {
      return c.json({ error: 'User is not a member' }, 404);
    }

    // Can't demote yourself if you're the last owner
    if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
      const ownerCount = await prisma.communityMember.count({
        where: {
          communityApId: community.apId,
          role: 'owner',
        },
      });
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot demote: you are the only owner' }, 400);
      }
    }

    // Update role
    await prisma.communityMember.update({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId,
        },
      },
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

    // Get community first
    const community = await prisma.community.findFirst({
      where: {
        OR: [
          { apId },
          { preferredUsername: identifier },
        ],
      },
      select: { apId: true },
    });

    if (!community) {
      return c.json({ members: [] });
    }

    // Get members
    const members = await prisma.communityMember.findMany({
      where: { communityApId: community.apId },
      orderBy: [
        { role: 'desc' },
        { joinedAt: 'asc' },
      ],
    });

    // Batch load actor info to avoid N+1 queries
    const memberApIds = members.map((m) => m.actorApId);
    const [localActors, cachedActors] = await Promise.all([
      prisma.actor.findMany({
        where: { apId: { in: memberApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
      }),
      prisma.actorCache.findMany({
        where: { apId: { in: memberApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
      }),
    ]);

    const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
    const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

    const result = members.map((m) => {
      const actorInfo = localActorMap.get(m.actorApId) || cachedActorMap.get(m.actorApId);

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

    if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
      return c.json({ error: 'actor_ap_ids array is required' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check permissions
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

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
        const targetMembership = await prisma.communityMember.findUnique({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId,
            },
          },
        });

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
        await prisma.communityMember.delete({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId,
            },
          },
        });

        results.push({ ap_id: targetApId, success: true });
      } catch {
        results.push({ ap_id: targetApId, success: false, error: 'Internal error' });
      }
    }

    // Update member count
    const removedCount = results.filter((r) => r.success).length;
    if (removedCount > 0) {
      await prisma.community.update({
        where: { apId: community.apId },
        data: { memberCount: { decrement: removedCount } },
      });
    }

    return c.json({ results, removed_count: removedCount });
  });

  // POST /api/communities/:identifier/members/batch/role - Bulk update member roles
  communities.post('/:identifier/members/batch/role', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
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
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

    if (!actorMembership || actorMembership.role !== 'owner') {
      return c.json({ error: 'Only owners can change roles' }, 403);
    }

    const results: { ap_id: string; success: boolean; error?: string }[] = [];

    for (const targetApId of body.actor_ap_ids) {
      try {
        // Check target membership
        const targetMembership = await prisma.communityMember.findUnique({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId,
            },
          },
        });

        if (!targetMembership) {
          results.push({ ap_id: targetApId, success: false, error: 'Not a member' });
          continue;
        }

        // Can't demote yourself if you're the last owner
        if (targetApId === actor.ap_id && targetMembership.role === 'owner' && body.role !== 'owner') {
          const ownerCount = await prisma.communityMember.count({
            where: {
              communityApId: community.apId,
              role: 'owner',
            },
          });
          if (ownerCount <= 1) {
            results.push({ ap_id: targetApId, success: false, error: 'Cannot demote: only owner' });
            continue;
          }
        }

        // Update role
        await prisma.communityMember.update({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId,
            },
          },
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
