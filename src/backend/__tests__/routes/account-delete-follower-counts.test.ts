import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";

/**
 * Account deletion (POST /me/delete) must reconcile the COUNTERPARTIES' follower
 * /following counts when it drops the deleted actor's follow edges — the one
 * edge-removal path that used to skip the reconciliation, leaving 3rd-party
 * counts permanently inflated. A guard prevents underflow below 0.
 */

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(u: string) {
  return `${APP_URL}/ap/users/${u}`;
}

async function insertActor(
  db: Database,
  username: string,
  counts: { followerCount?: number; followingCount?: number } = {},
) {
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
    followerCount: counts.followerCount ?? 0,
    followingCount: counts.followingCount ?? 0,
  });
  return apId;
}

function ownerActor(apId: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: "tako",
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
    role: "owner",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function envFor(db: Database): Env {
  const q = {
    send: () => Promise.resolve(),
    sendBatch: () => Promise.resolve(),
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: q,
    DELIVERY_DLQ: { send: () => Promise.resolve() },
  } as unknown as Env;
}

async function follow(db: Database, follower: string, following: string) {
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: following,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
}

const countOf = async (db: Database, apId: string) =>
  db
    .select({
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
    })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();

test("deleting an account decrements counterparties' follower/following counts (guarded)", async () => {
  const db = await freshDb();
  const tako = await insertActor(db, "tako"); // the account being deleted
  const alice = await insertActor(db, "alice", { followerCount: 1 }); // tako -> alice
  const bob = await insertActor(db, "bob", { followingCount: 1 }); // bob -> tako
  const carol = await insertActor(db, "carol", { followerCount: 0 }); // tako -> carol, but count already 0 (guard)

  await follow(db, tako, alice); // alice gains tako as a follower
  await follow(db, bob, tako); // bob follows tako
  await follow(db, tako, carol);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor(tako));
    await next();
  });
  app.route("/", actorsRoute);

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(res.status).toBe(200);

  // alice lost tako as a follower; bob lost tako from its following.
  expect((await countOf(db, alice))?.followerCount).toBe(0);
  expect((await countOf(db, bob))?.followingCount).toBe(0);
  // carol's count was already 0 — the gt(...,0) guard keeps it at 0, not -1.
  expect((await countOf(db, carol))?.followerCount).toBe(0);
});
