import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";

/**
 * A private (locked) account's follower/following LIST is owner-only — the
 * ActivityPub actor document already gates these collections
 * (canViewPrivateActorCollections: viewer === owner), but the API endpoints
 * GET /api/actors/:id/followers and /following listed them to anyone, leaking a
 * locked account's social graph. Non-owners must get an empty list (the count
 * stays, since it is shown on the profile); the owner still sees the full list.
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

async function insertActor(
  db: Database,
  username: string,
  isPrivate: number,
): Promise<string> {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    isPrivate,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return apId;
}

function app(db: Database, actor: Actor | null) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  a.route("/", actorsRoute);
  return a;
}

async function followers(
  db: Database,
  viewer: Actor | null,
  targetApId: string,
): Promise<{ items: string[]; total: number }> {
  const res = await app(db, viewer).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(targetApId)}/followers`),
    { APP_URL, DB_INSTANCE: db } as unknown as Env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    followers: { ap_id: string }[];
    total: number;
  };
  return { items: body.followers.map((f) => f.ap_id), total: body.total };
}

test("private account's follower list is owner-only; count stays visible", async () => {
  const db = await freshDb();
  const alice = await insertActor(db, "alice", 1); // private (locked)
  const bob = await insertActor(db, "bob", 0);
  // bob follows alice (accepted).
  await db.insert(follows).values({
    followerApId: bob,
    followingApId: alice,
    status: "accepted",
  });

  // Owner sees the full list.
  const asOwner = await followers(db, { ap_id: alice } as Actor, alice);
  expect(asOwner.items).toEqual([bob]);
  expect(asOwner.total).toBe(1);

  // A non-owner (even bob, who IS a follower) gets an empty list, real count.
  const asBob = await followers(db, { ap_id: bob } as Actor, alice);
  expect(asBob.items).toEqual([]);
  expect(asBob.total).toBe(1);

  // Anonymous: empty list, real count.
  const asAnon = await followers(db, null, alice);
  expect(asAnon.items).toEqual([]);
  expect(asAnon.total).toBe(1);
});

test("a PUBLIC account's follower list stays visible to everyone", async () => {
  const db = await freshDb();
  const carol = await insertActor(db, "carol", 0); // public
  const dave = await insertActor(db, "dave", 0);
  await db.insert(follows).values({
    followerApId: dave,
    followingApId: carol,
    status: "accepted",
  });

  const asAnon = await followers(db, null, carol);
  expect(asAnon.items).toEqual([dave]);
  expect(asAnon.total).toBe(1);
});
