import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, sql } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actorCache, actors, objects } from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";

// ---------------------------------------------------------------------------
// GA-fix Wave-8 cluster INBOX-IDEMPOTENT
//   #9 The inbound dedup row used to be committed BEFORE the handler ran, so a
//      handler that threw mid-effect was swallowed (202) while the dedup row
//      permanently suppressed the peer's retry — leaving the activity's effects
//      half-applied and never completed.
//
//   Fix: the activity row is stored `processed = 0` and only committed
//   (`processed = 1`) AFTER the handler's effects succeed. An existing
//   `processed = 0` row (a prior dispatch that threw) is RE-DISPATCHABLE so a
//   peer retry completes it; an existing `processed = 1` row stays suppressed.
//
//   These tests assert end-to-end through the real inbox route + a real
//   in-memory DB that:
//     1. a handler that throws once then succeeds on retry applies the effect
//        EXACTLY ONCE (retry is not black-holed), and
//     2. a genuine duplicate delivery after a SUCCESSFUL dispatch is suppressed
//        (the concurrent/repeat-delivery idempotency is preserved).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const REMOTE_ACTOR = "https://remote.example/users/alice";
const OBJECT_AP_ID = `${APP_URL}/ap/objects/post-1`;
const ACTIVITY_AP_ID = "https://remote.example/activities/like-1";

// The handler module the route dispatches to is mocked so we can deterministically
// make the FIRST Like dispatch throw and later ones succeed, while the success
// path performs a REAL non-idempotent DB effect (likeCount += 1). Every other
// handler is a no-op; the route only needs these names to exist.
let likeCallCount = 0;
let throwOnNextLike = false;

const HANDLERS_MODULE =
  "../../routes/activitypub/handlers/user-inbox-handlers.ts";

// Capture the REAL handler module before mocking so it can be restored in
// `afterAll`. Bun's `mock.module` is process-global and persists across test
// files; without restoring it the no-op stubs would leak into other suites
// (e.g. the real user-inbox-handlers tests) and fail them.
const realHandlers: Record<string, unknown> = { ...(await import(HANDLERS_MODULE)) };

mock.module(HANDLERS_MODULE, () => {
  const noop = async () => {};
  return {
    handleAccept: noop,
    handleAdd: noop,
    handleAnnounce: noop,
    handleBlock: noop,
    handleCreate: noop,
    handleDelete: noop,
    handleFlag: noop,
    handleFollow: noop,
    handleMove: noop,
    handleReject: noop,
    handleRemove: noop,
    handleUndo: noop,
    handleUpdate: noop,
    async handleLike(
      c: { get: (k: string) => unknown },
      _activity: unknown,
      _recipient: unknown,
      _actor: string,
      _baseUrl: string,
    ) {
      likeCallCount += 1;
      if (throwOnNextLike) {
        throwOnNextLike = false;
        // Throw BEFORE applying any effect, mirroring a handler that fails
        // mid-flight before its writes commit.
        throw new Error("simulated mid-effect handler failure");
      }
      const db = c.get("db") as Database;
      await db
        .update(objects)
        .set({ likeCount: sql`${objects.likeCount} + 1` })
        .where(eq(objects.apId, OBJECT_AP_ID));
    },
  };
});

afterAll(() => {
  // Restore the real module so the global mock does not leak into other suites.
  mock.module(HANDLERS_MODULE, () => realHandlers);
});

// Imported AFTER the mock registration so the route binds to the stubbed
// handlers module.
const { default: inboxRoutes } = await import(
  "../../routes/activitypub/inbox.ts"
);

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

function appWith(db: Database) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("db", db);
    await next();
  });
  app.route("/", inboxRoutes);
  return app;
}

async function postUserInbox(
  app: ReturnType<typeof appWith>,
  body: string,
  privateKeyPem: string,
  keyId: string,
) {
  const url = `${APP_URL}/ap/users/bob/inbox`;
  const headers = await signRequest(privateKeyPem, keyId, "POST", url, body);
  return app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body,
    }),
    { APP_URL },
  );
}

afterEach(() => {
  likeCallCount = 0;
  throwOnNextLike = false;
});

