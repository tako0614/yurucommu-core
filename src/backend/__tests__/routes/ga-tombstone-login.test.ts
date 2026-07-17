import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA Wave-9 TOMBSTONE-AUTH — auth-path correctness after account deletion.
 *
 * Round-4 regressions left over from the wave-8 tombstoning work:
 *
 *  - #2: owner password login resolved the owner by `role = "owner"` with no
 *    `deletedAt` guard, so it re-resolved the SCRUBBED tombstone (role still
 *    "owner") and logged into a zombie account. Fixed by filtering `notDeleted`
 *    in the owner-resolution query + demoting the tombstone off the owner role.
 *    A fresh /me/delete + re-login must PROVISION A NEW owner, not the tombstone.
 *  - #9: the username-collision probes counted tombstoned apIds, so a freed
 *    handle was not re-registerable until the reaper ran. Fixed by filtering
 *    `notDeleted` in the probes + reviving the tombstone row on re-registration.
 *  - #12: reapDrainedTombstones omitted the "retry_wait" delivery status from
 *    its no-pending guard, so a still-retrying Delete could be reaped early.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  deliveryQueue,
  sessions,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import authRoutes from "../../routes/auth.ts";
import actorsRoutes, { reapDrainedTombstones } from "../../routes/actors.ts";

const APP_URL = "https://yuru.test";
const BOOTSTRAP_TOKEN = "bootstrap-owner-token-no-colon";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
  // Account teardown deletes notification pusher + push-job rows.
  "0019_notification_push_delivery.sql",
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

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

/** Minimal in-memory KV so the login-lockout path has a real store. */
function memoryKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function captureQueue() {
  return {
    async send() {},
    async sendBatch() {},
  };
}

function envFor(db: Database): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    KV: memoryKv(),
    DELIVERY_QUEUE: captureQueue(),
    DELIVERY_DLQ: captureQueue(),
    AUTH_PASSWORD_HASH: BOOTSTRAP_TOKEN,
    YURUCOMMU_SESSION_HASH_SALT: "test-session-salt",
  } as unknown as Env;
}

/** App for the auth router (no logged-in actor needed for password login). */
function authApp(db: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.route("/", authRoutes);
  return app;
}

/** App for the actors router with a fixed logged-in actor. */
function actorsApp(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", actorsRoutes);
  return app;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: `Display ${username}`,
    summary: "bio",
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "PUBLIC-KEY",
    private_key_pem: "PRIVATE-KEY",
    takos_user_id: `takos-${username}`,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: new Date().toISOString(),
  } as unknown as Actor;
}

