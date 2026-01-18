import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, formatUsername } from '../../utils';
import { managerRoles } from './utils';
import {
  MembershipContext,
  fetchCommunityId,
} from './membership-shared';

export function registerMembershipInviteRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // GET /api/communities/:identifier/invites - List invites
  communities.get('/:identifier/invites', async (c: MembershipContext) => {
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

    const invites = await prisma.communityInvite.findMany({
      where: { communityApId: community.apId },
      orderBy: { createdAt: 'desc' },
    });

    // Get invited_by info for each invite
    const result = await Promise.all(
      invites.map(async (inv) => {
        const localActor = await prisma.actor.findUnique({
          where: { apId: inv.invitedByApId },
          select: { preferredUsername: true, name: true },
        });
        const cachedActor = localActor
          ? null
          : await prisma.actorCache.findUnique({
              where: { apId: inv.invitedByApId },
              select: { preferredUsername: true, name: true },
            });
        const invitedByInfo = localActor || cachedActor;

        return {
          id: inv.id,
          invited_ap_id: inv.invitedApId,
          invited_by: {
            ap_id: inv.invitedByApId,
            username: formatUsername(inv.invitedByApId),
            preferred_username: invitedByInfo?.preferredUsername || null,
            name: invitedByInfo?.name || null,
          },
          created_at: inv.createdAt,
          expires_at: inv.expiresAt,
          used_at: inv.usedAt,
          used_by_ap_id: inv.usedByApId,
          is_valid: !inv.usedAt && (!inv.expiresAt || new Date(inv.expiresAt) > new Date()),
        };
      })
    );

    return c.json({ invites: result });
  });

  // POST /api/communities/:identifier/invites - Create invite
  communities.post('/:identifier/invites', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');
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

    const inviteId = generateId();
    const now = new Date();
    const expiresAt = expiresInHours ? new Date(now.getTime() + expiresInHours * 60 * 60 * 1000).toISOString() : null;

    await prisma.communityInvite.create({
      data: {
        id: inviteId,
        communityApId: community.apId,
        invitedByApId: actor.ap_id,
        invitedApId,
        createdAt: now.toISOString(),
        expiresAt,
      },
    });

    return c.json({ invite_id: inviteId, expires_at: expiresAt });
  });

  // DELETE /api/communities/:identifier/invites/:inviteId - Revoke invite
  communities.delete('/:identifier/invites/:inviteId', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const inviteId = c.req.param('inviteId');
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

    const invite = await prisma.communityInvite.findFirst({
      where: {
        id: inviteId,
        communityApId: community.apId,
      },
    });

    if (!invite) {
      return c.json({ error: 'Invite not found' }, 404);
    }

    await prisma.communityInvite.delete({
      where: { id: inviteId },
    });

    return c.json({ success: true });
  });
}