async function setup() {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const db = await freshDb();

  // Local recipient (bob) + the local object that the Like targets. The remote
  // actor is seeded into `actors` too so the `activities.actor_ap_id` FK is
  // satisfied for the inbound dedup insert.
  await seedActor(db, `${APP_URL}/ap/users/bob`, "bob");
  await seedActor(db, REMOTE_ACTOR, "alice");
  await db.insert(objects).values({
    apId: OBJECT_AP_ID,
    type: "Note",
    attributedTo: `${APP_URL}/ap/users/bob`,
    content: "hello",
    likeCount: 0,
  });

  // Fresh actor-cache row so HTTP signature verification resolves the signing
  // key from cache (no network fetch needed).
  await db.insert(actorCache).values({
    apId: REMOTE_ACTOR,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${REMOTE_ACTOR}/inbox`,
    publicKeyId: `${REMOTE_ACTOR}#main-key`,
    publicKeyPem,
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

  const body = JSON.stringify({
    id: ACTIVITY_AP_ID,
    type: "Like",
    actor: REMOTE_ACTOR,
    object: OBJECT_AP_ID,
  });

  return { db, body, privateKeyPem };
}

async function likeCount(db: Database): Promise<number> {
  const row = await db
    .select({ likeCount: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, OBJECT_AP_ID))
    .get();
  return row?.likeCount ?? -1;
}

async function processedFlag(db: Database): Promise<number | null | undefined> {
  const row = await db
    .select({ processed: activities.processed })
    .from(activities)
    .where(eq(activities.apId, ACTIVITY_AP_ID))
    .get();
  return row?.processed;
}

test("#9 a dispatch that throws once then succeeds on retry applies the effect exactly once", async () => {
  const { db, body, privateKeyPem } = await setup();
  const app = appWith(db);
  const keyId = `${REMOTE_ACTOR}#main-key`;

  // First delivery: handler throws mid-effect. The route must ACK 202 (no 500
  // that would trigger an aggressive retry) and must NOT commit the dedup row,
  // so the effect is not yet applied and the row stays re-dispatchable.
  throwOnNextLike = true;
  const first = await postUserInbox(app, body, privateKeyPem, keyId);
  expect(first.status).toEqual(202);
  expect(likeCallCount).toEqual(1);
  expect(await likeCount(db)).toEqual(0); // effect NOT applied (handler threw)
  expect(await processedFlag(db)).toEqual(0); // NOT suppressed — retriable

  // Peer retry: pre-fix the dedup row would have suppressed this and the
  // activity would be permanently lost. Now it re-dispatches and completes.
  const retry = await postUserInbox(app, body, privateKeyPem, keyId);
  expect(retry.status).toEqual(202);
  expect(likeCallCount).toEqual(2);
  expect(await likeCount(db)).toEqual(1); // effect applied exactly once
  expect(await processedFlag(db)).toEqual(1); // committed → now suppressed

  // A third (duplicate) delivery after success is suppressed: no re-dispatch,
  // effect stays applied exactly once.
  const third = await postUserInbox(app, body, privateKeyPem, keyId);
  expect(third.status).toEqual(202);
  expect(likeCallCount).toEqual(2); // handler NOT invoked again
  expect(await likeCount(db)).toEqual(1); // still exactly once
});

test("#9 a duplicate delivery after a successful dispatch is suppressed (idempotent)", async () => {
  const { db, body, privateKeyPem } = await setup();
  const app = appWith(db);
  const keyId = `${REMOTE_ACTOR}#main-key`;

  // First delivery succeeds and commits.
  const first = await postUserInbox(app, body, privateKeyPem, keyId);
  expect(first.status).toEqual(202);
  expect(likeCallCount).toEqual(1);
  expect(await likeCount(db)).toEqual(1);
  expect(await processedFlag(db)).toEqual(1);

  // Repeat delivery of the same activity id must NOT re-run the handler and
  // must NOT double-apply the effect.
  const dup = await postUserInbox(app, body, privateKeyPem, keyId);
  expect(dup.status).toEqual(202);
  expect(likeCallCount).toEqual(1);
  expect(await likeCount(db)).toEqual(1);
});
