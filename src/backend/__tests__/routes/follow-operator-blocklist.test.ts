import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";

import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actorCache, actors, follows } from "../../../db/index.ts";
import { blockActor, blockDomain } from "../../lib/blocklist.ts";
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
): Promise<Actor> {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "public",
    privateKeyPem: "private",
  });
  return { ap_id: apId, preferred_username: username } as Actor;
}

async function insertCachedRemoteActor(
  db: Database,
  apId: string,
): Promise<void> {
  await db.insert(actorCache).values({
    apId,
    preferredUsername: "blocked",
    name: "Blocked Remote",
    inbox: `${apId}/inbox`,
    rawJson: JSON.stringify({ id: apId, type: "Person" }),
  });
}

function appAs(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", followRoutes);
  return app;
}

async function postFollow(db: Database, actor: Actor, targetApId: string) {
  return appAs(db, actor).fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_ap_id: targetApId }),
    }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
}

async function followState(
  db: Database,
  followerApId: string,
  targetApId: string,
) {
  const edge = await db
    .select({ status: follows.status })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, followerApId),
        eq(follows.followingApId, targetApId),
      ),
    )
    .get();
  const activityRows = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(
      and(
        eq(activities.type, "Follow"),
        eq(activities.actorApId, followerApId),
        eq(activities.objectApId, targetApId),
      ),
    );
  return { edge: edge?.status ?? null, activities: activityRows.length };
}

test("an operator-blocked cached remote actor cannot acquire a new follow edge", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "alice");
  const target = "https://blocked-actor.example/users/bob";
  await insertCachedRemoteActor(db, target);
  await blockActor(db, target, "defederated");

  const res = await postFollow(db, actor, target);

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Target actor not found" });
  expect(await followState(db, actor.ap_id, target)).toEqual({
    edge: null,
    activities: 0,
  });
  expect(await db.select().from(actorCache)).toHaveLength(1);
});

test("a domain block prevents follow mutation before legacy rejected-edge cleanup", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "alice");
  const target = "https://node.blocked.example/users/bob";
  await insertCachedRemoteActor(db, target);
  await db.insert(follows).values({
    followerApId: actor.ap_id,
    followingApId: target,
    status: "rejected",
  });
  await blockDomain(db, "blocked.example", "defederated");

  const res = await postFollow(db, actor, target);

  expect(res.status).toBe(404);
  expect(await followState(db, actor.ap_id, target)).toEqual({
    edge: "rejected",
    activities: 0,
  });
});

test("a blocklist outage fails closed before creating a Follow edge or Activity", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "alice");
  const target = "https://possibly-blocked.example/users/bob";
  await insertCachedRemoteActor(db, target);
  await db.run(
    sql`ALTER TABLE blocked_actors RENAME TO blocked_actors_offline`,
  );

  try {
    const res = await postFollow(db, actor, target);

    expect(res.status).toBe(500);
    expect(await followState(db, actor.ap_id, target)).toEqual({
      edge: null,
      activities: 0,
    });
  } finally {
    await db.run(
      sql`ALTER TABLE blocked_actors_offline RENAME TO blocked_actors`,
    );
  }
});
