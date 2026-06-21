import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GET /search/actors must find a user when the query carries the leading "@"
 * that people habitually type for a handle. preferredUsername is stored without
 * the "@", so a naive `LIKE '%@tako%'` matched nothing — this pins that "@tako"
 * (and "@tak") still resolve to "tako".
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
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
    const ddl = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(ddl);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertLocalActor(
  db: Database,
  username: string,
  name: string,
): Promise<void> {
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

test("actor search resolves a leading @ to the bare handle", async () => {
  const db = await freshDb();
  await insertLocalActor(db, "tako", "Tako");
  const app = appFor(db);

  expect(await searchActors(app, "tako")).toContain("tako");
  // The fix: the @ that users type must not break the lookup.
  expect(await searchActors(app, "@tako")).toContain("tako");
  expect(await searchActors(app, "@tak")).toContain("tako");
  // A bare "@" (or "@" only after trim) yields nothing, not an error/everyone.
  expect(await searchActors(app, "@")).toEqual([]);
});
