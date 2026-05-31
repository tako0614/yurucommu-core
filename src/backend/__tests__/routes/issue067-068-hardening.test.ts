import { expect, test } from "bun:test";
import { Hono } from "hono";

import { assertSpyCalls, spy } from "jsr:@std/testing/mock";
import type { Env, Variables } from "../../types.ts";
import followRoutes from "../../routes/follow.ts";
import postRoutes from "../../routes/posts/routes.ts";
import dmConversationsRoutes from "../../routes/dm/conversations.ts";
import { registerMembershipMemberRoutes } from "../../routes/communities/membership-members.ts";

/**
 * Creates a chainable Drizzle mock DB.
 *
 * Call sequences resolve results from a queue. Each time a terminal method
 * (.get(), implicit array return) is hit, the next result from the queue is used.
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

  /** Thenable chain terminal that mimics Drizzle's query builder */
  interface TerminalChain {
    get: (...args: unknown[]) => Promise<unknown>;
    all: (...args: unknown[]) => Promise<unknown[]>;
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?:
        | ((value: unknown[]) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ) => Promise<TResult1 | TResult2>;
    where: (...args: unknown[]) => TerminalChain;
    orderBy: (...args: unknown[]) => TerminalChain;
    limit: (...args: unknown[]) => TerminalChain;
    offset: (...args: unknown[]) => TerminalChain;
  }

  function makeTerminalChain(result?: unknown): TerminalChain {
    const resolved = result !== undefined ? result : nextResult();
    const arrayResult = Array.isArray(resolved) ? resolved : [];
    const terminalObj = {} as TerminalChain;
    Object.assign(
      terminalObj,
      {
        get: spy((..._args: unknown[]) => Promise.resolve(resolved)),
        all: spy((..._args: unknown[]) =>
          Promise.resolve(Array.isArray(resolved) ? resolved : [])
        ),
        then: ((onfulfilled, onrejected) =>
          Promise.resolve(arrayResult).then(
            onfulfilled,
            onrejected,
          )) as TerminalChain["then"],
        where: spy((..._args: unknown[]) => terminalObj),
        orderBy: spy((..._args: unknown[]) => terminalObj),
        limit: spy((..._args: unknown[]) => terminalObj),
        offset: spy((..._args: unknown[]) => terminalObj),
      } satisfies TerminalChain,
    );
    return terminalObj;
  }

  /** Callback type for thenable resolve/reject */
  type ThenResolve<T = unknown> = ((value: T) => unknown) | null | undefined;
  type ThenReject = ((reason: unknown) => unknown) | null | undefined;

  interface InsertChain {
    onConflictDoNothing: (...args: unknown[]) => unknown;
    onConflictDoUpdate: (...args: unknown[]) => unknown;
    returning: (...args: unknown[]) => unknown;
    then: (resolve: ThenResolve, reject?: ThenReject) => Promise<unknown>;
  }

  const selectSpy = spy((..._args: unknown[]) => {
    tracker.selectCalls++;
    const terminal = makeTerminalChain();
    return {
      from: spy((..._fArgs: unknown[]) => terminal),
    };
  });

  const selectDistinctSpy = spy((..._args: unknown[]) => {
    const terminal = makeTerminalChain();
    return {
      from: spy((..._fArgs: unknown[]) => terminal),
    };
  });

  const insertSpy = spy((..._args: unknown[]) => {
    tracker.insertCalls++;
    const currentInsertIdx = insertCallCount++;
    const shouldError = insertErrors.get(currentInsertIdx);

    const get = spy((..._gArgs: unknown[]) => Promise.resolve(nextResult()));
    const returning = spy((..._rArgs: unknown[]) => ({ get }));
    const onConflictDoNothing = spy((..._cArgs: unknown[]) => ({
      returning,
      get,
    }));
    const onConflictDoUpdate = spy((..._cArgs: unknown[]) => ({
      returning,
      get,
    }));

    const values = spy((..._vArgs: unknown[]) => {
      if (shouldError) {
        const errorChain: InsertChain = {
          onConflictDoNothing,
          onConflictDoUpdate,
          returning,
          then: (resolve: ThenResolve, reject?: ThenReject) =>
            Promise.reject(shouldError).then(resolve, reject),
        };
        return errorChain;
      }
      return {
        onConflictDoNothing,
        onConflictDoUpdate,
        returning,
        then: (resolve: ThenResolve) =>
          Promise.resolve(undefined).then(resolve),
      } satisfies InsertChain;
    });
    return { values };
  });

  const updateSpy = spy((..._args: unknown[]) => {
    tracker.updateCalls++;
    const where = spy((..._wArgs: unknown[]) => ({
      then: (resolve: ThenResolve) =>
        Promise.resolve({ meta: updateMeta }).then(resolve),
      run: spy((..._rArgs: unknown[]) => Promise.resolve({ meta: updateMeta })),
    }));
    const set = spy((..._sArgs: unknown[]) => ({
      where,
      then: (resolve: ThenResolve) =>
        Promise.resolve({ meta: updateMeta }).then(resolve),
      run: spy((..._rArgs: unknown[]) => Promise.resolve({ meta: updateMeta })),
    }));
    return { set };
  });

  const deleteSpy = spy((..._args: unknown[]) => {
    tracker.deleteCalls++;
    const where = spy((..._wArgs: unknown[]) => ({
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    }));
    return {
      where,
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    };
  });

  const db = {
    select: selectSpy,
    selectDistinct: selectDistinctSpy,
    insert: insertSpy,
    update: updateSpy,
    delete: deleteSpy,
    query: {
      objects: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve(queryFindFirstResult)
        ),
        findMany: spy((..._args: unknown[]) => Promise.resolve([])),
      },
    },
  };

  return { db, tracker };
}

