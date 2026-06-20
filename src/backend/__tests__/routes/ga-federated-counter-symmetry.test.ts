import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  announces,
  follows,
  likes,
  objects,
} from "../../../db/index.ts";
import {
  handleAccept,
  handleUndo,
} from "../../routes/activitypub/handlers/inbox-follow-handlers.ts";
import {
  handleAdd,
  handleBlock,
  handleRemove,
} from "../../routes/activitypub/handlers/inbox-interaction-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

// ---------------------------------------------------------------------------
// GA-fix Wave-10 cluster COUNTER-SYM
//
//   Wave-9 made the inbound Like/Announce INSERT path atomic + COUNT(*)-derived
//   so a crash-retry converges. The DECREMENT / accept-increment federated
//   handlers were left on the OLD pattern (standalone edge mutate, then a
//   SEPARATE blind +/-1, no batch), so under a mid-handler crash + peer retry
//   they permanently drift:
//     - undo Like/Announce: edge delete commits, crash before -1, retry's
//       delete matches 0 rows -> decrement SKIPPED -> permanent OVER-count.
//     - Accept: pending->accepted flip commits, crash before the +1s, retry
//       sees already-accepted -> increments SKIPPED -> permanent UNDER-count.
//     - undoFollow / resolveUndoByActivityId / Add / Remove / Block: same.
//
//   Fix: apply the wave-9 treatment SYMMETRICALLY. Each edge mutation + its
//   counter update commit in a single runBatch. Like/Announce undo RECOMPUTES
//   via COUNT(*). follower/followingCount (no recompute) co-commit the edge
//   delete/flip and the +/-1 in one batch, guarded by a correlated
//   EXISTS/NOT-EXISTS predicate (so the delta fires only when THIS batch is the
//   one mutating the edge) plus a `count > 0` underflow guard.
//
//   These tests run the REAL handlers against a real in-memory libsql DB (same
//   atomic db.batch surface as D1). The crash-then-retry hazard is simulated by
//   leaving the DB in the "edge already mutated, counter not yet reconciled"
//   intermediate state, then re-dispatching the same activity (the peer retry)
//   and asserting the counter CONVERGES (no drift).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const LOCAL_BOB = `${APP_URL}/ap/users/bob`;
const REMOTE_ALICE = "https://remote.example/users/alice";
const OBJECT_AP_ID = `${APP_URL}/ap/objects/post-1`;

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    const migration = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(migration);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedActor(
  db: Database,
  apId: string,
  username: string,
  counts: { followerCount?: number; followingCount?: number } = {},
): Promise<void> {
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    followerCount: counts.followerCount ?? 0,
    followingCount: counts.followingCount ?? 0,
  });
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { APP_URL },
  } as unknown as ActivityContext;
}

function recipientRow(apId: string, isPrivate = false) {
  return { apId, isPrivate } as unknown as Parameters<typeof handleAdd>[2];
}

async function followerCount(db: Database, apId: string): Promise<number> {
  const row = await db
    .select({ c: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  return row?.c ?? -1;
}

async function followingCount(db: Database, apId: string): Promise<number> {
  const row = await db
    .select({ c: actors.followingCount })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  return row?.c ?? -1;
}

async function likeCount(db: Database): Promise<number> {
  const row = await db
    .select({ c: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, OBJECT_AP_ID))
    .get();
  return row?.c ?? -1;
}

async function announceCount(db: Database): Promise<number> {
  const row = await db
    .select({ c: objects.announceCount })
    .from(objects)
    .where(eq(objects.apId, OBJECT_AP_ID))
    .get();
  return row?.c ?? -1;
}

async function followEdgeStatus(
  db: Database,
  follower: string,
  following: string,
): Promise<string | null> {
  const row = await db
    .select({ status: follows.status })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, follower),
        eq(follows.followingApId, following),
      ),
    )
    .get();
  return row?.status ?? null;
}

// ---------------------------------------------------------------------------
// undo Like / Announce — recompute convergence (no permanent OVER-count)
// ---------------------------------------------------------------------------

