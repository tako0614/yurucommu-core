import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { assertSpyCalls, spy } from "#test/mock";
import { createTestDb } from "../../helpers/d1-semantics.ts";
import {
  activities,
  actorCache,
  actors,
  likes,
  objects,
  reports,
} from "../../../../db/index.ts";
import inboxRoutes from "../../../routes/activitypub/inbox.ts";
import { generateKeyPair, signRequest } from "../../../federation-helpers.ts";

function createDbMock(publicKeyPem: string) {
  // Parse-rejection tests never reach the persistence layer. Keep this narrow
  // mock for those cases; successful inbox behavior is covered against the
  // real D1-semantics harness below.
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
  const { db } = await createTestDb();
  await db.insert(actors).values([
    {
      apId: "https://test.local/ap/users/bob",
      type: "Person",
      preferredUsername: "bob",
      inbox: "https://test.local/ap/users/bob/inbox",
      outbox: "https://test.local/ap/users/bob/outbox",
      followersUrl: "https://test.local/ap/users/bob/followers",
      followingUrl: "https://test.local/ap/users/bob/following",
      publicKeyPem: "local-public",
      privateKeyPem: "local-private",
    },
    {
      apId: actorApId,
      type: "Person",
      preferredUsername: "alice",
      inbox: `${actorApId}/inbox`,
      outbox: `${actorApId}/outbox`,
      followersUrl: `${actorApId}/followers`,
      followingUrl: `${actorApId}/following`,
      publicKeyPem,
      privateKeyPem: "remote-private-unused",
    },
  ]);
  await db.insert(actorCache).values({
    apId: actorApId,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${actorApId}/inbox`,
    publicKeyId: `${actorApId}#main-key`,
    publicKeyPem,
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });
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

  const duplicate = await app.fetch(
    await signedInboxRequest(body, privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );
  expect(duplicate.status).toEqual(202);

  const stored = await db
    .select({
      apId: activities.apId,
      rawJson: activities.rawJson,
      processed: activities.processed,
    })
    .from(activities)
    .where(eq(activities.actorApId, actorApId))
    .all();
  expect(stored).toHaveLength(1);
  expect(stored[0]?.apId).toMatch(
    /^https:\/\/test\.local\/ap\/activities\/inbound-[a-f0-9]{64}$/,
  );
  expect(JSON.parse(stored[0]?.rawJson ?? "{}").id).toBe(
    "https://remote.example/activities/one",
  );
  expect(stored[0]?.processed).toBe(1);
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

test("activitypub inbox - ACKs an unknown-target Like without retaining a dangling edge", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const unknownObject = "https://unknown.example/objects/attacker-chosen";
  const { db } = await createTestDb();
  await db.insert(actors).values({
    apId: "https://test.local/ap/users/bob",
    type: "Person",
    preferredUsername: "bob",
    inbox: "https://test.local/ap/users/bob/inbox",
    outbox: "https://test.local/ap/users/bob/outbox",
    followersUrl: "https://test.local/ap/users/bob/followers",
    followingUrl: "https://test.local/ap/users/bob/following",
    publicKeyPem: "local-public",
    privateKeyPem: "local-private",
  });
  await db.insert(actorCache).values({
    apId: actorApId,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${actorApId}/inbox`,
    publicKeyId: `${actorApId}#main-key`,
    publicKeyPem,
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

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
    id: "https://remote.example/activities/unknown-like",
    type: "Like",
    actor: actorApId,
    object: unknownObject,
  });
  const res = await app.fetch(
    await signedInboxRequest(body, privateKeyPem, `${actorApId}#main-key`),
    { APP_URL: "https://test.local" },
  );

  expect(res.status).toEqual(202);
  expect(
    await db
      .select({ actorApId: likes.actorApId })
      .from(likes)
      .where(eq(likes.objectApId, unknownObject)),
  ).toHaveLength(0);
});

test("activitypub inbox - retains an actionable standard Flag and drops unowned targets", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorApId = "https://remote.example/users/alice";
  const localActor = "https://test.local/ap/users/bob";
  const localObject = "https://test.local/ap/objects/reported-note";
  const { db } = await createTestDb();
  await db.insert(actors).values({
    apId: localActor,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${localActor}/inbox`,
    outbox: `${localActor}/outbox`,
    followersUrl: `${localActor}/followers`,
    followingUrl: `${localActor}/following`,
    publicKeyPem: "local-public",
    privateKeyPem: "local-private",
  });
  await db.insert(objects).values({
    apId: localObject,
    type: "Note",
    attributedTo: localActor,
    content: "reported content",
    isLocal: 1,
  });
  await db.insert(actorCache).values({
    apId: actorApId,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${actorApId}/inbox`,
    publicKeyId: `${actorApId}#main-key`,
    publicKeyPem,
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/", inboxRoutes);

  const actionableBody = JSON.stringify({
    id: "https://remote.example/activities/flag-actionable",
    type: "Flag",
    actor: actorApId,
    // Mastodon-compatible Flag shape: reported post first, actor second.
    object: [localObject, localActor],
    content: "coordinated harassment",
  });
  const actionable = await app.fetch(
    await signedInboxRequest(
      actionableBody,
      privateKeyPem,
      `${actorApId}#main-key`,
    ),
    { APP_URL: "https://test.local" },
  );
  expect(actionable.status).toEqual(202);
  const actionableLedger = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(eq(activities.type, "Flag"))
    .get();
  const actionableActivityId = actionableLedger?.apId;
  expect(typeof actionableActivityId).toBe("string");
  if (!actionableActivityId) throw new Error("Flag ledger row was not stored");
  expect(
    await db
      .select({
        id: reports.id,
        target: reports.targetApId,
        content: reports.content,
      })
      .from(reports),
  ).toEqual([
    {
      id: actionableActivityId,
      target: localObject,
      content: "coordinated harassment",
    },
  ]);

  // Simulate a dispatch that applied the handler effect but lost its terminal
  // ledger commit. The peer retry must re-run safely without appending a second
  // moderation row.
  await db
    .update(activities)
    .set({ processed: 0 })
    .where(eq(activities.apId, actionableActivityId));
  const retried = await app.fetch(
    await signedInboxRequest(
      actionableBody,
      privateKeyPem,
      `${actorApId}#main-key`,
    ),
    { APP_URL: "https://test.local" },
  );
  expect(retried.status).toEqual(202);
  expect(await db.select({ id: reports.id }).from(reports)).toHaveLength(1);

  const unownedBody = JSON.stringify({
    id: "https://remote.example/activities/flag-unowned",
    type: "Flag",
    actor: actorApId,
    object: [
      "https://attacker-chosen.example/objects/not-here",
      "https://remote.example/users/not-local",
    ],
    content: "storage-only noise",
  });
  const unowned = await app.fetch(
    await signedInboxRequest(
      unownedBody,
      privateKeyPem,
      `${actorApId}#main-key`,
    ),
    { APP_URL: "https://test.local" },
  );
  expect(unowned.status).toEqual(202);
  expect(await db.select({ id: reports.id }).from(reports)).toHaveLength(1);
});

function createSharedInboxDbMock(
  publicKeyPem: string,
  localFollowerApIds: string[],
) {
  // The inbound ledger and claim inserts are idempotent. Like dispatch issues
  // further chained inserts, so keep the test double broadly awaitable.
  const insertChain = {
    onConflictDoNothing: () => Promise.resolve({ rowsAffected: 1 }),
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
  const chainableSet = {
    where: () => Promise.resolve({ rowsAffected: 1 }),
  };
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
        findFirst: spy((..._args: unknown[]) =>
          Promise.resolve({ processed: 0 }),
        ),
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
    batch: spy((..._args: unknown[]) => Promise.resolve([])),
    select: spy((..._args: unknown[]) => ({
      from: () => ({ where: () => followerWhere }),
    })),
  };

  return { db, insertValues, limit, findMany };
}

test("activitypub shared inbox verifies, stores, and instance-dispatches Like once", async () => {
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
  // Claim resolution reads the unprocessed ledger exactly once.
  assertSpyCalls(db.query.activities.findFirst, 1);
  // Like is instance-scoped: its handler resolves the affected object itself.
  // It must not be duplicated once per local follower.
  assertSpyCalls(limit, 0);
  assertSpyCalls(findMany, 0);
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
