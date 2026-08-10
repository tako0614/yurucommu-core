import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  type D1Statement,
  insertMany,
  remoteActorFetchFailures,
  runBatch,
} from "../../../db/index.ts";
import { parseRemoteActor } from "../../lib/activitypub-validators.ts";
import {
  buildActorCacheFields,
  claimRemoteActorFetch,
  clearRemoteActorFetchFailure,
  getRemoteActorFetchFailure,
  reapRemoteActorFetchFailures,
  recordRemoteActorFetchFailure,
} from "../../lib/activitypub-actor-cache.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

// Spin up an in-memory libsql database with the real actor_cache schema so we
// can assert the canonical cache fields round-trip through Drizzle to the
// physical columns (catching any column-name drift) — the regression that this
// helper unifies away.
async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

// The four previously-divergent delivery-relevant columns. Before unification,
// the inbox cache path omitted these, so whether a cached actor row carried
// them depended on whichever path fetched it first.
const DELIVERY_COLUMNS = [
  "outbox",
  "followersUrl",
  "followingUrl",
  "sharedInbox",
] as const;

test("buildActorCacheFields always emits the delivery columns, even for a minimal (inbox-only) actor document", () => {
  // The shape the inbox cold-cache path used to special-case: only inbox and
  // a public key. The old inbox-local buildActorCacheFields dropped outbox /
  // followersUrl / followingUrl / sharedInbox entirely for this shape.
  const minimal = parseRemoteActor({
    id: "https://remote.example/users/min",
    type: "Person",
    inbox: "https://remote.example/users/min/inbox",
    publicKey: {
      id: "https://remote.example/users/min#main-key",
      publicKeyPem: "PEM",
    },
  });

  const fields = buildActorCacheFields(minimal);

  for (const column of DELIVERY_COLUMNS) {
    expect(column in fields).toBe(true);
    // Absent in the document => explicitly null (not silently omitted).
    expect(fields[column]).toBeNull();
  }
});

test("buildActorCacheFields populates sharedInbox / outbox / followers from a full Mastodon actor", () => {
  const actor = parseRemoteActor({
    id: "https://mastodon.example/users/alice",
    type: "Person",
    preferredUsername: "alice",
    name: "Alice",
    inbox: "https://mastodon.example/users/alice/inbox",
    outbox: "https://mastodon.example/users/alice/outbox",
    followers: "https://mastodon.example/users/alice/followers",
    following: "https://mastodon.example/users/alice/following",
    endpoints: { sharedInbox: "https://mastodon.example/inbox" },
    publicKey: {
      id: "https://mastodon.example/users/alice#main-key",
      publicKeyPem: "PEM",
    },
  });

  const fields = buildActorCacheFields(actor);

  expect(fields.inbox).toBe("https://mastodon.example/users/alice/inbox");
  expect(fields.outbox).toBe("https://mastodon.example/users/alice/outbox");
  expect(fields.followersUrl).toBe(
    "https://mastodon.example/users/alice/followers",
  );
  expect(fields.followingUrl).toBe(
    "https://mastodon.example/users/alice/following",
  );
  // The primary fan-out target for Mastodon-scale servers — the column whose
  // loss the unification fixes.
  expect(fields.sharedInbox).toBe("https://mastodon.example/inbox");
});

test("buildActorCacheFields truncates oversized remote name / summary / preferredUsername", () => {
  // Remote display fields are attacker-controlled and bounded only by the fetch
  // size — an actor doc with megabyte-long fields would bloat every feed row /
  // search result that renders the cached actor. The cache chokepoint truncates
  // to the local profile caps (name 50, summary 500, username 100).
  const actor = parseRemoteActor({
    id: "https://remote.example/users/whale",
    type: "Person",
    preferredUsername: "u".repeat(5000),
    name: "N".repeat(5000),
    summary: "S".repeat(50000),
    inbox: "https://remote.example/users/whale/inbox",
    publicKey: {
      id: "https://remote.example/users/whale#main-key",
      publicKeyPem: "PEM",
    },
  });

  const fields = buildActorCacheFields(actor);

  expect(fields.name?.length).toBe(50);
  expect(fields.summary?.length).toBe(500);
  expect(fields.preferredUsername?.length).toBe(100);
  // An empty string still normalizes to null (not a 0-length string).
  const blank = buildActorCacheFields(
    parseRemoteActor({
      id: "https://remote.example/users/blank",
      type: "Person",
      name: "",
      summary: "",
      inbox: "https://remote.example/users/blank/inbox",
    }),
  );
  expect(blank.name).toBeNull();
  expect(blank.summary).toBeNull();
});