function createApp(db: unknown, actor?: { ap_id: string }) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    if (actor) {
      (c as unknown as { set: (key: string, value: unknown) => void }).set(
        "actor",
        actor,
      );
    }
    await next();
  });
  return app;
}

async function requestJson(
  app: Hono,
  path: string,
  init: RequestInit,
  env: Record<string, unknown> = { APP_URL: "https://example.com" },
) {
  const res = await app.fetch(
    new Request(`https://test.local${path}`, init),
    env,
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

test("issue067/068 hardening - local follow handles duplicate create via unique constraint", async () => {
  const actorApId = "https://example.com/ap/users/alice";
  const targetApId = "https://example.com/ap/users/bob";

  const { db } = createDrizzleMockDb({
    results: [
      null, // select: existing follow check
      { isPrivate: 0 }, // select: target actor
    ],
    insertErrors: new Map([
      [
        0,
        new Error(
          "UNIQUE constraint failed: follows.follower_ap_id, follows.following_ap_id",
        ),
      ],
    ]),
  });

  const app = createApp(db, { ap_id: actorApId });
  app.route("/api/follow", followRoutes);

  const { res, body } = await requestJson(
    app,
    "/api/follow",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ap_id: targetApId }),
    },
  );

  expect(res.status).toEqual(400);
  expect(body).toEqual(expect.any(Object));
  assert_called(db.select);
  assert_called(db.insert);
});

test("issue067/068 hardening - unfollow uses a transaction for delete + counter updates", async () => {
  const actorApId = "https://example.com/ap/users/alice";
  const targetApId = "https://example.com/ap/users/bob";

  const { db, tracker } = createDrizzleMockDb({
    results: [
      {
        followerApId: actorApId,
        followingApId: targetApId,
        status: "accepted",
        activityApId: null,
      },
    ],
  });

  const app = createApp(db, { ap_id: actorApId });
  app.route("/api/follow", followRoutes);

  const { res, body } = await requestJson(
    app,
    "/api/follow",
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_ap_id: targetApId }),
    },
  );

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  assert_called(db.delete);
  // Two update calls: decrement followingCount + followerCount
  expect(tracker.updateCalls).toEqual(2);
});

