import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #21 — GET /search/hashtags/trending is wrapped in `withCache`.
 *
 * The trending-hashtags endpoint scans recent public posts and regex-parses
 * them in JS on every call. It carries NO per-viewer data (the result is
 * identical for every caller), so it must be served from the shared cache:
 *
 *  (i)  the response SHAPE/counts are unchanged (regression guard), and
 *  (ii) a second identical anonymous request is a cache HIT and is served the
 *       same body WITHOUT re-running the expensive scan — proven by mutating
 *       the DB between the two requests and observing the cached body wins.
 *
 * The cache wrapper deliberately bypasses for authenticated actors
 * (varyByActor is unset), matching the public-timeline route; we assert the
 * anonymous path here.
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
  published: string,
): Promise<void> {
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/${id}`,
    type: "Note",
    attributedTo: author,
    content,
    visibility: "public",
    published,
  });
}

function appFor(db: Database): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    // anonymous-shareable: no actor, so the shared cache is engaged.
    c.set("actor", null);
    await next();
  });
  app.route("/search", searchRoutes);
  return app;
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

test("trending hashtags: correct shape/counts on a cache MISS", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "alice");

  // #tokyo x3, #food x2, #solo x1 — counts must rank by frequency.
  await insertPublicPost(
    db,
    author,
    "p1",
    "morning #Tokyo #food",
    isoMinutesAgo(5),
  );
  await insertPublicPost(
    db,
    author,
    "p2",
    "lunch #tokyo #FOOD",
    isoMinutesAgo(4),
  );
  await insertPublicPost(
    db,
    author,
    "p3",
    "dinner #TOKYO #solo",
    isoMinutesAgo(3),
  );

  const app = appFor(db);
  const res = await app.request(
    `${APP_URL}/search/hashtags/trending?limit=10&days=7`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    trending: { tag: string; count: number }[];
  };

  expect(body.trending[0]).toEqual({ tag: "tokyo", count: 3 });
  expect(body.trending[1]).toEqual({ tag: "food", count: 2 });
  expect(body.trending.find((t) => t.tag === "solo")?.count).toBe(1);
});

test("trending hashtags: second identical anonymous request is served from cache", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "bob");
  await insertPublicPost(db, author, "q1", "hello #alpha", isoMinutesAgo(2));

  const app = appFor(db);
  // The cache key only varies by the route's own params (limit/days). Use a
  // limit/days pair distinct from the sibling test so the module-global memory
  // cache key does not collide across tests in this file.
  const url = `${APP_URL}/search/hashtags/trending?limit=5&days=3`;

  const first = await app.request(url);
  expect(first.status).toBe(200);
  const firstBody = (await first.json()) as {
    trending: { tag: string; count: number }[];
  };
  expect(firstBody.trending).toEqual([{ tag: "alpha", count: 1 }]);

  // Mutate the DB AFTER the first (cache-populating) request. If the route were
  // not cached, the second request would re-scan and surface #beta.
  await insertPublicPost(
    db,
    author,
    "q2",
    "#beta #beta #beta",
    isoMinutesAgo(1),
  );

  const second = await app.request(url);
  expect(second.status).toBe(200);
  expect(second.headers.get("X-Cache")).toBe("HIT");
  const secondBody = (await second.json()) as {
    trending: { tag: string; count: number }[];
  };
  // The cached body wins — #beta is absent despite being in the DB now.
  expect(secondBody.trending).toEqual([{ tag: "alpha", count: 1 }]);
});