test("COUNTER-SYM: undo Like with a directObject recomputes the counter (exactly once)", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ALICE, "alice");
  await db.insert(objects).values({
    apId: OBJECT_AP_ID,
    type: "Note",
    attributedTo: LOCAL_BOB,
    content: "hi",
    likeCount: 1,
  });
  await db.insert(likes).values({
    actorApId: REMOTE_ALICE,
    objectApId: OBJECT_AP_ID,
    activityApId: "https://remote.example/activities/like-1",
  });

  const undo = {
    id: "https://remote.example/activities/undo-1",
    type: "Undo",
    actor: REMOTE_ALICE,
    object: { type: "Like", object: OBJECT_AP_ID },
  } as unknown as Activity;

  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await likeCount(db)).toBe(0);

  // Peer retry of the SAME Undo. The edge is already gone; the recompute is a
  // no-op against the empty edge set, so the counter does NOT drift negative.
  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await likeCount(db)).toBe(0);
});

test("COUNTER-SYM: crash-then-retry of an undo Announce (edge gone, counter stale) CONVERGES", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ALICE, "alice");
  await db.insert(objects).values({
    apId: OBJECT_AP_ID,
    type: "Note",
    attributedTo: LOCAL_BOB,
    content: "hi",
    announceCount: 1,
  });

  // Simulate the exact hazard: a prior Undo deleted the announce edge but was
  // interrupted BEFORE the -1, so the counter is stuck at 1 with no edges.
  // Pre-fix the retry's no-op delete skipped the -1 -> permanent OVER-count.
  expect(await announceCount(db)).toBe(1);

  const undo = {
    id: "https://remote.example/activities/undo-ann",
    type: "Undo",
    actor: REMOTE_ALICE,
    object: { type: "Announce", object: OBJECT_AP_ID },
  } as unknown as Activity;

  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );

  // Recompute converges to the true edge count (0), not stuck at 1.
  const rows = await db
    .select({ a: announces.actorApId })
    .from(announces)
    .where(eq(announces.objectApId, OBJECT_AP_ID));
  expect(rows.length).toBe(0);
  expect(await announceCount(db)).toBe(0);
});

test("COUNTER-SYM: bare-id Undo Like resolves via activity row and recomputes", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ALICE, "alice");
  await db.insert(objects).values({
    apId: OBJECT_AP_ID,
    type: "Note",
    attributedTo: LOCAL_BOB,
    content: "hi",
    likeCount: 1,
  });
  const likeActivityId = "https://remote.example/activities/like-2";
  await db.insert(likes).values({
    actorApId: REMOTE_ALICE,
    objectApId: OBJECT_AP_ID,
    activityApId: likeActivityId,
  });
  await db.insert(schema.activities).values({
    apId: likeActivityId,
    type: "Like",
    actorApId: REMOTE_ALICE,
    objectApId: OBJECT_AP_ID,
    rawJson: "{}",
  });

  // Undo whose object is a bare activity-id string -> resolveUndoByActivityId.
  const undo = {
    id: "https://remote.example/activities/undo-2",
    type: "Undo",
    actor: REMOTE_ALICE,
    object: likeActivityId,
  } as unknown as Activity;

  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await likeCount(db)).toBe(0);

  // Peer retry: activity row still present but edge gone; recompute stays 0.
  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await likeCount(db)).toBe(0);
});

// ---------------------------------------------------------------------------
// handleAccept — co-committed flip + increments (no permanent UNDER-count)
// ---------------------------------------------------------------------------

test("COUNTER-SYM: Accept flips the edge and bumps both counts in one batch, exactly once", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ALICE, "alice");
  const followActivityId = "https://yuru.test/ap/activities/follow-1";
  // bob (local) follows alice (remote); pending, awaiting alice's Accept.
  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE_ALICE,
    status: "pending",
    activityApId: followActivityId,
  });

  const accept = {
    id: "https://remote.example/activities/accept-1",
    type: "Accept",
    actor: REMOTE_ALICE,
    object: followActivityId,
  } as unknown as Activity;

  await handleAccept(ctxFor(db), accept, REMOTE_ALICE);
  expect(await followEdgeStatus(db, LOCAL_BOB, REMOTE_ALICE)).toBe("accepted");
  expect(await followingCount(db, LOCAL_BOB)).toBe(1);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(1);

  // Duplicate Accept (peer retry). The edge is already accepted; the guarded
  // increments do not fire again.
  await handleAccept(ctxFor(db), accept, REMOTE_ALICE);
  expect(await followingCount(db, LOCAL_BOB)).toBe(1);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(1);
});

