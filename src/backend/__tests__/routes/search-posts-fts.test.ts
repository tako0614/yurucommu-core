import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GET /search/posts is backed by the objects_fts trigram FTS5 index (migration
 * 0012). This pins the behaviour that matters:
 *  - indexed substring match works for Japanese (default tokenizer can't) AND ASCII,
 *  - the index stays in sync through INSERT / UPDATE-of-content / DELETE triggers,
 *  - visibility/audience gating still excludes community/private posts (no leak),
 *  - sub-trigram (1-2 char) queries fall back to LIKE so they still match.
 */

import { Hono } from "hono";
import { sql } from "drizzle-orm";
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
  "0012_objects_content_fts.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const ddl = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(ddl);
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
  audienceJson = "[]",
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content,
    visibility: "public",
    audienceJson,
    published: `2026-06-20T10:00:0${id.length % 10}.000Z`,
  });
  return apId;
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

async function searchPosts(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  q: string,
): Promise<string[]> {
  const res = await app.request(
    `${APP_URL}/search/posts?q=${encodeURIComponent(q)}`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { posts: { content: string }[] };
  return body.posts.map((p) => p.content);
}

test("content search matches JA + ASCII substrings and gates non-public posts", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "alice");
  await insertPost(db, author, "p1", "本番デプロイから最初の投稿です");
  await insertPost(db, author, "p2", "hello workers and storage");
  // Community-scoped (audience != []) — must never surface in public search.
  await insertPost(db, author, "p3", "members only secret stuff", '["g"]');

  const app = appFor(db);

  // Japanese substring (the whole reason for trigram over the default tokenizer).
  const ja = await searchPosts(app, "デプロイ");
  expect(ja).toEqual(["本番デプロイから最初の投稿です"]);

  // ASCII substring.
  const en = await searchPosts(app, "workers");
  expect(en).toEqual(["hello workers and storage"]);

  // The community post's content matches the index but the visibility guard
  // must keep it out of anonymous results.
  const gated = await searchPosts(app, "secret");
  expect(gated).toEqual([]);
});

test("editing a post's content re-indexes it (UPDATE-of-content trigger)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "bob");
  const apId = await insertPost(db, author, "e1", "alpha bravo charlie");
  const app = appFor(db);

  expect(await searchPosts(app, "bravo")).toEqual(["alpha bravo charlie"]);

  await db
    .update(objects)
    .set({ content: "delta echo foxtrot" })
    .where(sql`${objects.apId} = ${apId}`);

  // Old terms gone, new terms searchable.
  expect(await searchPosts(app, "bravo")).toEqual([]);
  expect(await searchPosts(app, "echo")).toEqual(["delta echo foxtrot"]);
});

test("deleting a post removes it from the index (DELETE trigger)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "carol");
  const apId = await insertPost(db, author, "d1", "ephemeral message body");
  const app = appFor(db);

  expect(await searchPosts(app, "ephemeral")).toEqual([
    "ephemeral message body",
  ]);

  await db.delete(objects).where(sql`${objects.apId} = ${apId}`);
  expect(await searchPosts(app, "ephemeral")).toEqual([]);
});

test("post search excludes blocked AND muted authors (moderation parity with feeds)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const blocked = await insertLocalActor(db, "blockee");
  const muted = await insertLocalActor(db, "mutee");
  const visible = await insertLocalActor(db, "okauthor");
  await insertPost(db, blocked, "b1", "shared keyword foobar from blocked");
  await insertPost(db, muted, "m1", "shared keyword foobar from muted");
  await insertPost(db, visible, "o1", "shared keyword foobar from ok");
  await db
    .insert(schema.blocks)
    .values({ blockerApId: viewer, blockedApId: blocked });
  await db.insert(schema.mutes).values({ muterApId: viewer, mutedApId: muted });

  // App with the viewer as the authenticated actor.
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    c.set("actor", { ap_id: viewer } as any);
    await next();
  });
  app.route("/search", searchRoutes);

  const res = await app.request(`${APP_URL}/search/posts?q=foobar`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { posts: { content: string }[] };
  const contents = body.posts.map((p) => p.content);
  expect(contents).toContain("shared keyword foobar from ok");
  expect(contents).not.toContain("shared keyword foobar from blocked");
  expect(contents).not.toContain("shared keyword foobar from muted");
});

test("1-2 char queries fall back to LIKE (below trigram's minimum)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "dave");
  await insertPost(db, author, "s1", "本日は晴天");
  const app = appFor(db);

  // "本" is a single character — trigram can't index it, LIKE fallback must.
  expect(await searchPosts(app, "本")).toEqual(["本日は晴天"]);
});

// Audit #19: the FTS-vs-fallback decision must count CODEPOINTS, not UTF-16 units.
// A 2-emoji query ("🦀🦀") has .length 4 (>=3) but only 2 codepoints, so it formed
// ZERO trigrams under FTS and silently matched nothing; it must fall back to instr().
test("a short astral (emoji) query falls back to instr() and matches", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "erin");
  await insertPost(db, author, "e1", "I posted 🦀🦀 about rust");
  const app = appFor(db);

  expect(await searchPosts(app, "🦀🦀")).toEqual(["I posted 🦀🦀 about rust"]);
});
