import { expect, test } from "bun:test";
import { Hono } from "hono";

import { assertSpyCalls, spy } from "#test/mock";
import inboxRoutes from "../../../routes/activitypub/inbox.ts";
import { generateKeyPair, signRequest } from "../../../federation-helpers.ts";

function createDbMock(publicKeyPem: string) {
  // The inbound-activity store is now a single atomic
  // `insert(activities).values(...).onConflictDoNothing().returning().get()`.
  // A non-null `.get()` row means THIS delivery won the insert and must
  // proceed to dispatch; null means a concurrent/prior delivery already stored
  // it. Return a non-null row so the store-and-dispatch path runs.
  const insertValues = spy((..._args: unknown[]) => ({
    onConflictDoNothing: () => ({
      returning: () => ({
        get: () => Promise.resolve({ apId: "https://remote.example/inserted" }),
      }),
    }),
    // Stay awaitable too, for any call site that does not chain.
    then: (resolve: (value: undefined) => void) => resolve(undefined),
  }));
  const db = {
    query: {
      actors: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://test.local/ap/users/bob",
            preferredUsername: "bob",
          }),
        ),
      },
      actorCache: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://remote.example/users/alice",
            publicKeyPem,
            // Fresh cache entry so signature verification resolves the key
            // from cache instead of attempting a (failing) network fetch.
            lastFetchedAt: new Date().toISOString(),
          }),
        ),
      },
      activities: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      // Sender is not on either blocklist; exercise the not-blocked path
      // instead of letting the lookups throw on an undefined relation.
      blockedActors: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      blockedDomains: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
    },
    insert: spy((..._args: unknown[]) => ({
      values: insertValues,
    })),
  };

  return { db, insertValues };
}

async function signedInboxRequest(
  body: string,
  privateKeyPem: string,
  keyId: string,
) {
  const url = "https://test.local/ap/users/bob/inbox";
  const headers = await signRequest(privateKeyPem, keyId, "POST", url, body);
  return new Request(url, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/activity+json",
    },
    body,
  });
}

test("activitypub inbox - accepts signed object activities and stores them once", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues } = createDbMock(publicKeyPem);
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const body = JSON.stringify({
    id: "https://remote.example/activities/one",
    type: "Question",
    actor: actorApId,
    object: "https://remote.example/objects/one",
  });

  const res = await app.fetch(
    await signedInboxRequest(body, privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  expect(res.status).toEqual(202);
  // The atomic insert-or-skip path replaces the prior read-then-insert, so the
  // store no longer issues a separate `activities.findFirst` read; idempotency
  // is now enforced by `onConflictDoNothing().returning().get()`.
  assertSpyCalls(db.query.activities.findFirst, 0);
  assertSpyCalls(insertValues, 1);
});

function createBlocklistDbMock(publicKeyPem: string, blockedActorApId: string) {
  const insertValues = spy((..._args: unknown[]) => Promise.resolve(undefined));
  const db = {
    query: {
      actors: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://test.local/ap/users/bob",
            preferredUsername: "bob",
          }),
        ),
      },
      actorCache: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: blockedActorApId,
            publicKeyPem,
            // Fresh cache entry so signature verification resolves the key
            // from cache instead of attempting a (failing) network fetch.
            lastFetchedAt: new Date().toISOString(),
          }),
        ),
      },
      activities: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      blockedActors: {
        // Sender is on the actor blocklist.
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({ actorApId: blockedActorApId }),
        ),
      },
      blockedDomains: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
    },
    insert: spy((..._args: unknown[]) => ({
      values: insertValues,
    })),
  };

  return { db, insertValues };
}

test("activitypub inbox - silently discards a blocked actor's Follow", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues } = createBlocklistDbMock(publicKeyPem, actorApId);
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const body = JSON.stringify({
    id: "https://remote.example/activities/follow-1",
    type: "Follow",
    actor: actorApId,
    object: "https://test.local/ap/users/bob",
  });

  const res = await app.fetch(
    await signedInboxRequest(body, privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  // 202 discard (never 4xx) so the peer does not retry, and the activity is
  // never stored or dispatched to the Follow handler.
  expect(res.status).toEqual(202);
  assertSpyCalls(insertValues, 0);
  assertSpyCalls(db.query.activities.findFirst, 0);
});

test("activitypub inbox - silently discards a blocked actor's Like", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues } = createBlocklistDbMock(publicKeyPem, actorApId);
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const body = JSON.stringify({
    id: "https://remote.example/activities/like-1",
    type: "Like",
    actor: actorApId,
    object: "https://test.local/ap/objects/one",
  });

  const res = await app.fetch(
    await signedInboxRequest(body, privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  expect(res.status).toEqual(202);
  assertSpyCalls(insertValues, 0);
  assertSpyCalls(db.query.activities.findFirst, 0);
});

