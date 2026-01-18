import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { formatUsername } from '../../utils';
import { managerRoles } from './utils';
import {
  MembershipContext,
  fetchCommunityId,
} from './membership-shared';

export function registerMembershipRequestRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // GET /api/communities/:identifier/requests - List pending join requests
  communities.get('/:identifier/requests', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const requests = await prisma.communityJoinRequest.findMany({
      where: {
        communityApId: community.apId,
        status: 'pending',
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get actor info for each request
    const result = await Promise.all(
      requests.map(async (r) => {
        const localActor = await prisma.actor.findUnique({
          where: { apId: r.actorApId },
          select: { preferredUsername: true, name: true, iconUrl: true },
        });
        const cachedActor = localActor
          ? null
          : await prisma.actorCache.findUnique({
              where: { apId: r.actorApId },
              select: { preferredUsername: true, name: true, iconUrl: true },
            });
        const actorInfo = localActor || cachedActor;

        return {
          ap_id: r.actorApId,
          username: formatUsername(r.actorApId),
          preferred_username: actorInfo?.preferredUsername || null,
          name: actorInfo?.name || null,
          icon_url: actorInfo?.iconUrl || null,
          created_at: r.createdAt,
        };
      })
    );

    return c.json({ requests: result });
  });

  // POST /api/communities/:identifier/requests/accept - Accept join request
  communities.post('/:identifier/requests/accept', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
    const body = await c.req.json<{ actor_ap_id: string }>();

    if (!body.actor_ap_id) {
      return c.json({ error: 'actor_ap_id required' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const request = await prisma.communityJoinRequest.findFirst({
      where: {
        communityApId: community.apId,
        actorApId: body.actor_ap_id,
        status: 'pending',
      },
    });

    if (!request) {
      return c.json({ error: 'Join request not found' }, 404);
    }

    const existingMember = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id,
        },
      },
    });

    if (!existingMember) {
      const now = new Date().toISOString();
      await prisma.communityMember.create({
        data: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id,
          role: 'member',
          joinedAt: now,
        },
      });

      await prisma.community.update({
        where: { apId: community.apId },
        data: { memberCount: { increment: 1 } },
      });
    }

    await prisma.communityJoinRequest.update({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id,
        },
      },
      data: {
        status: 'accepted',
        processedAt: new Date().toISOString(),
      },
    });

    return c.json({ success: true });
  });

  // POST /api/communities/:identifier/requests/reject - Reject join request
  communities.post('/:identifier/requests/reject', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
    const body = await c.req.json<{ actor_ap_id: string }>();

    if (!body.actor_ap_id) {
      return c.json({ error: 'actor_ap_id required' }, 400);
    }

    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });

    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const request = await prisma.communityJoinRequest.findFirst({
      where: {
        communityApId: community.apId,
        actorApId: body.actor_ap_id,
        status: 'pending',
      },
    });

    if (!request) {
      return c.json({ error: 'Join request not found' }, 404);
    }

    await prisma.communityJoinRequest.update({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id,
        },
      },
      data: {
        status: 'rejected',
        processedAt: new Date().toISOString(),
      },
    });

    return c.json({ success: true });
  });
}
