import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GET /search/hashtag/:tag must match the tag as a WHOLE hashtag token, not as a
 * substring. The handler prefilters with `LIKE '%#tag%'` (a superset that also
 * catches longer tags sharing the prefix) and then keeps only posts whose content
 * carries the exact token. Without that second step, searching "#deploy" would
 * wrongly return posts tagged "#deployed" (and trending vs search would disagree
 * on what a tag is). This pins the boundary behaviour.
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

async function insertPublicPost(
  db: Database,
  author: string,
  id: string,
  content: string,
): Promise<void> {
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/${id}`,
    type: "Note",
    attributedTo: author,
    content,
    visibility: "public",
    published: `2026-06-20T10:0${id.length % 10}:00.000Z`,
  });
}

function appFor(db: Database): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await next();
  });
  app.route("/search", searchRoutes);
  return app;
}

async function hashtagSearch(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  tag: string,
): Promise<{ total: number; contents: string[] }> {
  const res = await app.request(`${APP_URL}/search/hashtag/${tag}?limit=20`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    total: number;
    posts: { content: string }[];
  };
  return { total: body.total, contents: body.posts.map((p) => p.content) };
}

test("hashtag search matches the whole token, not a prefix of a longer tag", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");

  await insertPublicPost(db, alice, "p1", "shipping it #deployed today");
  await insertPublicPost(db, alice, "p2", "about to #deploy the worker");
  await insertPublicPost(db, alice, "p3", "spoiler season #cwlive thread");
  await insertPublicPost(db, alice, "p4", "nothing tagged here");

  const app = appFor(db);

  // Exact tags return only their own post.
  const deployed = await hashtagSearch(app, "deployed");
  expect(deployed.total).toBe(1);
  expect(deployed.contents[0]).toContain("#deployed");

  const deploy = await hashtagSearch(app, "deploy");
  expect(deploy.total).toBe(1);
  expect(deploy.contents[0]).toContain("#deploy the");
  // The critical assertion: "#deploy" must NOT pull in the "#deployed" post.
  expect(deploy.contents.some((c) => c.includes("#deployed"))).toBe(false);

  // A prefix that is not itself a tag returns nothing (no "#cw" → "#cwlive").
  const cwPrefix = await hashtagSearch(app, "cw");
  expect(cwPrefix.total).toBe(0);

  const cwlive = await hashtagSearch(app, "cwlive");
  expect(cwlive.total).toBe(1);
  expect(cwlive.contents[0]).toContain("#cwlive");
});

test("hashtag search is case-insensitive on the whole token", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  await insertPublicPost(db, alice, "u1", "morning #ToKyo vibes");

  const app = appFor(db);
  const lower = await hashtagSearch(app, "tokyo");
  expect(lower.total).toBe(1);
  // But a longer tag sharing the prefix still must not match.
  const prefix = await hashtagSearch(app, "tok");
  expect(prefix.total).toBe(0);
});