function createSharedInboxDbMock(
  publicKeyPem: string,
  localFollowerApIds: string[],
) {
  // The inbound-activity store is now a single atomic
  // `insert(activities).values(...).onConflictDoNothing().returning().get()`,
  // and the Like dispatch issues further chained inserts. Return an object
  // that is chainable (→ a non-null row, so the store reports "won the insert"
  // and the route proceeds to fan-out instead of treating it as a duplicate
  // and short-circuiting) and also awaitable for any non-chaining call site.
  const insertChain = {
    onConflictDoNothing: () => ({
      returning: () => ({
        get: () => Promise.resolve({ apId: "https://remote.example/inserted" }),
      }),
    }),
    then: (resolve: (value: undefined) => void) => resolve(undefined),
  };
  const insertValues = spy((..._args: unknown[]) => insertChain);
  // select(...).from(...).where(...).orderBy(...).limit(...) returns the
  // accepted-follower rows that the shared inbox pages over.
  const limit = spy((..._args: unknown[]) =>
    Promise.resolve(
      localFollowerApIds.map((followerApId) => ({ followerApId })),
    ),
  );
  const findMany = spy((..._args: unknown[]) =>
    Promise.resolve(
      localFollowerApIds.map((apId) => ({ apId, isPrivate: false })),
    ),
  );
  // The follower-page query is `select().from().where().orderBy().limit()`.
  // The Like dispatch (handleInteraction) issues other select/update chains
  // against the same mock; those run inside the route's per-recipient
  // try/catch and are not the subject of this test, so the chain below is
  // made broadly chainable to keep the dispatch from throwing uncaught.
  const followerWhere = {
    orderBy: () => ({ limit }),
    limit,
    get: () => Promise.resolve(null),
    then: (resolve: (rows: unknown[]) => void) => resolve([]),
  };
  const chainableSet = { where: () => Promise.resolve(undefined) };
  const db = {
    query: {
      actors: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
        findMany,
      },
      actorCache: {
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({
            apId: "https://remote.example/users/alice",
            publicKeyPem,
            // Fresh cache entry so signature verification resolves the key
            // from cache instead of attempting a (failing) network fetch.
            lastFetchedAt: new Date().toISOString(),
          }),
        ),
      },
      activities: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      blockedActors: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
      blockedDomains: {
        findFirst: spy((..._args: unknown[]) => Promise.resolve(null)),
      },
    },
    insert: spy((..._args: unknown[]) => ({
      values: insertValues,
    })),
    update: spy((..._args: unknown[]) => ({ set: () => chainableSet })),
    select: spy((..._args: unknown[]) => ({
      from: () => ({ where: () => followerWhere }),
    })),
  };

  return { db, insertValues, limit, findMany };
}

test("activitypub shared inbox - verifies, stores, and fans out to local followers (not black-holed)", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues, limit, findMany } = createSharedInboxDbMock(
    publicKeyPem,
    ["https://test.local/ap/users/bob"],
  );
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const body = JSON.stringify({
    id: "https://remote.example/activities/shared-1",
    type: "Like",
    actor: actorApId,
    object: "https://test.local/ap/objects/one",
  });

  const url = "https://test.local/ap/inbox";
  const headers = await signRequest(
    privateKeyPem,
    `${actorApId}#main-key`,
    "POST",
    url,
    body,
  );
  const res = await app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body,
    }),
    { APP_URL: "https://test.local" },
  );

  expect(res.status).toEqual(202);
  // The activity was deduped/stored via the atomic insert-or-skip path (proves
  // it ran the real pipeline, not the old bare-202 black hole). The store no
  // longer issues a separate `activities.findFirst` read — idempotency comes
  // from `onConflictDoNothing().returning().get()` — so the insert running and
  // returning a "won" row is the evidence the store executed.
  assertSpyCalls(db.query.activities.findFirst, 0);
  // Local followers of the sending actor were resolved and loaded for fan-out.
  assertSpyCalls(limit, 1);
  assertSpyCalls(findMany, 1);
  // At least the inbound activity insert ran.
  expect(insertValues.calls.length >= 1).toEqual(true);
});

test("activitypub inbox - rejects signed JSON that is not an activity object", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const { db, insertValues } = createDbMock(publicKeyPem);
  const app = new Hono();

  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const res = await app.fetch(
    await signedInboxRequest("[]", privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  expect(res.status).toEqual(400);
  assertSpyCalls(insertValues, 0);
});
