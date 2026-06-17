import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
/**
 * Item 12 regression tests: community (group chat) unread badge, community
 * read-tracking, and deep-link contact resolution.
 *
 * These run the real DM route handlers against an in-memory libsql database
 * with the production migrations applied, so the assertions reflect actual SQL
 * behaviour (audience-linked community messages, the new
 * `dm_community_read_status` table) rather than mock bookkeeping.
 */

import { Hono } from "hono";

import { eq, sql } from "drizzle-orm";
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

const APP_URL = "https://yuru.test";
const MIGRATIONS = ["0001_init.sql", "0006_dm_community_read_status.sql"];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  // Community messages link `object_recipients.recipient_ap_id` to the
  // community AP-ID, which is intentionally NOT an `actors` row (the FK targets
  // Actor). Production writes that link via raw SQL on a backend (D1) that does
  // not enforce this FK; mirror that here so the test exercises the real
  // audience-linked read path rather than the FK.
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

function communityApIdFor(username: string): string {
  return `${APP_URL}/ap/groups/${username}`;
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

async function insertCommunity(
  db: Database,
  username: string,
): Promise<string> {
  const apId = communityApIdFor(username);
  await db.insert(communities).values({
    apId,
    type: "Group",
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: apId,
    memberCount: 1,
  });
  return apId;
}

async function joinCommunity(
  db: Database,
  communityApId: string,
  actorApId: string,
  joinedAt: string,
): Promise<void> {
  await db.insert(communityMembers).values({
    communityApId,
    actorApId,
    role: "member",
    joinedAt,
  });
}

/** Insert a community Note message authored by `senderApId`, addressed to the
 * community via the `audience` object_recipients link (raw SQL bypasses the FK
 * to actors, mirroring the production write path). */
async function insertCommunityMessage(
  db: Database,
  communityApId: string,
  senderApId: string,
  id: string,
  published: string,
): Promise<void> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: senderApId,
    content: id,
    toJson: JSON.stringify([communityApId]),
    audienceJson: JSON.stringify([communityApId]),
    visibility: "unlisted",
    published,
    isLocal: 1,
  });
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${apId}, ${communityApId}, 'audience', ${published})
  `);
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
  communities: Array<{ ap_id: string; unread_count?: number }>;
};

async function getContacts(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  db: Database,
): Promise<ContactsResponse> {
  const res = await app.fetch(
    new Request(`${APP_URL}/contacts`),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  return (await res.json()) as ContactsResponse;
}

test("community unread_count counts messages from others published after the read baseline", async () => {
  const db = await freshDb();
  const viewerApId = await insertLocalActor(db, "viewer");
  const otherApId = await insertLocalActor(db, "other");
  const communityApId = await insertCommunity(db, "club");

  // Viewer joined before any of the messages below.
  await joinCommunity(db, communityApId, viewerApId, "2020-01-01T00:00:00Z");

  // Two messages from someone else (unread) + one authored by the viewer
  // (must NOT count toward the viewer's own unread).
  await insertCommunityMessage(
    db,
    communityApId,
    otherApId,
    "m1",
    "2024-01-01T00:00:01Z",
  );
  await insertCommunityMessage(
    db,
    communityApId,
    otherApId,
    "m2",
    "2024-01-01T00:00:02Z",
  );
  await insertCommunityMessage(
    db,
    communityApId,
    viewerApId,
    "m3",
    "2024-01-01T00:00:03Z",
  );

  const app = appWith(db, fakeActor(viewerApId, "viewer"));
  const data = await getContacts(app, db);

  const community = data.communities.find((c) => c.ap_id === communityApId);
  expect(community).toBeDefined();
  expect(community?.unread_count).toEqual(2);
});

test("marking a community as read clears its unread_count", async () => {
  const db = await freshDb();
  const viewerApId = await insertLocalActor(db, "viewer");
  const otherApId = await insertLocalActor(db, "other");
  const communityApId = await insertCommunity(db, "club");
  await joinCommunity(db, communityApId, viewerApId, "2020-01-01T00:00:00Z");

  await insertCommunityMessage(
    db,
    communityApId,
    otherApId,
    "m1",
    "2024-01-01T00:00:01Z",
  );

  const app = appWith(db, fakeActor(viewerApId, "viewer"));

  // Before reading: one unread.
  const before = await getContacts(app, db);
  expect(
    before.communities.find((c) => c.ap_id === communityApId)?.unread_count,
  ).toEqual(1);

  // Mark as read.
  const readRes = await app.fetch(
    new Request(
      `${APP_URL}/community/${encodeURIComponent(communityApId)}/read`,
      { method: "POST" },
    ),
    envFor(db),
  );
  expect(readRes.status).toEqual(200);

  // After reading: zero unread (the read baseline now sits after m1).
  const after = await getContacts(app, db);
  expect(
    after.communities.find((c) => c.ap_id === communityApId)?.unread_count,
  ).toEqual(0);
});

test("marking a non-existent community as read returns 404", async () => {
  const db = await freshDb();
  const viewerApId = await insertLocalActor(db, "viewer");
  const app = appWith(db, fakeActor(viewerApId, "viewer"));

  const res = await app.fetch(
    new Request(
      `${APP_URL}/community/${encodeURIComponent(
        communityApIdFor("ghost"),
      )}/read`,
      { method: "POST" },
    ),
    envFor(db),
  );
  expect(res.status).toEqual(404);
});

test("deep-link resolve returns a community contact by ap_id", async () => {
  const db = await freshDb();
  const viewerApId = await insertLocalActor(db, "viewer");
  const communityApId = await insertCommunity(db, "club");

  const app = appWith(db, fakeActor(viewerApId, "viewer"));
  const res = await app.fetch(
    new Request(`${APP_URL}/contact/${encodeURIComponent(communityApId)}`),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  const data = (await res.json()) as {
    contact: { type: string; ap_id: string; preferred_username: string };
  };
  expect(data.contact.type).toEqual("community");
  expect(data.contact.ap_id).toEqual(communityApId);
  expect(data.contact.preferred_username).toEqual("club");
});

test("deep-link resolve returns a user contact by ap_id", async () => {
  const db = await freshDb();
  const viewerApId = await insertLocalActor(db, "viewer");
  const otherApId = await insertLocalActor(db, "other");

  const app = appWith(db, fakeActor(viewerApId, "viewer"));
  const res = await app.fetch(
    new Request(`${APP_URL}/contact/${encodeURIComponent(otherApId)}`),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  const data = (await res.json()) as {
    contact: { type: string; ap_id: string };
  };
  expect(data.contact.type).toEqual("user");
  expect(data.contact.ap_id).toEqual(otherApId);
});

test("deep-link resolve returns 404 for an unknown ap_id", async () => {
  const db = await freshDb();
  const viewerApId = await insertLocalActor(db, "viewer");

  const app = appWith(db, fakeActor(viewerApId, "viewer"));
  const res = await app.fetch(
    new Request(
      `${APP_URL}/contact/${encodeURIComponent(localApId("nobody"))}`,
    ),
    envFor(db),
  );
  expect(res.status).toEqual(404);
});
