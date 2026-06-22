import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import searchRoutes from "../../routes/search.ts";

/**
 * Actor search escapes SQLite LIKE metacharacters: a query containing `_` or `%`
 * matches them LITERALLY, not as wildcards. The bare `like()` calls honoured no
 * ESCAPE, so "ta_ko" used to also match "taxko" (and "100%" matched everything).
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

async function insertLocalActor(db: Database, username: string, name: string) {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
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

async function searchActors(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  q: string,
): Promise<string[]> {
  const res = await app.request(
    `${APP_URL}/search/actors?q=${encodeURIComponent(q)}`,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    actors: { preferred_username?: string }[];
  };
  return body.actors.map((a) => a.preferred_username || "");
}

test("an underscore in a username query is literal, not a single-char wildcard", async () => {
  const db = await freshDb();
  await insertLocalActor(db, "ta_ko", "Underscore");
  await insertLocalActor(db, "taxko", "Wildcard trap");
  const app = appFor(db);

  const results = await searchActors(app, "ta_ko");
  expect(results).toContain("ta_ko");
  // Unescaped, `_` would also match the single char in "taxko".
  expect(results).not.toContain("taxko");
});

test("a percent in a name query is literal, not a match-everything wildcard", async () => {
  const db = await freshDb();
  await insertLocalActor(db, "alpha", "100% cotton");
  await insertLocalActor(db, "beta", "plain cotton");
  const app = appFor(db);

  const results = await searchActors(app, "100%");
  expect(results).toContain("alpha");
  // Unescaped, the trailing `%` would match every row.
  expect(results).not.toContain("beta");
});
