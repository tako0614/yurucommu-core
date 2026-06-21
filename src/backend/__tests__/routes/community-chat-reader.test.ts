import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import communityMessageRoutes from "../../routes/communities/messages.ts";

/**
 * Community chat reader (GET /:identifier/messages) — the message set is fetched
 * with a single INNER JOIN object_recipients -> objects filtered on the indexed
 * `recipient_ap_id`, NOT a two-step "load every recipient id then IN (...)". The
 * old shape materialized the channel's entire history into an `inArray`
 * bound-parameter list (memory O(all messages); a hard error past SQLite's
 * variable ceiling). This test pins: chat-only object-set (feed posts with
 * communityApId SET are excluded), correct ordering, and `before` pagination.
 *
 * Requires migrations 0010/0011 (object_recipients.recipient_ap_id no longer FKs
 * actors, so a community ap_id is a valid recipient).
 */

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
  "0010_object_recipients_drop_actor_fk.sql",
  "0011_drop_remote_actor_fks.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const f of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertLocalActor(db: Database, username: string) {
  const apId = `${APP_URL}/ap/users/${username}`;
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

async function insertCommunity(db: Database, username: string) {
  const apId = `${APP_URL}/ap/groups/${username}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: "public",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: `${APP_URL}/ap/users/owner`,
  });
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

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", communityMessageRoutes);
  return app;
}

const envFor = (db: Database) =>
  ({ APP_URL, DB_INSTANCE: db }) as unknown as Env;

async function seedChat(
  db: Database,
  communityApId: string,
  author: string,
  id: string,
  published: string,
) {
  const objApId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId: objApId,
    type: "Note",
    attributedTo: author,
    content: id,
    visibility: "unlisted",
    published,
    isLocal: 1,
  });
  await db.insert(objectRecipients).values({
    objectApId: objApId,
    recipientApId: communityApId,
    type: "audience",
    createdAt: published,
  });
}

test("chat reader: JOIN returns chat-only messages, excludes feed posts, paginates by before", async () => {
  const db = await freshDb();
  const member = await insertLocalActor(db, "member");
  const communityApId = await insertCommunity(db, "town");
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: member,
    role: "member",
  });

  await seedChat(
    db,
    communityApId,
    member,
    "chat0",
    "2026-06-21T08:00:01.000Z",
  );
  await seedChat(
    db,
    communityApId,
    member,
    "chat1",
    "2026-06-21T08:00:02.000Z",
  );
  await seedChat(
    db,
    communityApId,
    member,
    "chat2",
    "2026-06-21T08:00:03.000Z",
  );

  // A FEED post (communityApId SET) — audience-addressed and newer, but it must
  // NOT appear in the chat reader (the two object-sets are disjoint).
  const feedApId = `${APP_URL}/ap/objects/feed0`;
  await db.insert(objects).values({
    apId: feedApId,
    type: "Note",
    attributedTo: member,
    content: "feed post",
    visibility: "public",
    published: "2026-06-21T08:00:09.000Z",
    communityApId,
    isLocal: 1,
  });
  await db.insert(objectRecipients).values({
    objectApId: feedApId,
    recipientApId: communityApId,
    type: "audience",
    createdAt: "2026-06-21T08:00:09.000Z",
  });

  const app = appWith(db, fakeActor(member, "member"));

  // Page 1: limit=2 -> the 2 newest chat messages (reader returns ascending), and
  // has_more true (a third older chat exists). Feed post excluded.
  const res1 = await app.fetch(
    new Request(`${APP_URL}/town/messages?limit=2`, { method: "GET" }),
    envFor(db),
  );
  expect(res1.status).toBe(200);
  const page1 = (await res1.json()) as {
    messages: Array<{ content: string; created_at: string }>;
    has_more: boolean;
  };
  expect(page1.has_more).toBe(true);
  expect(page1.messages.map((m) => m.content)).toEqual(["chat1", "chat2"]);
  expect(page1.messages.some((m) => m.content === "feed post")).toBe(false);

  // Page 2: before the oldest shown (chat1) -> [chat0], no more.
  const oldest = page1.messages[0];
  const res2 = await app.fetch(
    new Request(
      `${APP_URL}/town/messages?limit=2&before=${encodeURIComponent(oldest.created_at)}`,
      { method: "GET" },
    ),
    envFor(db),
  );
  expect(res2.status).toBe(200);
  const page2 = (await res2.json()) as {
    messages: Array<{ content: string }>;
    has_more: boolean;
  };
  expect(page2.messages.map((m) => m.content)).toEqual(["chat0"]);
  expect(page2.has_more).toBe(false);
});

test("chat reader: empty channel returns no messages and has_more false", async () => {
  const db = await freshDb();
  const member = await insertLocalActor(db, "member");
  const communityApId = await insertCommunity(db, "quiet");
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: member,
    role: "member",
  });

  const res = await app_fetch(db, member, "quiet");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    messages: unknown[];
    has_more: boolean;
  };
  expect(body.messages).toEqual([]);
  expect(body.has_more).toBe(false);
});

function app_fetch(db: Database, member: string, name: string) {
  return appWith(db, fakeActor(member, "member")).fetch(
    new Request(`${APP_URL}/${name}/messages`, { method: "GET" }),
    envFor(db),
  );
}