test("canonical cache fields round-trip to the actor_cache table including shared_inbox", async () => {
  const db = await freshDb();
  const apId = "https://mastodon.example/users/alice";
  const actor = parseRemoteActor({
    id: apId,
    type: "Person",
    inbox: "https://mastodon.example/users/alice/inbox",
    endpoints: { sharedInbox: "https://mastodon.example/inbox" },
    publicKey: {
      id: `${apId}#main-key`,
      publicKeyPem: "PEM",
    },
  });

  // Mirror the single upsert every fetch path now performs through the helper.
  const fields = buildActorCacheFields(actor);
  await db
    .insert(actorCache)
    .values({ apId, ...fields })
    .onConflictDoUpdate({ target: actorCache.apId, set: fields });

  const row = await db
    .select()
    .from(actorCache)
    .where(eq(actorCache.apId, apId))
    .get();

  expect(row).toBeTruthy();
  expect(row!.sharedInbox).toBe("https://mastodon.example/inbox");
  expect(row!.inbox).toBe("https://mastodon.example/users/alice/inbox");
});

test("remote actor fetch failures preserve retry authority and exponential cooldown", async () => {
  const db = await freshDb();
  const apId = "https://remote.example/users/unavailable";
  const firstAt = new Date("2026-08-10T00:00:00.000Z");
  const first = await recordRemoteActorFetchFailure(
    db,
    apId,
    {
      ok: false,
      reason: "fetch_not_ok",
      status: 503,
      retryAfterSeconds: 120,
    },
    firstAt,
  );
  expect(first).toMatchObject({
    kind: "unavailable",
    httpStatus: 503,
    failureCount: 1,
    retryAfterSeconds: 120,
  });
  expect(
    await getRemoteActorFetchFailure(
      db,
      apId,
      new Date("2026-08-10T00:00:01.000Z"),
    ),
  ).toMatchObject({ retryAfterSeconds: 119 });
  expect(
    await getRemoteActorFetchFailure(
      db,
      apId,
      new Date("2026-08-10T00:02:01.000Z"),
    ),
  ).toBeNull();

  const second = await recordRemoteActorFetchFailure(
    db,
    apId,
    { ok: false, reason: "fetch_failed" },
    new Date("2026-08-10T00:02:01.000Z"),
  );
  expect(second).toMatchObject({
    kind: "unavailable",
    failureCount: 2,
    retryAfterSeconds: 60,
  });

  await clearRemoteActorFetchFailure(db, apId);
  expect(
    await db
      .select()
      .from(remoteActorFetchFailures)
      .where(eq(remoteActorFetchFailures.actorApId, apId))
      .get(),
  ).toBeUndefined();
});

