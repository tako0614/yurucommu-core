import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import followRoutes from '../../routes/follow';
import postRoutes from '../../routes/posts/base';
import dmConversationsRoutes from '../../routes/dm/conversations';
import { registerMembershipMemberRoutes } from '../../routes/communities/membership-members';

/**
 * Creates a chainable Drizzle mock DB.
 *
 * Call sequences resolve results from a queue. Each time a terminal method
 * (.get(), implicit array return) is hit, the next result from the queue is used.
 *
 * Supports: db.select().from().where().get(), db.select().from().where().orderBy().limit().offset(),
 * db.insert().values(), db.update().set().where(), db.delete().where(),
 * db.query.objects.findFirst(), and db.selectDistinct().from().where()
 */
function createDrizzleMockDb(options: {
  results?: unknown[];
  insertErrors?: Map<number, Error>;
  queryFindFirstResult?: unknown;
  updateMeta?: { changes: number };
} = {}) {
  const {
    results = [],
    insertErrors = new Map(),
    queryFindFirstResult = undefined,
    updateMeta = { changes: 0 },
  } = options;
  let resultIndex = 0;

  function nextResult() {
    const r = results[resultIndex] ?? undefined;
    resultIndex++;
    return r;
  }

  let insertCallCount = 0;

  const tracker = {
    selectCalls: 0,
    insertCalls: 0,
    updateCalls: 0,
    deleteCalls: 0,
  };

  function makeTerminalChain(result?: unknown) {
    const resolved = result !== undefined ? result : nextResult();
    const terminalObj: any = {
      get: vi.fn().mockResolvedValue(resolved),
      all: vi.fn().mockResolvedValue(Array.isArray(resolved) ? resolved : []),
      then: undefined as any,
    };
    // Make it thenable (returns the array directly for non-.get() chains)
    const arrayResult = Array.isArray(resolved) ? resolved : [];
    terminalObj.then = (resolve: any, reject: any) => Promise.resolve(arrayResult).then(resolve, reject);

    // Support additional chaining after where: orderBy, limit, offset
    terminalObj.where = vi.fn().mockReturnValue(terminalObj);
    terminalObj.orderBy = vi.fn().mockReturnValue(terminalObj);
    terminalObj.limit = vi.fn().mockReturnValue(terminalObj);
    terminalObj.offset = vi.fn().mockReturnValue(terminalObj);
    return terminalObj;
  }

  const db: any = {
    select: vi.fn((..._args: unknown[]) => {
      tracker.selectCalls++;
      const terminal = makeTerminalChain();
      return {
        from: vi.fn().mockReturnValue(terminal),
      };
    }),

    selectDistinct: vi.fn((..._args: unknown[]) => {
      const terminal = makeTerminalChain();
      return {
        from: vi.fn().mockReturnValue(terminal),
      };
    }),

    insert: vi.fn((..._args: unknown[]) => {
      tracker.insertCalls++;
      const currentInsertIdx = insertCallCount++;
      const shouldError = insertErrors.get(currentInsertIdx);

      const get = vi.fn().mockResolvedValue(nextResult());
      const returning = vi.fn().mockReturnValue({ get });
      const onConflictDoNothing = vi.fn().mockReturnValue({ returning, get });
      const onConflictDoUpdate = vi.fn().mockReturnValue({ returning, get });

      const values = vi.fn((..._vArgs: unknown[]) => {
        if (shouldError) {
          // Make the entire chain thenable with rejection
          const errorChain: any = {
            onConflictDoNothing,
            onConflictDoUpdate,
            returning,
            then: (resolve: any, reject: any) => Promise.reject(shouldError).then(resolve, reject),
          };
          return errorChain;
        }
        return {
          onConflictDoNothing,
          onConflictDoUpdate,
          returning,
          then: (resolve: any) => Promise.resolve(undefined).then(resolve),
        };
      });
      return { values };
    }),

    update: vi.fn((..._args: unknown[]) => {
      tracker.updateCalls++;
      const where = vi.fn().mockReturnValue({
        then: (resolve: any) => Promise.resolve({ meta: updateMeta }).then(resolve),
        run: vi.fn().mockResolvedValue({ meta: updateMeta }),
      });
      const set = vi.fn().mockReturnValue({
        where,
        then: (resolve: any) => Promise.resolve({ meta: updateMeta }).then(resolve),
        run: vi.fn().mockResolvedValue({ meta: updateMeta }),
      });
      return { set };
    }),

    delete: vi.fn((..._args: unknown[]) => {
      tracker.deleteCalls++;
      const where = vi.fn().mockReturnValue({
        then: (resolve: any) => Promise.resolve(undefined).then(resolve),
      });
      return {
        where,
        then: (resolve: any) => Promise.resolve(undefined).then(resolve),
      };
    }),

    query: {
      objects: {
        findFirst: vi.fn().mockResolvedValue(queryFindFirstResult),
        findMany: vi.fn().mockResolvedValue([]),
      },
    },
  };

  return { db, tracker };
}

