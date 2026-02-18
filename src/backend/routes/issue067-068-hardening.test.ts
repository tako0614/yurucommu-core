import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import followRoutes from './follow';
import postRoutes from './posts/base';
import dmConversationsRoutes from './dm/conversations';
import { registerMembershipMemberRoutes } from './communities/membership-members';

function createApp(prisma: unknown, actor?: { ap_id: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set('prisma', prisma);
    if (actor) {
      (c as unknown as { set: (key: string, value: unknown) => void }).set('actor', actor);
    }
    await next();
  });
  return app;
}

async function requestJson(
  app: Hono,
  path: string,
  init: RequestInit,
  env: Record<string, unknown> = { APP_URL: 'https://example.com' }
) {
  const res = await app.fetch(new Request(`https://test.local${path}`, init), env);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

describe('issue067/068 hardening routes', () => {
  it('unfollow uses a transaction for delete + counter updates', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const targetApId = 'https://example.com/ap/users/bob';

    const tx = {
      follow: { delete: vi.fn().mockResolvedValue({}) },
      actor: { update: vi.fn().mockResolvedValue({}) },
    };

    const prisma = {
      follow: {
        findUnique: vi.fn().mockResolvedValue({
          followerApId: actorApId,
          followingApId: targetApId,
          status: 'accepted',
        }),
      },
      $transaction: vi.fn(async (cb: (txArg: any) => Promise<unknown>) => cb(tx)),
      activity: { create: vi.fn().mockResolvedValue({}) },
    };

    const app = createApp(prisma, { ap_id: actorApId });
    app.route('/api/follow', followRoutes);

    const { res, body } = await requestJson(
      app,
      '/api/follow',
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_ap_id: targetApId }),
      }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.follow.delete).toHaveBeenCalledTimes(1);
    expect(tx.actor.update).toHaveBeenCalledTimes(2);
  });

  it('post delete performs delete + counts in one transaction', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const postApId = 'https://example.com/ap/objects/post-1';
    const parentApId = 'https://example.com/ap/objects/post-parent';

    const tx = {
      object: {
        delete: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      actor: { update: vi.fn().mockResolvedValue({}) },
    };

    const prisma = {
      object: {
        findFirst: vi.fn().mockResolvedValue({
          apId: postApId,
          attributedTo: actorApId,
          inReplyTo: parentApId,
        }),
      },
      $transaction: vi.fn(async (cb: (txArg: any) => Promise<unknown>) => cb(tx)),
      activity: { create: vi.fn().mockResolvedValue({}) },
    };

    const app = createApp(prisma, { ap_id: actorApId });
    app.route('/api/posts', postRoutes);

    const { res, body } = await requestJson(
      app,
      '/api/posts/post-1',
      { method: 'DELETE' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.object.delete).toHaveBeenCalledTimes(1);
    expect(tx.actor.update).toHaveBeenCalledTimes(1);
    expect(tx.object.updateMany).toHaveBeenCalledTimes(1);
  });

  it('community member removal uses a transaction for delete + member_count decrement', async () => {
    const actorApId = 'https://example.com/ap/users/owner';
    const targetApId = 'https://example.com/ap/users/member';
    const communityApId = 'https://example.com/ap/groups/team';

    const tx = {
      communityMember: { delete: vi.fn().mockResolvedValue({}) },
      community: { update: vi.fn().mockResolvedValue({}) },
    };

    const communityMemberFindUnique = vi.fn()
      .mockResolvedValueOnce({ role: 'owner' })
      .mockResolvedValueOnce({ role: 'member' });

    const prisma = {
      community: {
        findFirst: vi.fn().mockResolvedValue({ apId: communityApId }),
      },
      communityMember: {
        findUnique: communityMemberFindUnique,
      },
      $transaction: vi.fn(async (cb: (txArg: any) => Promise<unknown>) => cb(tx)),
    };

    const communities = new Hono();
    registerMembershipMemberRoutes(communities as any);

    const app = createApp(prisma, { ap_id: actorApId });
    app.route('/api/communities', communities);

    const { res, body } = await requestJson(
      app,
      `/api/communities/team/members/${encodeURIComponent(targetApId)}`,
      { method: 'DELETE' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.communityMember.delete).toHaveBeenCalledTimes(1);
    expect(tx.community.update).toHaveBeenCalledTimes(1);
  });

  it('community member list is pagination-bounded with limit/offset', async () => {
    const communityApId = 'https://example.com/ap/groups/team';

    const prisma = {
      community: {
        findFirst: vi.fn().mockResolvedValue({ apId: communityApId }),
      },
      communityMember: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      actor: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      actorCache: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const communities = new Hono();
    registerMembershipMemberRoutes(communities as any);

    const app = createApp(prisma);
    app.route('/api/communities', communities);

    const { res, body } = await requestJson(
      app,
      '/api/communities/team/members?limit=25&offset=10',
      { method: 'GET' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ members: [] });
    expect(prisma.communityMember.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 25,
        skip: 10,
      })
    );
  });

  it('DM requests query uses quoted contains match to avoid substring leaks', async () => {
    const actorApId = 'https://example.com/ap/users/alice';

    const prisma = {
      object: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      actor: {
        findMany: vi.fn().mockResolvedValue([]),
      },
      actorCache: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };

    const app = createApp(prisma, { ap_id: actorApId });
    app.route('/api/dm', dmConversationsRoutes);

    const { res, body } = await requestJson(
      app,
      '/api/dm/requests',
      { method: 'GET' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ requests: [] });
    expect(prisma.object.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          toJson: { contains: JSON.stringify(actorApId) },
        }),
      })
    );
  });
});