async function passwordLogin(db: Database): Promise<Response> {
  const app = authApp(db);
  const env = envFor(db);
  return app.fetch(
    new Request(`${APP_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: BOOTSTRAP_TOKEN }),
    }),
    env,
  );
}

test("owner login after /me/delete provisions a FRESH owner, not the tombstone", async () => {
  const db = await freshDb();

  // 1) First owner password login provisions the default "tako" owner.
  const first = await passwordLogin(db);
  expect(first.status).toBe(200);

  const owner = await db
    .select()
    .from(actors)
    .where(eq(actors.role, "owner"))
    .get();
  expect(owner).toBeTruthy();
  const originalOwnerApId = owner!.apId;
  expect(originalOwnerApId).toBe(localApId("tako"));

  // 2) The owner deletes their own account -> tombstone (role demoted +
  //    deletedAt set, sessions deleted).
  const delApp = actorsApp(db, fakeActor(originalOwnerApId, "tako"));
  const delRes = await delApp.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(delRes.status).toBe(200);

  const tombstone = await db
    .select({ role: actors.role, deletedAt: actors.deletedAt })
    .from(actors)
    .where(eq(actors.apId, originalOwnerApId))
    .get();
  expect(tombstone?.deletedAt).toBeTruthy();
  // #2: the tombstone must NOT keep the owner role.
  expect(tombstone?.role).not.toBe("owner");

  // No LIVE owner remains.
  const liveOwnerAfterDelete = await db
    .select()
    .from(actors)
    .where(eq(actors.role, "owner"))
    .all();
  expect(liveOwnerAfterDelete.filter((a) => a.deletedAt == null).length).toBe(
    0,
  );

  // 3) Re-login must NOT resolve the zombie tombstone. It re-provisions a fresh
  //    owner on the same deterministic apId by REVIVING the drained row: a live
  //    (deletedAt = null) owner with the "tako" handle restored.
  const second = await passwordLogin(db);
  expect(second.status).toBe(200);

  const revived = await db
    .select()
    .from(actors)
    .where(eq(actors.apId, originalOwnerApId))
    .get();
  expect(revived?.deletedAt).toBeNull();
  expect(revived?.role).toBe("owner");
  expect(revived?.preferredUsername).toBe("tako");

  // Exactly one live owner exists.
  const liveOwners = (
    await db.select().from(actors).where(eq(actors.role, "owner")).all()
  ).filter((a) => a.deletedAt == null);
  expect(liveOwners.length).toBe(1);

  // The login minted a fresh session bound to the revived owner.
  const session = await db
    .select()
    .from(sessions)
    .where(eq(sessions.memberId, originalOwnerApId))
    .get();
  expect(session).toBeTruthy();
});

test("a freed handle is immediately re-registerable as a sub-account", async () => {
  const db = await freshDb();

  // Provision the owner.
  expect((await passwordLogin(db)).status).toBe(200);
  const owner = await db
    .select()
    .from(actors)
    .where(eq(actors.role, "owner"))
    .get();
  const ownerApId = owner!.apId;

  // Sub-account create lives on the auth router (POST /accounts).
  const accountsApp = new Hono<{ Bindings: Env; Variables: Variables }>();
  accountsApp.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", fakeActor(ownerApId, "tako"));
    await next();
  });
  accountsApp.route("/", authRoutes);

  const createBob = await accountsApp.fetch(
    new Request(`${APP_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    }),
    envFor(db),
  );
  expect(createBob.status).toBe(200);
  const bobApId = localApId("bob");

  // Delete bob's account -> tombstone (handle renamed to a deleted-* sentinel).
  const delBobApp = actorsApp(db, fakeActor(bobApId, "bob"));
  const delBob = await delBobApp.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(delBob.status).toBe(200);

  const bobTombstone = await db
    .select({ preferredUsername: actors.preferredUsername })
    .from(actors)
    .where(eq(actors.apId, bobApId))
    .get();
  expect(bobTombstone?.preferredUsername?.startsWith("deleted-")).toBe(true);

  // #9: the freed handle "bob" is IMMEDIATELY re-registerable (before any
  // reaper run): the collision probe ignores the tombstone and createActor
  // revives the row to a fresh live actor.
  const recreateBob = await accountsApp.fetch(
    new Request(`${APP_URL}/accounts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "bob" }),
    }),
    envFor(db),
  );
  expect(recreateBob.status).toBe(200);

  const revivedBob = await db
    .select()
    .from(actors)
    .where(eq(actors.apId, bobApId))
    .get();
  expect(revivedBob?.deletedAt).toBeNull();
  expect(revivedBob?.preferredUsername).toBe("bob");
  expect(revivedBob?.role).toBe("member");
});

test("reaper keeps a tombstone whose Delete is in retry_wait", async () => {
  const db = await freshDb();

  // A drained-by-age tombstone (deletedAt past the reap horizon).
  const apId = localApId("ghost");
  const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: "deleted-ghost",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "PUB",
    privateKeyPem: "PRIV",
    role: "member",
    deletedAt: oldIso,
  });

  // Its preserved outbound Delete activity ...
  const deleteActivityId = `${APP_URL}/ap/activities/del-ghost`;
  await db.insert(activities).values({
    apId: deleteActivityId,
    type: "Delete",
    actorApId: apId,
    objectApId: apId,
    rawJson: JSON.stringify({ type: "Delete", actor: apId, object: apId }),
    direction: "outbound",
  });

  // ... with a delivery job still in retry_wait (a between-attempts retry).
  await db.insert(deliveryQueue).values({
    id: "dq-ghost-1",
    activityApId: deleteActivityId,
    inboxUrl: "https://remote.test/inbox",
    status: "retry_wait",
  });

  // #12: the still-retrying Delete must NOT be reaped (its private key may yet
  // be needed to sign the retry).
  const reaped = await reapDrainedTombstones(db);
  expect(reaped).toBe(0);

  const stillThere = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  expect(stillThere).toBeTruthy();

  // Once the job reaches a terminal state, the tombstone IS reaped.
  await db
    .update(deliveryQueue)
    .set({ status: "delivered" })
    .where(eq(deliveryQueue.id, "dq-ghost-1"));
  const reapedAfter = await reapDrainedTombstones(db);
  expect(reapedAfter).toBe(1);
  const gone = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  expect(gone).toBeFalsy();
});
