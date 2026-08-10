import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actorCache, actors, follows } from "../../../db/index.ts";
import { blockActor, blockDomain } from "../../lib/blocklist.ts";
import activityPubRoutes from "../../routes/activitypub.ts";
import actorsRoute from "../../routes/actors.ts";
import followRoutes from "../../routes/follow.ts";
import type { Actor, Env, Variables } from "../../types.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
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
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "public",
    privateKeyPem: "private",
  });
  return apId;
}

async function insertCachedActor(db: Database, apId: string, name: string) {
  await db.insert(actorCache).values({
    apId,
    preferredUsername: name.toLowerCase(),
    name,
    inbox: `${apId}/inbox`,
    rawJson: JSON.stringify({ id: apId, type: "Person" }),
  });
}

function appWith(
  db: Database,
  actor: Actor | null,
  route: Hono<{ Bindings: Env; Variables: Variables }>,
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", route);
  return app;
}

const envFor = (db: Database) =>
  ({ APP_URL, DB_INSTANCE: db }) as unknown as Env;

test("web following list suppresses a retained cosmetically blocked actor", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const allowed = "https://allowed.example/users/visible";
  const blocked = "https://blocked.example/users/hidden";
  await insertCachedActor(db, allowed, "Visible");
  await insertCachedActor(db, blocked, "Hidden");
  await db.insert(follows).values([
    { followerApId: alice, followingApId: blocked, status: "accepted" },
    { followerApId: alice, followingApId: allowed, status: "accepted" },
  ]);
  await blockActor(
    db,
    "https://BLOCKED.example:443/users/hidden/#legacy",
    "defederated",
  );

  const res = await appWith(db, { ap_id: alice } as Actor, actorsRoute).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(alice)}/following?limit=1`),
    envFor(db),
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    following: Array<{ ap_id: string }>;
    total: number;
    has_more: boolean;
  };
  expect(body.following.map((actor) => actor.ap_id)).toEqual([allowed]);
  expect(body.total).toBe(1);
  expect(body.has_more).toBe(false);
});

test("ActivityPub following collection suppresses a retained domain-blocked actor", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const allowed = "https://allowed.example/users/visible";
  const blocked = "https://node.blocked.example.:8443/users/hidden";
  await db.insert(follows).values([
    { followerApId: alice, followingApId: blocked, status: "accepted" },
    { followerApId: alice, followingApId: allowed, status: "accepted" },
  ]);
  await blockDomain(db, "blocked.example", "defederated");

  const res = await appWith(db, null, activityPubRoutes).fetch(
    new Request(`${APP_URL}/ap/users/alice/following?page=1&limit=1`),
    envFor(db),
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    orderedItems: string[];
  };
  expect(body.orderedItems).toEqual([allowed]);
});

test("pending follow requests suppress a retained operator-blocked requester", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const allowed = "https://allowed.example/users/visible";
  const blocked = "https://node.blocked.example/users/hidden";
  await insertCachedActor(db, allowed, "Visible");
  await insertCachedActor(db, blocked, "Hidden");
  await db.insert(follows).values([
    { followerApId: blocked, followingApId: alice, status: "pending" },
    { followerApId: allowed, followingApId: alice, status: "pending" },
  ]);
  await blockDomain(db, "blocked.example", "defederated");

  const res = await appWith(db, { ap_id: alice } as Actor, followRoutes).fetch(
    new Request(`${APP_URL}/requests?limit=1`),
    envFor(db),
  );

  expect(res.status).toBe(200);
  const body = (await res.json()) as { requests: Array<{ ap_id: string }> };
  expect(body.requests.map((request) => request.ap_id)).toEqual([allowed]);
});

test("single accept cannot re-admit an operator-blocked pending requester", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const blocked = "https://blocked.example/users/hidden";
  await insertCachedActor(db, blocked, "Hidden");
  await db.insert(follows).values({
    followerApId: blocked,
    followingApId: alice,
    status: "pending",
  });
  await blockActor(db, blocked, "defederated");

  const res = await appWith(db, { ap_id: alice } as Actor, followRoutes).fetch(
    new Request(`${APP_URL}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: blocked }),
    }),
    envFor(db),
  );

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "No pending follow request" });
  expect((await db.select().from(follows))[0]?.status).toBe("pending");
  expect(
    (
      await db
        .select({ count: actors.followerCount })
        .from(actors)
        .where(eq(actors.apId, alice))
        .get()
    )?.count,
  ).toBe(0);
  expect(await db.select().from(activities)).toHaveLength(0);
});

test("batch accept reports an operator-blocked requester as unavailable without mutation", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const blocked = "https://node.blocked.example/users/hidden";
  await insertCachedActor(db, blocked, "Hidden");
  await db.insert(follows).values({
    followerApId: blocked,
    followingApId: alice,
    status: "pending",
  });
  await blockDomain(db, "blocked.example", "defederated");

  const res = await appWith(db, { ap_id: alice } as Actor, followRoutes).fetch(
    new Request(`${APP_URL}/accept/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_ids: [blocked] }),
    }),
    envFor(db),
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    results: [
      {
        ap_id: blocked,
        success: false,
        error: "No pending follow request",
      },
    ],
    accepted_count: 0,
  });
  expect((await db.select().from(follows))[0]?.status).toBe("pending");
  expect(await db.select().from(activities)).toHaveLength(0);
});
