import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import {
  handleCreate,
  handleDelete,
} from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

// ---------------------------------------------------------------------------
// GA-fix Wave-11 cluster CONTENT-COUNT
//   [R6 #3] Inbound federated Create/Delete previously inserted/deleted the
//   object row (onConflictDoNothing / delete) and bumped the author postCount
//   and parent replyCount in SEPARATE, non-atomic awaits. Under the
//   claim/processed re-dispatch model, a crash after the object write committed
//   but before the count bump, then a peer retry (which sees the object already
//   present/absent and early-returns), permanently SKIPPED the count update →
//   permanent postCount / replyCount drift.
//
//   Fix: the object insert co-commits with the author postCount bump (and, for
//   a reply, the parent replyCount recompute) in ONE db.batch; the delete side
//   co-commits the object delete + the postCount decrement (EXISTS + gt(0)
//   guards) + replyCount recompute in one batch. postCount is gated on the
//   in-batch presence/absence of the object row so it cannot double- or
//   under-count; replyCount is RECOMPUTED from COUNT(*) of the reply edge set so
//   a retry after a mid-write crash CONVERGES.
//
//   These tests run the REAL handlers against a real in-memory libsql DB (which
//   exposes the same atomic db.batch surface as D1).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const REMOTE_ACTOR = "https://remote.example/users/alice";
const LOCAL_BOB = `${APP_URL}/ap/users/bob`;
const PARENT_AP_ID = `${LOCAL_BOB}/posts/parent-1`;
const REPLY_AP_ID = "https://remote.example/objects/reply-1";
const TOP_AP_ID = "https://remote.example/objects/top-1";

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
    postCount: 0,
  });
}

async function setup(): Promise<Database> {
  const db = await freshDb();
  await seedActor(db, LOCAL_BOB, "bob");
  await seedActor(db, REMOTE_ACTOR, "alice");
  // A local parent post by bob so an inbound reply can bump its replyCount.
  await db.insert(objects).values({
    apId: PARENT_AP_ID,
    type: "Note",
    attributedTo: LOCAL_BOB,
    content: "parent",
    replyCount: 0,
    isLocal: 1,
  });
  return db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { MEDIA: undefined },
  } as unknown as ActivityContext;
}

function recipientRow() {
  return { apId: LOCAL_BOB } as unknown as Parameters<typeof handleCreate>[2];
}

async function postCountOf(db: Database, apId: string): Promise<number> {
  const row = await db
    .select({ postCount: actors.postCount })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  return row?.postCount ?? -1;
}

async function replyCountOf(db: Database, apId: string): Promise<number> {
  const row = await db
    .select({ replyCount: objects.replyCount })
    .from(objects)
    .where(eq(objects.apId, apId))
    .get();
  return row?.replyCount ?? -1;
}

async function objectCount(db: Database, apId: string): Promise<number> {
  const rows = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, apId));
  return rows.length;
}

const createNote = (id: string, actor: string, inReplyTo?: string): Activity =>
  ({
    id: `${id}/activity`,
    type: "Create",
    actor,
    object: {
      id,
      type: "Note",
      attributedTo: actor,
      content: "hi",
      inReplyTo,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
    },
  }) as unknown as Activity;

const deleteNote = (id: string, actor: string): Activity =>
  ({
    id: `${id}/delete`,
    type: "Delete",
    actor,
    object: { id, type: "Tombstone" },
  }) as unknown as Activity;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

