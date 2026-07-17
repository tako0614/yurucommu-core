import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GET /dm/unread/count must return the SAME unread total as summing
 * `unread_count` across GET /dm/contacts — that parity is the whole point of the
 * lightweight badge endpoint (it replaces a full /contacts poll every 30s with
 * two COUNT(*) joins). If the cheap count and the rich list ever disagree, the
 * Messages nav badge lies, so this test pins them together across the cases that
 * actually move the count: unread DMs, a read conversation, an archived
 * conversation, and unread community group-chat messages.
 *
 * Runs the real handlers against in-memory libsql with production migrations, so
 * the two queries are exercised against the actual schema/SQL, not mocks.
 */

import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/conversations.ts";
import { yurumeUnreadCounts } from "../../lib/unread-counts.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0006_dm_community_read_status.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

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

const localApId = (username: string) => `${APP_URL}/ap/users/${username}`;
const groupApId = (name: string) => `${APP_URL}/ap/groups/${name}`;

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

/** Direct (DM) Note from sender to recipient + the `type='to'` recipient link. */
async function insertDm(
  db: Database,
  sender: string,
  recipient: string,
  conversation: string,
  id: string,
  published: string,
): Promise<void> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: sender,
    content: id,
    toJson: JSON.stringify([recipient]),
    visibility: "direct",
    conversation,
    published,
    isLocal: 1,
  });
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${apId}, ${recipient}, 'to', ${published})
  `);
}

/** Community group-CHAT Note (audience-linked, communityApId NULL — not a feed post). */
async function insertCommunityChat(
  db: Database,
  sender: string,
  communityApId: string,
  id: string,
  published: string,
): Promise<void> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: sender,
    content: id,
    visibility: "public",
    published,
    isLocal: 1,
  });
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${apId}, ${communityApId}, 'audience', ${published})
  `);
}

async function insertCommunity(db: Database, name: string): Promise<string> {
  const apId = groupApId(name);
  await db.insert(communities).values({
    apId,
    preferredUsername: name,
    name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("alice"),
    memberCount: 1,
  });
  return apId;
}

async function addMember(
  db: Database,
  communityApId: string,
  actorApId: string,
  joinedAt: string,
): Promise<void> {
  await db.insert(communityMembers).values({
    communityApId,
    actorApId,
    joinedAt,
  });
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
  actor: Actor,
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

const envFor = (db: Database): Env =>
  ({ APP_URL, DB_INSTANCE: db }) as unknown as Env;

type ContactsResponse = {
  mutual_followers: Array<{ unread_count?: number }>;
  communities: Array<{ unread_count?: number }>;
};

test("GET /unread/count total equals the sum of unread_count across /contacts", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // conv1: 2 unread DMs from bob (never read by alice) -> +2
  await insertDm(db, bob, alice, "conv1", "c1m1", "2026-06-20T10:00:00.000Z");
  await insertDm(db, bob, alice, "conv1", "c1m2", "2026-06-20T10:05:00.000Z");
  // alice's own reply in conv1 -> not counted
  await insertDm(db, alice, bob, "conv1", "c1m3", "2026-06-20T10:06:00.000Z");

  // conv2: 1 DM from bob but alice archived the conversation -> excluded
  await insertDm(db, bob, alice, "conv2", "c2m1", "2026-06-20T11:00:00.000Z");
  await db.run(sql`
    INSERT INTO dm_archived_conversations (actor_ap_id, conversation_id, archived_at)
    VALUES (${alice}, 'conv2', '2026-06-20T11:30:00.000Z')
  `);

  // conv3: 1 DM from bob, but alice has read past it -> 0 unread
  await insertDm(db, bob, alice, "conv3", "c3m1", "2026-06-20T09:00:00.000Z");
  await db.run(sql`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    VALUES (${alice}, 'conv3', '2026-06-20T09:30:00.000Z')
  `);

  // community fanclub: alice joined at T; bob posts 2 chat msgs after -> +2
  const fanclub = await insertCommunity(db, "fanclub");
  await addMember(db, fanclub, alice, "2026-06-20T08:00:00.000Z");
  await insertCommunityChat(db, bob, fanclub, "g1", "2026-06-20T12:00:00.000Z");
  await insertCommunityChat(db, bob, fanclub, "g2", "2026-06-20T12:05:00.000Z");
  // alice's own community chat msg -> not counted
  await insertCommunityChat(
    db,
    alice,
    fanclub,
    "g3",
    "2026-06-20T12:06:00.000Z",
  );

  const actor = fakeActor(alice, "alice");
  const app = appWith(db, actor);

  // /contacts: sum unread_count across DM contacts + communities
  const contactsRes = await app.fetch(
    new Request(`${APP_URL}/contacts`),
    envFor(db),
  );
  expect(contactsRes.status).toEqual(200);
  const contacts = (await contactsRes.json()) as ContactsResponse;
  const sum = (xs: Array<{ unread_count?: number }>) =>
    xs.reduce((acc, x) => acc + (x.unread_count || 0), 0);
  const contactsTotal =
    sum(contacts.mutual_followers) + sum(contacts.communities);

  // /unread/count: the lightweight badge total
  const countRes = await app.fetch(
    new Request(`${APP_URL}/unread/count`),
    envFor(db),
  );
  expect(countRes.status).toEqual(200);
  const count = (await countRes.json()) as {
    total: number;
    dm: number;
    community: number;
  };

  // The two must agree, and we expect the specific non-zero split so a "both
  // return 0" bug cannot pass silently.
  expect(contactsTotal).toEqual(4);
  expect(count).toEqual({ total: 4, dm: 2, community: 2 });
  expect(count.total).toEqual(contactsTotal);
});

test("the shared yurumeUnreadCounts helper matches GET /unread/count (push-badge parity)", async () => {
  // The notification push payload's `counts.unread` is computed by
  // yurumeUnreadCounts — the SAME helper the endpoint uses. Pin the helper to
  // the endpoint so a push can never set a badge that disagrees with the number
  // the client computes when it opens.
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  await insertDm(db, bob, alice, "conv1", "c1m1", "2026-06-20T10:00:00.000Z");
  await insertDm(db, bob, alice, "conv1", "c1m2", "2026-06-20T10:05:00.000Z");
  await insertDm(db, bob, alice, "conv2", "c2m1", "2026-06-20T11:00:00.000Z");
  await db.run(sql`
    INSERT INTO dm_read_status (actor_ap_id, conversation_id, last_read_at)
    VALUES (${alice}, 'conv2', '2026-06-20T11:30:00.000Z')
  `);
  const fanclub = await insertCommunity(db, "fanclub");
  await addMember(db, fanclub, alice, "2026-06-20T08:00:00.000Z");
  await insertCommunityChat(db, bob, fanclub, "g1", "2026-06-20T12:00:00.000Z");

  const actor = fakeActor(alice, "alice");
  const app = appWith(db, actor);
  const countRes = await app.fetch(
    new Request(`${APP_URL}/unread/count`),
    envFor(db),
  );
  const endpoint = (await countRes.json()) as {
    total: number;
    dm: number;
    community: number;
  };
  const helper = await yurumeUnreadCounts(db, alice);

  expect(helper).toEqual({ dm: 2, community: 1, total: 3 });
  expect({
    total: helper.total,
    dm: helper.dm,
    community: helper.community,
  }).toEqual(endpoint);
});

test("GET /unread/count requires auth", async () => {
  const db = await freshDb();
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await next();
  });
  app.route("/", dmRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/unread/count`),
    envFor(db),
  );
  expect(res.status).toEqual(401);
});