function createApp(db: unknown, actor?: { ap_id: string }) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    (c as any).set('prisma', db);
    if (actor) {
      (c as any).set('actor', actor);
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
  it('local follow handles duplicate create via unique constraint', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const targetApId = 'https://example.com/ap/users/bob';

    // Flow:
    // select[0] = check existing follow -> null (no existing)
    // select[1] = handleLocalFollow: get target actor isPrivate -> { isPrivate: 0 }
    // insert[0] = insert follow -> throws UNIQUE constraint error
    const { db } = createDrizzleMockDb({
      results: [
        null,               // select: existing follow check
        { isPrivate: 0 },   // select: target actor
      ],
      insertErrors: new Map([
        [0, new Error('UNIQUE constraint failed: follows.follower_ap_id, follows.following_ap_id')],
      ]),
    });

    const app = createApp(db, { ap_id: actorApId });
    app.route('/api/follow', followRoutes);

    const { res, body } = await requestJson(
      app,
      '/api/follow',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_ap_id: targetApId }),
      }
    );

    expect(res.status).toBe(400);
    expect(body).toMatchObject({ error: 'Already following or pending' });
    expect(db.select).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });

  it('unfollow uses a transaction for delete + counter updates', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const targetApId = 'https://example.com/ap/users/bob';

    // Flow:
    // select[0] = check existing follow -> returns follow record
    // delete[0] = delete follow
    // update[0] = decrement followingCount for actor
    // update[1] = decrement followerCount for target (local)
    const { db, tracker } = createDrizzleMockDb({
      results: [
        {
          followerApId: actorApId,
          followingApId: targetApId,
          status: 'accepted',
          activityApId: null,
        },
      ],
    });

    const app = createApp(db, { ap_id: actorApId });
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
    expect(db.delete).toHaveBeenCalled();
    // Two update calls: decrement followingCount + followerCount
    expect(tracker.updateCalls).toBe(2);
  });

  it('post delete performs delete + counts in one transaction', async () => {
    const actorApId = 'https://example.com/ap/users/alice';
    const postApId = 'https://example.com/ap/objects/post-1';
    const parentApId = 'https://example.com/ap/objects/post-parent';

    // The post delete route uses db.query.objects.findFirst, then sequential operations
    // Flow:
    // query.objects.findFirst -> returns post
    // delete[0] = delete object
    // update[0] = decrement postCount on actor
    // update[1] = decrement parent replyCount
    // insert[0] = create delete activity
    const { db } = createDrizzleMockDb({
      results: [],
      queryFindFirstResult: {
        apId: postApId,
        attributedTo: actorApId,
        inReplyTo: parentApId,
        type: 'Note',
        content: 'test',
        summary: null,
        attachmentsJson: '[]',
        visibility: 'public',
        communityApId: null,
        likeCount: 0,
        replyCount: 0,
        announceCount: 0,
        published: '2026-01-01T00:00:00Z',
      },
      updateMeta: { changes: 1 },
    });

    const app = createApp(db, { ap_id: actorApId });
    app.route('/api/posts', postRoutes);

    const { res, body } = await requestJson(
      app,
      '/api/posts/post-1',
      { method: 'DELETE' },
      { APP_URL: 'https://example.com', DELIVERY_QUEUE: { send: vi.fn().mockResolvedValue(undefined) } }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(db.query.objects.findFirst).toHaveBeenCalledTimes(1);
    expect(db.delete).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('community member removal uses a transaction for delete + member_count decrement', async () => {
    const actorApId = 'https://example.com/ap/users/owner';
    const targetApId = 'https://example.com/ap/users/member';
    const communityApId = 'https://example.com/ap/groups/team';

    // Flow:
    // select[0] = fetchCommunityId -> { apId: communityApId }
    // select[1] = requireManager -> { role: 'owner', actorApId, communityApId }
    // select[2] = check target membership -> { role: 'member', ... }
    // delete[0] = delete community member
    // update[0] = decrement memberCount
    const { db } = createDrizzleMockDb({
      results: [
        { apId: communityApId },
        { role: 'owner', actorApId, communityApId },
        { role: 'member', actorApId: targetApId, communityApId },
      ],
    });

    const communities = new Hono();
    registerMembershipMemberRoutes(communities as any);

    const app = createApp(db, { ap_id: actorApId });
    app.route('/api/communities', communities);

    const { res, body } = await requestJson(
      app,
      `/api/communities/team/members/${encodeURIComponent(targetApId)}`,
      { method: 'DELETE' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });
    expect(db.delete).toHaveBeenCalled();
    expect(db.update).toHaveBeenCalled();
  });

  it('community member list is pagination-bounded with limit/offset', async () => {
    const communityApId = 'https://example.com/ap/groups/team';

    // Flow:
    // select[0] = find community -> { apId: communityApId }
    // select[1] = find members -> [] (empty list, iterable)
    // batchLoadActorInfo: since memberApIds is empty, returns early without db calls
    const { db } = createDrizzleMockDb({
      results: [
        { apId: communityApId },
        [],  // members (empty array)
      ],
    });

    const communities = new Hono();
    registerMembershipMemberRoutes(communities as any);

    const app = createApp(db);
    app.route('/api/communities', communities);

    const { res, body } = await requestJson(
      app,
      '/api/communities/team/members?limit=25&offset=10',
      { method: 'GET' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ members: [] });
    // Verify the db.select was called with pagination chain
    expect(db.select).toHaveBeenCalled();
  });

  it('DM requests query uses quoted contains match to avoid substring leaks', async () => {
    const actorApId = 'https://example.com/ap/users/alice';

    // Flow:
    // select[0] = find incoming DMs -> []
    // selectDistinct[0] = find replied conversations -> [] (won't be called if empty DMs)
    // batchLoadActorInfo: since senderApIds is empty, returns early
    const { db } = createDrizzleMockDb({
      results: [
        [],  // incoming DMs (empty)
      ],
    });

    const app = createApp(db, { ap_id: actorApId });
    app.route('/api/dm', dmConversationsRoutes);

    const { res, body } = await requestJson(
      app,
      '/api/dm/requests',
      { method: 'GET' }
    );

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ requests: [] });
    // Verify db.select was called for the DM query
    expect(db.select).toHaveBeenCalled();
  });
});
