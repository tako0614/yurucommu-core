import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * B0.1 — community timeline read gate (membership + visibility).
 *
 * GET /api/timeline?community=<ap_id> must:
 *  (i)   reject a non-member reading a PRIVATE community's feed (403, no leak),
 *  (ii)  serve the feed to an accepted member of that private community, and
 *  (iii) never leak community/addressed posts into the public timeline.
 */

import { Hono } from "hono";

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
import timelineRoutes from "../../routes/timeline.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
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
  router: Hono<{ Bindings: Env; Variables: Variables }>,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", router);
  return app;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

async function insertCommunity(
  db: Database,
  username: string,
  opts: { visibility?: string } = {},
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${username}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: opts.visibility ?? "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
  });
  return apId;
}

async function insertCommunityPost(
  db: Database,
  opts: {
    apId: string;
    author: string;
    communityApId: string;
    content: string;
    published: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.apId,
    type: "Note",
    attributedTo: opts.author,
    content: opts.content,
    visibility: "public",
    communityApId: opts.communityApId,
    // Community posts address the community group; a non-"[]" audience is what
    // keeps them out of the public/home feed.
    audienceJson: JSON.stringify([opts.communityApId]),
    published: opts.published,
    isLocal: 1,
  });
}

async function insertPublicPost(
  db: Database,
  opts: { apId: string; author: string; content: string; published: string },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.apId,
    type: "Note",
    attributedTo: opts.author,
    content: opts.content,
    visibility: "public",
    audienceJson: "[]",
    published: opts.published,
    isLocal: 1,
  });
}

type TimelineBody = { posts?: Array<{ ap_id: string }>; error?: string };

// ---------------------------------------------------------------------------
// (i) non-member cannot read a private community's posts
// ---------------------------------------------------------------------------

test("community timeline: non-member is denied a private community feed (403, no leak)", async () => {
  const db = await freshDb();
  const outsider = await insertLocalActor(db, "outsider");
  const poster = await insertLocalActor(db, "poster");
  const communityApId = await insertCommunity(db, "secret", {
    visibility: "private",
  });
  await insertCommunityPost(db, {
    apId: `${APP_URL}/ap/objects/c1`,
    author: poster,
    communityApId,
    content: "private community post",
    published: "2026-01-01T00:00:00.000Z",
  });

  const app = appWith(db, fakeActor(outsider, "outsider"), timelineRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/?community=${encodeURIComponent(communityApId)}`, {
      method: "GET",
    }),
    envFor(db),
  );

  expect(res.status).toEqual(403);
  const body = (await res.json()) as TimelineBody;
  // Must not leak the community's posts.
  expect(body.posts).toEqual(undefined);
});

// ---------------------------------------------------------------------------
// (ii) accepted member can read a private community's posts
// ---------------------------------------------------------------------------

test("community timeline: accepted member can read a private community feed", async () => {
  const db = await freshDb();
  const member = await insertLocalActor(db, "member");
  const poster = await insertLocalActor(db, "poster");
  const communityApId = await insertCommunity(db, "secret", {
    visibility: "private",
  });
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: member,
    role: "member",
  });
  await insertCommunityPost(db, {
    apId: `${APP_URL}/ap/objects/c1`,
    author: poster,
    communityApId,
    content: "private community post",
    published: "2026-01-01T00:00:00.000Z",
  });

  const app = appWith(db, fakeActor(member, "member"), timelineRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/?community=${encodeURIComponent(communityApId)}`, {
      method: "GET",
    }),
    envFor(db),
  );

  expect(res.status).toEqual(200);
  const body = (await res.json()) as TimelineBody;
  expect(body.posts?.map((p) => p.ap_id)).toEqual([`${APP_URL}/ap/objects/c1`]);
});

// ---------------------------------------------------------------------------
// (iii) community posts do not appear in the public timeline
// ---------------------------------------------------------------------------

test("community timeline: community posts never leak into the public feed", async () => {
  const db = await freshDb();
  const poster = await insertLocalActor(db, "poster");

  // A public community (so visibility is not the thing keeping its posts out).
  const communityApId = await insertCommunity(db, "town", {
    visibility: "public",
  });
  await insertCommunityPost(db, {
    apId: `${APP_URL}/ap/objects/community-post`,
    author: poster,
    communityApId,
    content: "in the community",
    published: "2026-01-02T00:00:00.000Z",
  });

  // A plain public post that SHOULD appear in the public feed.
  await insertPublicPost(db, {
    apId: `${APP_URL}/ap/objects/public-post`,
    author: poster,
    content: "out in the open",
    published: "2026-01-01T00:00:00.000Z",
  });

  const app = appWith(db, null, timelineRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    envFor(db),
  );

  expect(res.status).toEqual(200);
  const body = (await res.json()) as TimelineBody;
  const ids = body.posts?.map((p) => p.ap_id) ?? [];
  expect(ids).toContain(`${APP_URL}/ap/objects/public-post`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/community-post`);
});
