import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #20 follow-up regression: the remaining DM read paths must enumerate
 * conversation membership through the indexed `object_recipients` link
 * (`recipient_ap_id` equality + `type = 'to'`) rather than an unindexable
 * `to_json LIKE '%"<apId>"%'` substring scan — while preserving exact
 * semantics.
 *
 * Covers the three migrated callers:
 *  - GET /requests        (requests.ts: incoming DMs the viewer is a recipient of)
 *  - GET /archived        (read-archive.ts via dmWhereForActor: author OR recipient)
 *  - resolveConversationId (query-helpers.ts via POST /user/:id/read)
 *
 * These run the real DM route handlers against an in-memory libsql database
 * with the production migrations applied, so the assertions reflect the actual
 * index-served SQL behaviour, not mock bookkeeping.
 */

import { Hono } from "hono";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/conversations.ts";
import { getConversationId } from "../../routes/dm/query-helpers.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = ["0001_init.sql", "0006_dm_community_read_status.sql"];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const migration = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(migration);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localApId(username);
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
  return apId;
}

/**
 * Insert a direct (DM) Note from `senderApId` to `recipientApId`, mirroring the
 * production DM write path: a direct-visibility Note row plus a `type='to'`
 * `object_recipients` row keyed on the recipient.
 */
async function insertDm(
  db: Database,
  senderApId: string,
  recipientApId: string,
  conversationId: string,
  id: string,
  published: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: senderApId,
    content: id,
    toJson: JSON.stringify([recipientApId]),
    visibility: "direct",
    conversation: conversationId,
    published,
    isLocal: 1,
  });
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${apId}, ${recipientApId}, 'to', ${published})
  `);
  return apId;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "member",
    created_at: new Date().toISOString(),
  };
}

function appWith(
  db: Database,
  actor: Actor | null,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", dmRoutes);
  return app;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

type RequestsResponse = {
  requests: Array<{
    id: string;
    sender: { ap_id?: string };
    conversation: string | null;
  }>;
};

type ArchivedResponse = {
  archived: Array<{ conversation_id: string; ap_id?: string }>;
};

test("GET /requests lists incoming DMs found via object_recipients, excludes replied + unrelated", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const carol = await insertLocalActor(db, "carol");

  // alice -> viewer, viewer has NOT replied => pending request.
  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");

  // bob -> viewer, then viewer replies => NOT a pending request.
  await insertDm(db, bob, viewer, "conv-b", "b1", "2024-01-01T00:00:02Z");
  await insertDm(db, viewer, bob, "conv-b", "b2", "2024-01-01T00:00:03Z");

  // Unrelated DM (carol -> bob): viewer is neither author nor recipient.
  await insertDm(db, carol, bob, "conv-c", "c1", "2024-01-01T00:00:04Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const res = await app.fetch(new Request(`${APP_URL}/requests`), envFor(db));
  expect(res.status).toEqual(200);
  const data = (await res.json()) as RequestsResponse;

  const convIds = data.requests.map((r) => r.conversation);
  expect(convIds).toEqual(["conv-a"]);
});

test("GET /archived lists archived conversations (author OR recipient) via the index", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // Conversation A: alice -> viewer (viewer is recipient, index path).
  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");
  // Conversation B: viewer -> bob (viewer is author).
  await insertDm(db, viewer, bob, "conv-b", "b1", "2024-01-01T00:00:02Z");

  // Archive only conversation A.
  await db.run(sql`
    INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at)
    VALUES (${viewer}, 'conv-a', '2024-01-02T00:00:00Z')
  `);

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const res = await app.fetch(new Request(`${APP_URL}/archived`), envFor(db));
  expect(res.status).toEqual(200);
  const data = (await res.json()) as ArchivedResponse;

  const convIds = data.archived.map((a) => a.conversation_id);
  expect(convIds).toEqual(["conv-a"]);
});

test("resolveConversationId (POST /read) reuses the existing thread found via the index", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");

  // Pre-existing thread under a NON-derived conversation id: alice -> viewer.
  // resolveConversationId must find it through object_recipients and reuse it
  // rather than falling back to the deterministic getConversationId.
  const existingConv = "legacy-thread-id";
  await insertDm(db, alice, viewer, existingConv, "a1", "2024-01-01T00:00:01Z");

  const derived = getConversationId(APP_URL, viewer, alice);
  expect(derived).not.toEqual(existingConv);

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const res = await app.fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(alice)}/read`, {
      method: "POST",
    }),
    envFor(db),
  );
  expect(res.status).toEqual(200);

  // The read-status row must be written against the resolved (existing) thread
  // id, proving resolveConversationId matched via the indexed recipient link.
  const row = (await db.get(
    sql`SELECT conversation_id FROM dm_read_status WHERE actor_ap_id = ${viewer}`,
  )) as { conversation_id: string } | undefined;
  expect(row?.conversation_id).toEqual(existingConv);
});
