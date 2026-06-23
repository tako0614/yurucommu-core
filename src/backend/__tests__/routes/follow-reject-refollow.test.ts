import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import followRoutes from "../../routes/follow.ts";

/**
 * A rejected follow request must NOT be a permanent dead state. POST /reject now
 * DELETEs the edge (matching the inbound handleReject), and the create path
 * clears any legacy 'rejected' row, so a requester can always re-follow.
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

async function insertActor(db: Database, username: string, isPrivate = 0) {
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
    isPrivate,
  });
  return apId;
}

function actorObj(apId: string): Actor {
  return { ap_id: apId, preferred_username: apId.split("/").pop() } as Actor;
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

const envFor = (db: Database): Env =>
  ({ APP_URL, DB_INSTANCE: db }) as unknown as Env;

const post = (db: Database, actor: Actor, path: string, body: unknown) =>
  appAs(db, actor).fetch(
    new Request(`${APP_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    envFor(db),
  );

const edgeOf = (db: Database, follower: string, following: string) =>
  db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, follower),
      eq(follows.followingApId, following),
    ),
  });

test("reject DELETES the edge so the requester can re-follow", async () => {
  const db = await freshDb();
  const target = await insertActor(db, "tako", 1); // private → pending
  const requester = await insertActor(db, "alice", 0);

  // 1. alice requests to follow private tako → pending.
  let res = await post(db, actorObj(requester), "/", { target_ap_id: target });
  expect(res.status).toBe(200);
  expect((await edgeOf(db, requester, target))?.status).toBe("pending");

  // 2. tako rejects → the edge is DELETED (not parked at 'rejected').
  res = await post(db, actorObj(target), "/reject", {
    requester_ap_id: requester,
  });
  expect(res.status).toBe(200);
  expect(await edgeOf(db, requester, target)).toBeUndefined();

  // 3. alice re-follows → succeeds with a fresh pending edge (NOT 400).
  res = await post(db, actorObj(requester), "/", { target_ap_id: target });
  expect(res.status).toBe(200);
  expect((await edgeOf(db, requester, target))?.status).toBe("pending");
});

test("a legacy 'rejected' edge does not block a re-follow", async () => {
  const db = await freshDb();
  const target = await insertActor(db, "tako", 1);
  const requester = await insertActor(db, "alice", 0);
  // Simulate a pre-fix dead 'rejected' row.
  await db.insert(follows).values({
    followerApId: requester,
    followingApId: target,
    status: "rejected",
  });

  const res = await post(db, actorObj(requester), "/", {
    target_ap_id: target,
  });
  expect(res.status).toBe(200);
  // The stale row was cleared and re-pended, not treated as "already pending".
  expect((await edgeOf(db, requester, target))?.status).toBe("pending");
});