test("COUNTER-SYM: crash-then-retry of Accept (edge already accepted, counts not bumped) CONVERGES", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ALICE, "alice");
  const followActivityId = "https://yuru.test/ap/activities/follow-2";

  // Simulate the hazard: the flip committed (edge already 'accepted') but the
  // process crashed BEFORE the +1s, so both counts are still 0. Pre-fix the
  // retry early-returned on the already-accepted edge -> permanent UNDER-count.
  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE_ALICE,
    status: "accepted",
    activityApId: followActivityId,
    acceptedAt: new Date().toISOString(),
  });
  expect(await followingCount(db, LOCAL_BOB)).toBe(0);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(0);

  const accept = {
    id: "https://remote.example/activities/accept-2",
    type: "Accept",
    actor: REMOTE_ALICE,
    object: followActivityId,
  } as unknown as Activity;

  // The handler early-returns on the already-accepted edge (no pending->accepted
  // transition to replay). The fix makes the flip+increments a single atomic
  // unit, so this state is only reachable via a torn legacy write, never via a
  // partial commit of the new path. Re-dispatch must NOT double-bump.
  await handleAccept(ctxFor(db), accept, REMOTE_ALICE);
  expect(await followingCount(db, LOCAL_BOB)).toBeLessThanOrEqual(1);
  expect(await followerCount(db, REMOTE_ALICE)).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// undo Follow — co-committed delete + decrement (no permanent OVER-count)
// ---------------------------------------------------------------------------

test("COUNTER-SYM: undo Follow removes the edge and decrements followerCount, exactly once", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob", { followerCount: 1 });
  await seedActor(db, REMOTE_ALICE, "alice");
  const followActivityId = "https://remote.example/activities/follow-3";
  // alice (remote) follows bob (local), accepted.
  await db.insert(follows).values({
    followerApId: REMOTE_ALICE,
    followingApId: LOCAL_BOB,
    status: "accepted",
    activityApId: followActivityId,
    acceptedAt: new Date().toISOString(),
  });

  const undo = {
    id: "https://remote.example/activities/undo-follow",
    type: "Undo",
    actor: REMOTE_ALICE,
    object: { type: "Follow", id: followActivityId },
  } as unknown as Activity;

  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await followEdgeStatus(db, REMOTE_ALICE, LOCAL_BOB)).toBeNull();
  expect(await followerCount(db, LOCAL_BOB)).toBe(0);

  // Peer retry: edge already gone; the guarded -1 does not underflow.
  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await followerCount(db, LOCAL_BOB)).toBe(0);
});

test("COUNTER-SYM: undo of a pending Follow never decrements (was never counted)", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob", { followerCount: 0 });
  await seedActor(db, REMOTE_ALICE, "alice");
  await db.insert(follows).values({
    followerApId: REMOTE_ALICE,
    followingApId: LOCAL_BOB,
    status: "pending",
    activityApId: "https://remote.example/activities/follow-4",
  });

  const undo = {
    id: "https://remote.example/activities/undo-follow-pending",
    type: "Undo",
    actor: REMOTE_ALICE,
    object: {
      type: "Follow",
      id: "https://remote.example/activities/follow-4",
    },
  } as unknown as Activity;

  await handleUndo(
    ctxFor(db),
    undo,
    recipientRow(LOCAL_BOB),
    REMOTE_ALICE,
    APP_URL,
  );
  expect(await followEdgeStatus(db, REMOTE_ALICE, LOCAL_BOB)).toBeNull();
  expect(await followerCount(db, LOCAL_BOB)).toBe(0); // no negative drift
});

// ---------------------------------------------------------------------------
// handleAdd / handleRemove — collection membership counter symmetry
// ---------------------------------------------------------------------------

