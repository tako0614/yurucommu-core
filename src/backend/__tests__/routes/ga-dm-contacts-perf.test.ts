import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
/**
 * GA #20 regression: GET /dm/contacts must enumerate conversations and count
 * pending requests via the indexed `object_recipients` link (not an unindexable
 * `to_json LIKE '%"<apId>"%'` substring scan) AND must be side-effect-free (no
 * DELETE / write on a GET).
 *
 * These run the real DM route handlers against an in-memory libsql database
 * with the production migrations applied, so the assertions reflect the actual
 * SQL behaviour (recipient-membership via object_recipients) rather than mock
 * bookkeeping.
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
 * `object_recipients` row keyed on the recipient (raw SQL bypasses the FK to
 * actors, matching the production D1 write path).
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

type ContactsResponse = {
  mutual_followers: Array<{
    ap_id?: string;
    conversation_id: string;
    last_message: { content: string; is_mine: boolean } | null;
    unread_count?: number;
  }>;
  communities: Array<{ ap_id: string }>;
  request_count: number;
};

async function getContacts(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  db: Database,
): Promise<ContactsResponse> {
  const res = await app.fetch(new Request(`${APP_URL}/contacts`), envFor(db));
  expect(res.status).toEqual(200);
  return (await res.json()) as ContactsResponse;
}

async function countRows(db: Database, table: string): Promise<number> {
  const row = (await db.get(sql.raw(`SELECT COUNT(*) AS c FROM ${table}`))) as
    | { c: number }
    | undefined;
  return row?.c ?? 0;
}

test("contacts lists conversations found via the object_recipients index (recipient + author)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // Conversation A: alice -> viewer (viewer is recipient, found via index).
  const convA = "conv-a";
  await insertDm(db, alice, viewer, convA, "a1", "2024-01-01T00:00:01Z");

  // Conversation B: viewer -> bob (viewer is author, found via attributed_to).
  const convB = "conv-b";
  await insertDm(db, viewer, bob, convB, "b1", "2024-01-01T00:00:02Z");

  // Unrelated DM between alice and bob: must NOT appear for viewer.
  const convC = "conv-c";
  await insertDm(db, alice, bob, convC, "c1", "2024-01-01T00:00:03Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  const convIds = data.mutual_followers.map((m) => m.conversation_id).sort();
  expect(convIds).toEqual([convA, convB].sort());
  expect(data.mutual_followers.some((m) => m.conversation_id === convC)).toBe(
    false,
  );
});

test("request_count counts incoming conversations the viewer has not replied to", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // alice -> viewer, no reply from viewer => pending request.
  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");

  // bob -> viewer, then viewer replies => NOT a pending request.
  await insertDm(db, bob, viewer, "conv-b", "b1", "2024-01-01T00:00:02Z");
  await insertDm(db, viewer, bob, "conv-b", "b2", "2024-01-01T00:00:03Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  expect(data.request_count).toEqual(1);
});

test("unread_count reflects messages from others after the read baseline", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");

  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");
  await insertDm(db, alice, viewer, "conv-a", "a2", "2024-01-01T00:00:02Z");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const data = await getContacts(app, db);

  const conv = data.mutual_followers.find(
    (m) => m.conversation_id === "conv-a",
  );
  expect(conv).toBeDefined();
  expect(conv?.unread_count).toEqual(2);
});

test("GET /contacts performs no writes (side-effect-free)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const alice = await insertLocalActor(db, "alice");

  await insertDm(db, alice, viewer, "conv-a", "a1", "2024-01-01T00:00:01Z");

  // Seed an ORPHANED dm_read_status row (a conversation that has no objects).
  // The old GET handler DELETEd such rows on read; a side-effect-free GET must
  // leave it in place.
  await db.run(sql`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    VALUES (${viewer}, 'orphan-conv', '2024-01-01T00:00:00Z')
  `);

  const before = await countRows(db, "dm_read_status");

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const res = await app.fetch(new Request(`${APP_URL}/contacts`), envFor(db));
  expect(res.status).toEqual(200);

  const after = await countRows(db, "dm_read_status");
  expect(after).toEqual(before);

  // The orphaned read-status row specifically must survive.
  const orphan = (await db.get(
    sql`SELECT conversation_id FROM dm_read_status WHERE conversation_id = 'orphan-conv'`,
  )) as { conversation_id: string } | undefined;
  expect(orphan?.conversation_id).toEqual("orphan-conv");
});
