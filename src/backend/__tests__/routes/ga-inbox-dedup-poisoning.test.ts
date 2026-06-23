import { afterAll, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { like } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actorCache, actors } from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";

// ---------------------------------------------------------------------------
// Audit #21 / finding B — inbound dedup-ledger poisoning.
//
//   The inbox dedup ledger keys on the activity envelope `id` (activities.apId).
//   Before the fix the id was trusted verbatim, so a remote could set `id` to
//   ANOTHER instance's namespace (e.g. https://good.example/.../activity) and
//   pre-occupy that row with processed=1, silently black-holing good.example's
//   later legitimate redelivery of that exact id.
//
//   Fix: the envelope id is only used as the dedup key when it shares the
//   (signature-bound) actor's origin and is not local; otherwise the activity
//   is deduped under a LOCAL deterministic synthetic id. So a cross-origin id
//   can never occupy a foreign instance's namespace.
//
//   This test posts a validly-signed Like from evil.example whose envelope id
//   lives on good.example, and asserts NO activities row is keyed under the
//   foreign id (the synthetic local key is used instead).
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const EVIL_ACTOR = "https://evil.example/users/x";
// The id the attacker tries to squat: good.example's future activity id.
const FOREIGN_ACTIVITY_ID =
  "https://good.example/users/bob/statuses/123/activity";
const REMOTE_OBJECT = "https://good.example/ap/objects/anything";

const HANDLERS_MODULE =
  "../../routes/activitypub/handlers/user-inbox-handlers.ts";

const realHandlers: Record<string, unknown> = {
  ...(await import(HANDLERS_MODULE)),
};

// Stub every handler to a no-op so the dispatch succeeds (processed=1 committed)
// without any real DB effect — the test only inspects the dedup ledger keying.
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
    handleLike: noop,
    handleMove: noop,
    handleReject: noop,
    handleRemove: noop,
    handleUndo: noop,
    handleUpdate: noop,
  };
});

afterAll(() => {
  mock.module(HANDLERS_MODULE, () => realHandlers);
});

const { default: inboxRoutes } =
  await import("../../routes/activitypub/inbox.ts");

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    // 0003 drops the activities.object_ap_id → objects FK so an inbound
    // activity can reference a REMOTE (non-local) object id, matching prod.
    "0002_social_remote_actor_edges.sql",
    "0003_activity_remote_object_edges.sql",
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

test("a cross-origin envelope id does NOT occupy the foreign instance's dedup namespace", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const db = await freshDb();

  // Local recipient + the (signature-bound) evil actor. evil is seeded into
  // `actors` so the activities.actor_ap_id FK is satisfied on the dedup insert.
  await seedActor(db, `${APP_URL}/ap/users/bob`, "bob");
  await seedActor(db, EVIL_ACTOR, "evil");

  await db.insert(actorCache).values({
    apId: EVIL_ACTOR,
    type: "Person",
    preferredUsername: "evil",
    inbox: `${EVIL_ACTOR}/inbox`,
    publicKeyId: `${EVIL_ACTOR}#main-key`,
    publicKeyPem,
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

  // A validly-signed Like from evil whose ENVELOPE id squats good.example.
  const body = JSON.stringify({
    id: FOREIGN_ACTIVITY_ID,
    type: "Like",
    actor: EVIL_ACTOR,
    object: REMOTE_OBJECT,
  });
  const url = `${APP_URL}/ap/users/bob/inbox`;
  const headers = await signRequest(
    privateKeyPem,
    `${EVIL_ACTOR}#main-key`,
    "POST",
    url,
    body,
  );
  const app = appWith(db);
  const res = await app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body,
    }),
    { APP_URL },
  );

  // Signed + actor==signer → accepted (202), but the dedup ledger must NOT be
  // keyed under good.example's id.
  expect(res.status).toEqual(202);

  const foreignRow = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(like(activities.apId, "https://good.example/%"))
    .get();
  expect(foreignRow).toBeUndefined();

  // Instead the activity is deduped under a LOCAL synthetic id (our origin),
  // which can only ever collide with this same logical action — never with a
  // remote instance's legitimate activity id.
  const localSynthetic = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(like(activities.apId, `${APP_URL}/%synthetic-%`))
    .get();
  expect(localSynthetic?.apId).toBeTruthy();
});