test("remote actor fetch claims serialize concurrent GETs and fence stale owners", async () => {
  const db = await freshDb();
  const apId = "https://remote.example/users/leased";
  const startedAt = new Date("2026-08-10T00:00:00.000Z");

  const first = await claimRemoteActorFetch(db, apId, startedAt);
  expect(first.owned).toBe(true);
  if (!first.owned) throw new Error("first fetch claim was not owned");

  const concurrent = await claimRemoteActorFetch(
    db,
    apId,
    new Date("2026-08-10T00:00:01.000Z"),
  );
  expect(concurrent).toMatchObject({
    owned: false,
    failure: { kind: "unavailable", retryAfterSeconds: 29 },
  });

  const reclaimed = await claimRemoteActorFetch(
    db,
    apId,
    new Date("2026-08-10T00:00:31.000Z"),
  );
  expect(reclaimed.owned).toBe(true);
  if (!reclaimed.owned)
    throw new Error("expired fetch claim was not reclaimed");
  expect(reclaimed.token).not.toBe(first.token);

  // The first (now stale) owner cannot overwrite the newer claim's decision.
  await recordRemoteActorFetchFailure(
    db,
    apId,
    { ok: false, reason: "fetch_not_ok", status: 410, retryAfterSeconds: null },
    new Date("2026-08-10T00:00:32.000Z"),
    first.token,
  );
  await clearRemoteActorFetchFailure(db, apId, first.token);
  expect(
    await db
      .select()
      .from(remoteActorFetchFailures)
      .where(eq(remoteActorFetchFailures.actorApId, apId))
      .get(),
  ).toMatchObject({
    processingToken: reclaimed.token,
    failureCount: 0,
  });

  const recorded = await recordRemoteActorFetchFailure(
    db,
    apId,
    { ok: false, reason: "fetch_failed" },
    new Date("2026-08-10T00:00:33.000Z"),
    reclaimed.token,
  );
  expect(recorded).toMatchObject({
    kind: "unavailable",
    failureCount: 1,
    retryAfterSeconds: 30,
  });
});

test("410 Gone is terminal until bounded retention reaps the negative cache", async () => {
  const db = await freshDb();
  const apId = "https://remote.example/users/gone";
  const failure = await recordRemoteActorFetchFailure(
    db,
    apId,
    {
      ok: false,
      reason: "fetch_not_ok",
      status: 410,
      retryAfterSeconds: null,
    },
    new Date("2026-01-01T00:00:00.000Z"),
  );
  expect(failure).toMatchObject({
    kind: "gone",
    httpStatus: 410,
    retryAt: null,
    retryAfterSeconds: null,
  });
  expect(
    await getRemoteActorFetchFailure(
      db,
      apId,
      new Date("2026-01-20T00:00:00.000Z"),
    ),
  ).toMatchObject({ kind: "gone" });
});

test("remote actor failure retention is bounded to 50 D1-safe rows per pass", async () => {
  const db = await freshDb();
  const oldAt = "2026-01-01T00:00:00.000Z";
  const recentAt = "2026-08-09T00:00:00.000Z";
  const inserts = insertMany(db, remoteActorFetchFailures, [
    ...Array.from({ length: 51 }, (_, index) => ({
      actorApId: `https://old.example/users/${index}`,
      kind: "unavailable",
      reason: "fetch_failed",
      failureCount: 1,
      retryAt: "2026-01-01T00:00:30.000Z",
      createdAt: oldAt,
      updatedAt: oldAt,
    })),
    {
      actorApId: "https://recent.example/users/kept",
      kind: "unavailable",
      reason: "fetch_failed",
      failureCount: 1,
      retryAt: "2026-08-09T00:00:30.000Z",
      createdAt: recentAt,
      updatedAt: recentAt,
    },
  ]);
  await runBatch(db, inserts as readonly [D1Statement, ...D1Statement[]]);

  const now = new Date("2026-08-10T00:00:00.000Z");
  expect(await db.select().from(remoteActorFetchFailures)).toHaveLength(52);
  expect(await reapRemoteActorFetchFailures(db, now)).toBe(50);
  expect(await db.select().from(remoteActorFetchFailures)).toHaveLength(2);
  expect(await reapRemoteActorFetchFailures(db, now)).toBe(1);
  expect(await db.select().from(remoteActorFetchFailures)).toEqual([
    expect.objectContaining({
      actorApId: "https://recent.example/users/kept",
    }),
  ]);
});

test("remote actor failure retention preserves an active fetch lease", async () => {
  const db = await freshDb();
  await db.insert(remoteActorFetchFailures).values({
    actorApId: "https://old.example/users/actively-fetching",
    kind: "unavailable",
    reason: "fetch_failed",
    failureCount: 0,
    processingToken: "active-token",
    leaseExpiresAt: "2026-08-10T00:00:30.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(
    await reapRemoteActorFetchFailures(
      db,
      new Date("2026-08-10T00:00:00.000Z"),
    ),
  ).toBe(0);
  expect(await db.select().from(remoteActorFetchFailures)).toHaveLength(1);
});