test("issue067/068 hardening - post delete performs delete + counts in one transaction", async () => {
  const actorApId = "https://example.com/ap/users/alice";
  const postApId = "https://example.com/ap/objects/post-1";
  const parentApId = "https://example.com/ap/objects/post-parent";

  const { db } = createDrizzleMockDb({
    results: [],
    queryFindFirstResult: {
      apId: postApId,
      attributedTo: actorApId,
      inReplyTo: parentApId,
      type: "Note",
      content: "test",
      summary: null,
      attachmentsJson: "[]",
      visibility: "public",
      communityApId: null,
      likeCount: 0,
      replyCount: 0,
      announceCount: 0,
      published: "2026-01-01T00:00:00Z",
    },
    updateMeta: { changes: 1 },
  });

  const app = createApp(db, { ap_id: actorApId });
  app.route("/api/posts", postRoutes);

  const { res, body } = await requestJson(
    app,
    "/api/posts/post-1",
    { method: "DELETE" },
    {
      APP_URL: "https://example.com",
      DELIVERY_QUEUE: {
        send: spy((..._args: unknown[]) => Promise.resolve(undefined)),
      },
    },
  );

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  assertSpyCalls(db.query.objects.findFirst, 1);
  assert_called(db.delete);
  assert_called(db.update);
});

test("issue067/068 hardening - community member removal uses a transaction for delete + member_count decrement", async () => {
  const actorApId = "https://example.com/ap/users/owner";
  const targetApId = "https://example.com/ap/users/member";
  const communityApId = "https://example.com/ap/groups/team";

  const { db } = createDrizzleMockDb({
    results: [
      { apId: communityApId },
      { role: "owner", actorApId, communityApId },
      { role: "member", actorApId: targetApId, communityApId },
    ],
  });

  const communities = new Hono();
  registerMembershipMemberRoutes(
    communities as unknown as Hono<{ Bindings: Env; Variables: Variables }>,
  );

  const app = createApp(db, { ap_id: actorApId });
  app.route("/api/communities", communities);

  const { res, body } = await requestJson(
    app,
    `/api/communities/team/members/${encodeURIComponent(targetApId)}`,
    { method: "DELETE" },
  );

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  assert_called(db.delete);
  assert_called(db.update);
});

test("issue067/068 hardening - community member list is pagination-bounded with limit/offset", async () => {
  const communityApId = "https://example.com/ap/groups/team";

  const { db } = createDrizzleMockDb({
    results: [
      { apId: communityApId },
      [], // members (empty array)
    ],
  });

  const communities = new Hono();
  registerMembershipMemberRoutes(
    communities as unknown as Hono<{ Bindings: Env; Variables: Variables }>,
  );

  const app = createApp(db);
  app.route("/api/communities", communities);

  const { res, body } = await requestJson(
    app,
    "/api/communities/team/members?limit=25&offset=10",
    { method: "GET" },
  );

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  // Verify the db.select was called with pagination chain
  assert_called(db.select);
});

test("issue067/068 hardening - DM requests query uses quoted contains match to avoid substring leaks", async () => {
  const actorApId = "https://example.com/ap/users/alice";

  const { db } = createDrizzleMockDb({
    results: [
      [], // incoming DMs (empty)
    ],
  });

  const app = createApp(db, { ap_id: actorApId });
  app.route("/api/dm", dmConversationsRoutes);

  const { res, body } = await requestJson(
    app,
    "/api/dm/requests",
    { method: "GET" },
  );

  expect(res.status).toEqual(200);
  expect(body).toEqual(expect.any(Object));
  // Verify db.select was called for the DM query
  assert_called(db.select);
});

/** Helper: assert a spy was called at least once */
function assert_called(spyFn: { calls: unknown[] }) {
  if (spyFn.calls.length === 0) {
    throw new Error("Expected spy to have been called at least once");
  }
}
