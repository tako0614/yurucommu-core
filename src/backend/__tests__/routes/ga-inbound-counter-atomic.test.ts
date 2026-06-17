import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, announces, likes, objects } from "../../../db/index.ts";
import {
  handleAnnounce,
  handleLike,
} from "../../routes/activitypub/handlers/inbox-interaction-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

// ---------------------------------------------------------------------------
// GA-fix Wave-9 cluster COUNTER
//   #7 Inbound federated Like/Announce previously inserted the edge row
//      (onConflictDoNothing) and bumped the object counter in a SEPARATE,
//      non-atomic statement. Under wave-8's claim/processed re-dispatch model,
//      an interruption between the insert and the bump left the edge present
//      but the counter un-bumped; the peer's retry hit the no-op insert and
//      SKIPPED the bump → a permanent UNDER-count.
//
//   Fix: edge insert + counter maintenance now commit in a single atomic
//   `db.batch`, and the counter is derived from `COUNT(*)` of the edge table
//   (idempotent recompute) so:
//     1. a fresh delivery applies the count exactly once,
//     2. a genuine duplicate / re-dispatch can never double-count, and
//     3. a re-dispatch after an interrupted bump CONVERGES the count instead
//        of leaving it permanently under-counted.
//
//   These tests run the REAL handlers against a real in-memory libsql DB
//   (which exposes the same atomic `db.batch` surface as D1).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const REMOTE_ACTOR = "https://remote.example/users/alice";
const REMOTE_ACTOR_2 = "https://remote.example/users/carol";
const OBJECT_AP_ID = `${APP_URL}/ap/objects/post-1`;
const LIKE_ACTIVITY = "https://remote.example/activities/like-1";
const ANNOUNCE_ACTIVITY = "https://remote.example/activities/announce-1";

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
  });
}

async function setup(): Promise<Database> {
  const db = await freshDb();
  await seedActor(db, `${APP_URL}/ap/users/bob`, "bob");
  await seedActor(db, REMOTE_ACTOR, "alice");
  await seedActor(db, REMOTE_ACTOR_2, "carol");
  await db.insert(objects).values({
    apId: OBJECT_AP_ID,
    type: "Note",
    attributedTo: `${APP_URL}/ap/users/bob`,
    content: "hello",
    likeCount: 0,
    announceCount: 0,
  });
  return db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
  } as unknown as ActivityContext;
}

function recipientRow() {
  return { apId: `${APP_URL}/ap/users/bob` } as unknown as Parameters<
    typeof handleLike
  >[2];
}

async function likeCount(db: Database): Promise<number> {
  const row = await db
    .select({ likeCount: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, OBJECT_AP_ID))
    .get();
  return row?.likeCount ?? -1;
}

async function announceCount(db: Database): Promise<number> {
  const row = await db
    .select({ announceCount: objects.announceCount })
    .from(objects)
    .where(eq(objects.apId, OBJECT_AP_ID))
    .get();
  return row?.announceCount ?? -1;
}

async function likeEdgeCount(db: Database): Promise<number> {
  const rows = await db
    .select({ a: likes.actorApId })
    .from(likes)
    .where(eq(likes.objectApId, OBJECT_AP_ID));
  return rows.length;
}

const likeActivity = (id: string, actor: string): Activity =>
  ({
    id,
    type: "Like",
    actor,
    object: OBJECT_AP_ID,
  }) as unknown as Activity;

const announceActivity = (id: string, actor: string): Activity =>
  ({
    id,
    type: "Announce",
    actor,
    object: OBJECT_AP_ID,
  }) as unknown as Activity;

test("#7 inbound Like applies the edge + count atomically, exactly once", async () => {
  const db = await setup();
  await handleLike(
    ctxFor(db),
    likeActivity(LIKE_ACTIVITY, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect(await likeEdgeCount(db)).toBe(1);
  expect(await likeCount(db)).toBe(1);
});

test("#7 a duplicate (re-dispatched) inbound Like never double-counts", async () => {
  const db = await setup();
  const act = likeActivity(LIKE_ACTIVITY, REMOTE_ACTOR);

  await handleLike(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  // Re-dispatch the SAME activity from the SAME actor (wave-8 retry).
  await handleLike(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  await handleLike(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);

  expect(await likeEdgeCount(db)).toBe(1); // onConflictDoNothing: still one edge
  expect(await likeCount(db)).toBe(1); // recompute: never inflated
});

test("#7 a re-dispatch after an interrupted counter bump CONVERGES (no permanent under-count)", async () => {
  const db = await setup();

  // Simulate the exact wave-8 hazard: a prior dispatch managed to insert the
  // edge row but was interrupted BEFORE the counter was bumped, so the edge is
  // present while likeCount is still 0. Pre-fix, the retry's no-op insert
  // skipped the bump and the count stayed permanently under-counted at 0.
  await db.insert(likes).values({
    actorApId: REMOTE_ACTOR,
    objectApId: OBJECT_AP_ID,
    activityApId: LIKE_ACTIVITY,
  });
  expect(await likeCount(db)).toBe(0); // edge present, counter stale

  // Peer retry re-dispatches the same activity. The idempotent recompute must
  // converge the counter to the true edge count.
  await handleLike(
    ctxFor(db),
    likeActivity(LIKE_ACTIVITY, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect(await likeEdgeCount(db)).toBe(1);
  expect(await likeCount(db)).toBe(1); // converged, not stuck at 0
});

test("#7 distinct actors each count once (count tracks the edge set)", async () => {
  const db = await setup();

  await handleLike(
    ctxFor(db),
    likeActivity(LIKE_ACTIVITY, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );
  await handleLike(
    ctxFor(db),
    likeActivity("https://remote.example/activities/like-2", REMOTE_ACTOR_2),
    recipientRow(),
    REMOTE_ACTOR_2,
    APP_URL,
  );

  expect(await likeEdgeCount(db)).toBe(2);
  expect(await likeCount(db)).toBe(2);
});

test("#7 inbound Announce applies + recomputes atomically and idempotently", async () => {
  const db = await setup();
  const act = announceActivity(ANNOUNCE_ACTIVITY, REMOTE_ACTOR);

  await handleAnnounce(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  await handleAnnounce(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);

  const announceRows = await db
    .select({ a: announces.actorApId })
    .from(announces)
    .where(eq(announces.objectApId, OBJECT_AP_ID));
  expect(announceRows.length).toBe(1);
  expect(await announceCount(db)).toBe(1);
});
