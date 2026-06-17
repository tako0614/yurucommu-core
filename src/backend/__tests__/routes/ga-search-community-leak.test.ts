import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #2 + #7 — community-scope leak via hashtag / trending search.
 *
 * Community-scoped Notes are persisted as visibility="public" but carry a
 * non-"[]" audienceJson (the community read-gate). The /search/posts route
 * already filters on BOTH visibility="public" AND audienceJson="[]". This
 * test pins the same guard for the two other anonymous-reachable post search
 * routes, which previously filtered on visibility ALONE:
 *
 *  (i)  GET /search/hashtag/:tag must NOT return a community post's content
 *       (and must not count it), and
 *  (ii) GET /search/hashtags/trending must NOT surface the community post's
 *       hashtag names/counts.
 *
 * A regular (empty-audience) public post with the same hashtag IS returned,
 * proving the guard scopes out only the community-gated content.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import searchRoutes from "../../routes/search.ts";

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

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
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

async function insertPost(
  db: Database,
  author: string,
  id: string,
  content: string,
  published: string,
  audienceJson: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content,
    // Community posts are stored visibility="public" but with a non-empty
    // audience — exactly the shape that the leak depended on.
    visibility: "public",
    audienceJson,
    published,
  });
  return apId;
}

function appFor(db: Database): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    // anonymous / non-member caller: no actor in context.
    c.set("actor", null);
    await next();
  });
  app.route("/search", searchRoutes);
  return app;
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

test("hashtag search hides community-scoped posts from anonymous callers", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "alice");

  // Public, empty-audience post — must be searchable.
  const publicPostId = await insertPost(
    db,
    author,
    "pub",
    "open thoughts #secretclub",
    isoMinutesAgo(5),
    "[]",
  );
  // Community-scoped post: visibility="public" but audience targets a
  // community. Must NOT leak to anonymous hashtag search.
  await insertPost(
    db,
    author,
    "comm",
    "members only secret #secretclub",
    isoMinutesAgo(4),
    JSON.stringify([`${APP_URL}/ap/groups/secretclub`]),
  );

  const app = appFor(db);
  const res = await app.request(`${APP_URL}/search/hashtag/secretclub`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posts: { ap_id: string; content: string }[];
    total: number;
  };

  const ids = body.posts.map((p) => p.ap_id);
  expect(ids).toContain(publicPostId);
  // The community post must be absent — neither its id nor its content leaks.
  expect(ids).not.toContain(`${APP_URL}/ap/objects/comm`);
  expect(body.posts.some((p) => p.content.includes("members only"))).toBe(
    false,
  );
  // The count must also exclude the gated post.
  expect(body.total).toBe(1);
});

test("trending hashtags omit community-scoped post tags for anonymous callers", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "bob");

  // Public post contributes #plaza to trending.
  await insertPost(
    db,
    author,
    "t1",
    "town square #plaza",
    isoMinutesAgo(3),
    "[]",
  );
  // Two community-scoped posts use #backroom; they must not appear or count.
  await insertPost(
    db,
    author,
    "t2",
    "hush #backroom #backroom",
    isoMinutesAgo(2),
    JSON.stringify([`${APP_URL}/ap/groups/secretclub`]),
  );
  await insertPost(
    db,
    author,
    "t3",
    "more #backroom",
    isoMinutesAgo(1),
    JSON.stringify([`${APP_URL}/ap/groups/secretclub`]),
  );

  const app = appFor(db);
  // Unique limit/days pair so the module-global trending cache key does not
  // collide with other tests in the suite.
  const res = await app.request(
    `${APP_URL}/search/hashtags/trending?limit=11&days=9`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    trending: { tag: string; count: number }[];
  };

  const tags = body.trending.map((t) => t.tag);
  expect(tags).toContain("plaza");
  // The community-only hashtag must not surface at all.
  expect(tags).not.toContain("backroom");
});
