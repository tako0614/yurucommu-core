import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import {
  MembershipContext,
  fetchCommunityDetails,
} from './membership-shared';

export function registerMembershipJoinRoutes(communities: Hono<{ Bindings: Env; Variables: Variables }>) {
  // POST /api/communities/:identifier/join - Join a community
  communities.post('/:identifier/join', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');

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
    const existing = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });
    if (existing) {
      return c.json({ error: 'Already a member' }, 409);
    }

    const now = new Date().toISOString();

    if (community.joinPolicy === 'approval') {
      await prisma.communityJoinRequest.upsert({
        where: {
          communityApId_actorApId: {
            communityApId: community.apId,
            actorApId: actor.ap_id,
          },
        },
        create: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
          status: 'pending',
          createdAt: now,
        },
        update: {
          status: 'pending',
          createdAt: now,
          processedAt: null,
        },
      });

      return c.json({ success: true, status: 'pending' });
    }

    if (community.joinPolicy === 'invite') {
      if (!inviteId) {
        return c.json({ error: 'Invite required', status: 'invite_required' }, 403);
      }

      const invite = await prisma.communityInvite.findFirst({
        where: {
          id: inviteId,
          communityApId: community.apId,
          usedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date().toISOString() } },
          ],
        },
      });

      if (!invite) {
        return c.json({ error: 'Invalid or expired invite', status: 'invite_required' }, 403);
      }

      if (invite.invitedApId && invite.invitedApId !== actor.ap_id) {
        return c.json({ error: 'Invite not for this account', status: 'invite_required' }, 403);
      }

      await prisma.communityMember.create({
        data: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
          role: 'member',
          joinedAt: now,
        },
      });

      await prisma.community.update({
        where: { apId: community.apId },
        data: { memberCount: { increment: 1 } },
      });

      await prisma.communityInvite.update({
        where: { id: inviteId },
        data: {
          usedByApId: actor.ap_id,
          usedAt: now,
        },
      });

      return c.json({ success: true, status: 'joined' });
    }

    // Open join
    await prisma.communityMember.create({
      data: {
        communityApId: community.apId,
        actorApId: actor.ap_id,
        role: 'member',
        joinedAt: now,
      },
    });

    await prisma.community.update({
      where: { apId: community.apId },
      data: { memberCount: { increment: 1 } },
    });

    return c.json({ success: true, status: 'joined' });
  });

  // POST /api/communities/:identifier/leave - Leave a community
  communities.post('/:identifier/leave', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');

    // Check community exists
    const { community } = await fetchCommunityDetails(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check membership
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
    });
    if (!membership) {
      return c.json({ error: 'Not a member' }, 400);
    }

    // Don't allow the last owner to leave
    if (membership.role === 'owner') {
      const ownerCount = await prisma.communityMember.count({
        where: {
          communityApId: community.apId,
          role: 'owner',
        },
      });
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot leave: you are the only owner' }, 400);
      }
    }

    // Remove member
    await prisma.communityMember.delete({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
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
}