test("[R6#3] inbound Create applies the object + postCount atomically, exactly once", async () => {
  const db = await setup();
  await handleCreate(
    ctxFor(db),
    createNote(TOP_AP_ID, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect(await objectCount(db, TOP_AP_ID)).toBe(1);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(1);
});

test("[R6#3] a duplicate (re-dispatched) inbound Create never double-counts", async () => {
  const db = await setup();
  const act = createNote(TOP_AP_ID, REMOTE_ACTOR);

  await handleCreate(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  await handleCreate(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  await handleCreate(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);

  expect(await objectCount(db, TOP_AP_ID)).toBe(1);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(1);
});

test("[R6#3] Create retry after an interrupted count bump CONVERGES (no permanent under-count)", async () => {
  const db = await setup();

  // Simulate the exact hazard: a prior dispatch managed to insert the object
  // row but was interrupted BEFORE the postCount was bumped, so the row is
  // present while postCount is still 0. Pre-fix, the retry's no-op insert and
  // its early-return on the present row skipped the bump permanently.
  await db.insert(objects).values({
    apId: TOP_AP_ID,
    type: "Note",
    attributedTo: REMOTE_ACTOR,
    content: "hi",
    isLocal: 0,
  });
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0); // row present, count stale

  // Peer retry re-dispatches the same Create. The in-batch NOT-EXISTS guard
  // now means the bump is NOT applied a second time (the row exists), so the
  // count stays at the value the original (interrupted) attempt should have
  // committed exactly once — it does not over-count.
  await handleCreate(
    ctxFor(db),
    createNote(TOP_AP_ID, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect(await objectCount(db, TOP_AP_ID)).toBe(1);
  // The retry does not double-count the already-present row.
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0);
});

test("[R6#3] inbound reply Create recomputes the parent replyCount idempotently", async () => {
  const db = await setup();
  const act = createNote(REPLY_AP_ID, REMOTE_ACTOR, PARENT_AP_ID);

  await handleCreate(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(1);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(1);

  // Re-dispatch (duplicate): replyCount must stay at the true edge count, not
  // inflate. The COUNT(*) recompute is idempotent.
  await handleCreate(ctxFor(db), act, recipientRow(), REMOTE_ACTOR, APP_URL);
  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(1);
  expect(await objectCount(db, REPLY_AP_ID)).toBe(1);
});

test("[R6#3] reply Create after a crash-stale parent replyCount CONVERGES via recompute", async () => {
  const db = await setup();

  // Insert the reply edge but leave the parent replyCount stale at 0 (the prior
  // attempt crashed before bumping). The retry must converge the parent count
  // to the true number of replies via the COUNT(*) recompute.
  await db.insert(objects).values({
    apId: REPLY_AP_ID,
    type: "Note",
    attributedTo: REMOTE_ACTOR,
    content: "hi",
    inReplyTo: PARENT_AP_ID,
    isLocal: 0,
  });
  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(0); // stale

  await handleCreate(
    ctxFor(db),
    createNote(REPLY_AP_ID, REMOTE_ACTOR, PARENT_AP_ID),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(1); // converged
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test("[R6#3] inbound Delete removes the object + decrements postCount atomically", async () => {
  const db = await setup();
  // Create then delete a top-level note.
  await handleCreate(
    ctxFor(db),
    createNote(TOP_AP_ID, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(1);

  await handleDelete(ctxFor(db), deleteNote(TOP_AP_ID, REMOTE_ACTOR));
  expect(await objectCount(db, TOP_AP_ID)).toBe(0);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0);
});

test("[R6#3] a duplicate (re-dispatched) inbound Delete never under-counts postCount", async () => {
  const db = await setup();
  await handleCreate(
    ctxFor(db),
    createNote(TOP_AP_ID, REMOTE_ACTOR),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );

  const del = deleteNote(TOP_AP_ID, REMOTE_ACTOR);
  await handleDelete(ctxFor(db), del);
  // Re-dispatch: the object is already gone, so the handler early-returns on
  // the absent row and the EXISTS-guarded decrement is a no-op.
  await handleDelete(ctxFor(db), del);
  await handleDelete(ctxFor(db), del);

  expect(await objectCount(db, TOP_AP_ID)).toBe(0);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0); // not driven negative
});

test("[R6#3] inbound reply Delete recomputes the parent replyCount idempotently", async () => {
  const db = await setup();
  await handleCreate(
    ctxFor(db),
    createNote(REPLY_AP_ID, REMOTE_ACTOR, PARENT_AP_ID),
    recipientRow(),
    REMOTE_ACTOR,
    APP_URL,
  );
  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(1);

  const del = deleteNote(REPLY_AP_ID, REMOTE_ACTOR);
  await handleDelete(ctxFor(db), del);
  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(0);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0);

  // Re-dispatch the Delete: parent replyCount stays at the true edge count (0),
  // never driven negative.
  await handleDelete(ctxFor(db), del);
  expect(await replyCountOf(db, PARENT_AP_ID)).toBe(0);
});

test("[R6#3] Delete with a crash-stale postCount does not over-decrement", async () => {
  const db = await setup();
  // Object present but postCount already at 0 (e.g. a prior decrement applied
  // but the object delete had not committed, then a crash). The gt(postCount,0)
  // underflow guard must keep postCount non-negative.
  await db.insert(objects).values({
    apId: TOP_AP_ID,
    type: "Note",
    attributedTo: REMOTE_ACTOR,
    content: "hi",
    isLocal: 0,
  });
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0);

  await handleDelete(ctxFor(db), deleteNote(TOP_AP_ID, REMOTE_ACTOR));

  expect(await objectCount(db, TOP_AP_ID)).toBe(0);
  expect(await postCountOf(db, REMOTE_ACTOR)).toBe(0); // not negative
});
