import type { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import {
  MembershipContext,
  fetchCommunityDetails,
  memberKey,
} from './membership-shared';

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'P2002';
}

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

    const { community } = await fetchCommunityDetails(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    // Check if already member
    const existing = await prisma.communityMember.findUnique({
      where: memberKey(community.apId, actor.ap_id),
    });
    if (existing) {
      return c.json({ error: 'Already a member' }, 409);
    }

    const now = new Date().toISOString();

    if (community.joinPolicy === 'approval') {
      await prisma.communityJoinRequest.upsert({
        where: memberKey(community.apId, actor.ap_id),
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

      try {
        const result = await prisma.$transaction(async (tx) => {
          const invite = await tx.communityInvite.findFirst({
            where: {
              id: inviteId,
              communityApId: community.apId,
              usedAt: null,
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: now } },
              ],
            },
          });

          if (!invite) {
            return { status: 'invalid_invite' as const };
          }
          if (invite.invitedApId && invite.invitedApId !== actor.ap_id) {
            return { status: 'invite_wrong_account' as const };
          }

          await tx.communityMember.create({
            data: {
              communityApId: community.apId,
              actorApId: actor.ap_id,
              role: 'member',
              joinedAt: now,
            },
          });

          await tx.community.update({
            where: { apId: community.apId },
            data: { memberCount: { increment: 1 } },
          });

          const claimed = await tx.communityInvite.updateMany({
            where: {
              id: inviteId,
              communityApId: community.apId,
              usedAt: null,
              OR: [
                { expiresAt: null },
                { expiresAt: { gt: now } },
              ],
              AND: [
                {
                  OR: [
                    { invitedApId: null },
                    { invitedApId: actor.ap_id },
                  ],
                },
              ],
            },
            data: {
              usedByApId: actor.ap_id,
              usedAt: now,
            },
          });
          if (claimed.count !== 1) {
            throw new Error('INVITE_CLAIM_FAILED');
          }

          return { status: 'joined' as const };
        });

        if (result.status === 'invalid_invite') {
          return c.json({ error: 'Invalid or expired invite', status: 'invite_required' }, 403);
        }
        if (result.status === 'invite_wrong_account') {
          return c.json({ error: 'Invite not for this account', status: 'invite_required' }, 403);
        }
        return c.json({ success: true, status: 'joined' });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          return c.json({ error: 'Already a member' }, 409);
        }
        console.error('[Communities] Failed to join with invite:', error);
        return c.json({ error: 'Failed to join community' }, 500);
      }
    }

    // Open join
    try {
      await prisma.$transaction(async (tx) => {
        await tx.communityMember.create({
          data: {
            communityApId: community.apId,
            actorApId: actor.ap_id,
            role: 'member',
            joinedAt: now,
          },
        });

        await tx.community.update({
          where: { apId: community.apId },
          data: { memberCount: { increment: 1 } },
        });
      });
      return c.json({ success: true, status: 'joined' });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return c.json({ error: 'Already a member' }, 409);
      }
      console.error('[Communities] Failed to join community:', error);
      return c.json({ error: 'Failed to join community' }, 500);
    }
  });

  // POST /api/communities/:identifier/leave - Leave a community
  communities.post('/:identifier/leave', async (c: MembershipContext) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const identifier = c.req.param('identifier');
    const prisma = c.get('prisma');

    const { community } = await fetchCommunityDetails(c, identifier);
    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    const membership = await prisma.communityMember.findUnique({
      where: memberKey(community.apId, actor.ap_id),
    });
    if (!membership) {
      return c.json({ error: 'Not a member' }, 400);
    }

    // Don't allow the last owner to leave
    if (membership.role === 'owner') {
      const ownerCount = await prisma.communityMember.count({
        where: { communityApId: community.apId, role: 'owner' },
      });
      if (ownerCount <= 1) {
        return c.json({ error: 'Cannot leave: you are the only owner' }, 400);
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.communityMember.delete({
        where: memberKey(community.apId, actor.ap_id),
      });
      await tx.community.update({
        where: { apId: community.apId },
        data: { memberCount: { decrement: 1 } },
      });
    });

    return c.json({ success: true });
  });
}