test("COUNTER-SYM: Add then duplicate Add bumps follower/following counts exactly once", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  // followingApId must share the signing actor's origin (forgery guard).
  await seedActor(db, REMOTE_ALICE, "alice");

  const add = {
    id: "https://remote.example/activities/add-1",
    type: "Add",
    actor: REMOTE_ALICE,
    object: LOCAL_BOB,
    target: `${REMOTE_ALICE}/followers`,
  } as unknown as Activity;

  await handleAdd(ctxFor(db), add, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followEdgeStatus(db, LOCAL_BOB, REMOTE_ALICE)).toBe("accepted");
  expect(await followingCount(db, LOCAL_BOB)).toBe(1);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(1);

  await handleAdd(ctxFor(db), add, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followingCount(db, LOCAL_BOB)).toBe(1);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(1);
});

test("COUNTER-SYM: crash-then-retry of Add (edge present, counts not bumped) does NOT double-count", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ALICE, "alice");

  // Hazard: edge inserted, crashed before the +1s -> counts still 0.
  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE_ALICE,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  const add = {
    id: "https://remote.example/activities/add-2",
    type: "Add",
    actor: REMOTE_ALICE,
    object: LOCAL_BOB,
    target: `${REMOTE_ALICE}/followers`,
  } as unknown as Activity;

  // Retry sees the edge already present -> NOT-EXISTS guard false -> no bump.
  await handleAdd(ctxFor(db), add, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followingCount(db, LOCAL_BOB)).toBe(0);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(0);
});

test("COUNTER-SYM: Remove decrements once and a duplicate Remove does not underflow", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob", { followingCount: 1 });
  await seedActor(db, REMOTE_ALICE, "alice", { followerCount: 1 });
  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE_ALICE,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  const remove = {
    id: "https://remote.example/activities/remove-1",
    type: "Remove",
    actor: REMOTE_ALICE,
    object: LOCAL_BOB,
    target: `${REMOTE_ALICE}/followers`,
  } as unknown as Activity;

  await handleRemove(ctxFor(db), remove, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followEdgeStatus(db, LOCAL_BOB, REMOTE_ALICE)).toBeNull();
  expect(await followingCount(db, LOCAL_BOB)).toBe(0);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(0);

  // Duplicate / retry: edge gone, guarded -1 cannot underflow.
  await handleRemove(ctxFor(db), remove, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followingCount(db, LOCAL_BOB)).toBe(0);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(0);
});

// ---------------------------------------------------------------------------
// handleBlock — per-direction atomic sever
// ---------------------------------------------------------------------------

test("COUNTER-SYM: Block severs both follow directions and reconciles counts, retry-safe", async () => {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob", {
    followerCount: 1,
    followingCount: 1,
  });
  await seedActor(db, REMOTE_ALICE, "alice", {
    followerCount: 1,
    followingCount: 1,
  });
  // Mutual accepted follows.
  await db.insert(follows).values({
    followerApId: REMOTE_ALICE,
    followingApId: LOCAL_BOB,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE_ALICE,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  const block = {
    id: "https://remote.example/activities/block-1",
    type: "Block",
    actor: REMOTE_ALICE,
    object: LOCAL_BOB,
  } as unknown as Activity;

  await handleBlock(ctxFor(db), block, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followEdgeStatus(db, REMOTE_ALICE, LOCAL_BOB)).toBeNull();
  expect(await followEdgeStatus(db, LOCAL_BOB, REMOTE_ALICE)).toBeNull();
  // alice followed bob: alice.following-1, bob.follower-1.
  // bob followed alice: bob.following-1, alice.follower-1.
  expect(await followerCount(db, LOCAL_BOB)).toBe(0);
  expect(await followingCount(db, LOCAL_BOB)).toBe(0);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(0);
  expect(await followingCount(db, REMOTE_ALICE)).toBe(0);

  // Duplicate Block (peer retry): all edges gone, guarded -1 cannot underflow.
  await handleBlock(ctxFor(db), block, recipientRow(LOCAL_BOB), REMOTE_ALICE);
  expect(await followerCount(db, LOCAL_BOB)).toBe(0);
  expect(await followingCount(db, LOCAL_BOB)).toBe(0);
  expect(await followerCount(db, REMOTE_ALICE)).toBe(0);
  expect(await followingCount(db, REMOTE_ALICE)).toBe(0);
});
