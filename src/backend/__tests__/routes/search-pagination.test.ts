import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import searchRoutes from "../../routes/search.ts";

/**
 * Actor search paginates: the merged (local + cached) result is sliced by
 * limit/offset in app code and reports an exact has_more up to the scan cap, so
 * the client can offer "load more" instead of being capped at a fixed page.
 */

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
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertActor(db: Database, username: string, followers: number) {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    followerCount: followers,
  });
}

function appFor(db: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await next();
  });
  app.route("/search", searchRoutes);
  return app;
}

type ActorPage = {
  actors: { preferred_username?: string }[];
  has_more: boolean;
  offset: number;
};

async function page(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  query: string,
): Promise<ActorPage> {
  const res = await app.request(`${APP_URL}/search/actors?${query}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ActorPage;
}

test("actor search pages by limit/offset with exact has_more", async () => {
  const db = await freshDb();
  // Five matching actors, distinct follower counts so the (sort=followers)
  // ordering is total and pages don't overlap.
  for (let i = 0; i < 5; i++) {
    await insertActor(db, `member${i}`, 50 - i);
  }
  const app = appFor(db);

  const p1 = await page(app, "q=member&sort=followers&limit=2&offset=0");
  expect(p1.actors.map((a) => a.preferred_username)).toEqual([
    "member0",
    "member1",
  ]);
  expect(p1.has_more).toBe(true);

  const p2 = await page(app, "q=member&sort=followers&limit=2&offset=2");
  expect(p2.actors.map((a) => a.preferred_username)).toEqual([
    "member2",
    "member3",
  ]);
  expect(p2.has_more).toBe(true);

  const p3 = await page(app, "q=member&sort=followers&limit=2&offset=4");
  expect(p3.actors.map((a) => a.preferred_username)).toEqual(["member4"]);
  expect(p3.has_more).toBe(false);

  // No overlap + full coverage across the three pages.
  const seen = [...p1.actors, ...p2.actors, ...p3.actors].map(
    (a) => a.preferred_username,
  );
  expect(new Set(seen).size).toBe(5);
});

test("post search with TIED `published` pages without dropping rows (unique apId tiebreaker)", async () => {
  const db = await freshDb();
  await insertActor(db, "author", 0);
  const author = `${APP_URL}/ap/users/author`;
  // Five public Notes that all share the SAME published second — without a
  // unique tiebreaker, OFFSET pagination could reorder a tied row out of an
  // unreached window and never return it.
  const ts = "2026-06-21T00:00:00.000Z";
  for (let i = 0; i < 5; i++) {
    await db.insert(objects).values({
      apId: `${APP_URL}/ap/objects/p${i}`,
      type: "Note",
      attributedTo: author,
      content: `aa post ${i}`,
      visibility: "public",
      audienceJson: "[]",
      published: ts,
    });
  }
  const app = appFor(db);
  const ids = new Set<string>();
  for (let offset = 0; offset < 6; offset += 2) {
    const res = await app.request(
      `${APP_URL}/search/posts?q=${encodeURIComponent("aa")}&limit=2&offset=${offset}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { posts: { ap_id: string }[] };
    for (const p of body.posts) ids.add(p.ap_id);
  }
  // All five tied-timestamp posts are reachable across pages (none dropped).
  expect(ids.size).toBe(5);
});
