import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import recommendationsRoute from "../../routes/recommendations.ts";

// Audit #8 finding #5 (privacy parity): the friends-of-friends recommendation
// panel must hide private/locked (is_private = 1) accounts, matching every other
// actor-discovery surface (search.actors / takos-tools). Otherwise a locked
// account's handle/name/icon leaks to anyone sharing a follow-of-follows path.

const APP_URL = "https://yuru.test";
const localApId = (u: string) => `${APP_URL}/ap/users/${u}`;

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertActor(db: Database, username: string, isPrivate = 0) {
  const apId = localApId(username);
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
    isPrivate,
  });
  return apId;
}

async function follow(db: Database, follower: string, following: string) {
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: following,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
}

function viewerActor(apId: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: "viewer",
    role: "owner",
    is_private: 0,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
  } as unknown as Actor;
}

test("recommendations exclude private/locked accounts but keep public ones", async () => {
  const db = await freshDb();
  const viewer = await insertActor(db, "viewer");
  const mid = await insertActor(db, "mid");
  const pub = await insertActor(db, "pubrec");
  const locked = await insertActor(db, "lockedrec", 1); // is_private = 1

  // viewer -> mid -> {pub, locked}: both pub and locked are friends-of-friends.
  await follow(db, viewer, mid);
  await follow(db, mid, pub);
  await follow(db, mid, locked);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", viewerActor(viewer));
    await next();
  });
  app.route("/", recommendationsRoute);

  const res = await app.fetch(new Request(`${APP_URL}/users`), {
    APP_URL,
    DB_INSTANCE: db,
  } as unknown as Env);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { users: Array<{ ap_id: string }> };
  const ids = body.users.map((u) => u.ap_id);
  expect(ids).toContain(pub);
  expect(ids).not.toContain(locked);
});

test("recommendations stay non-fatal when the optional query fails", async () => {
  const viewer = localApId("unstable-viewer");
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", {
      all: async () => {
        throw new Error("simulated recommendation storage failure");
      },
    } as unknown as Database);
    c.set("actor", viewerActor(viewer));
    await next();
  });
  app.route("/", recommendationsRoute);

  const res = await app.fetch(new Request(`${APP_URL}/users`), {
    APP_URL,
  } as unknown as Env);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ users: [] });
});
