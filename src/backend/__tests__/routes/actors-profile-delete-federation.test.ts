/**
 * Regression coverage for ACTORS-FED GA fixes:
 *
 *  - #8 PUT /me must federate an Update(Person) to followers after a
 *    federated-visible profile field changes (name / summary / icon / header /
 *    is_private), so remote servers do not see a stale Person.
 *  - #9 POST /me/delete must federate a Delete(actor) BEFORE local teardown,
 *    persisting the activity (preserved through teardown) and enqueuing
 *    fan-out to followers while the follower graph still exists.
 */

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  actors,
  deliveryQueue,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";

const APP_URL = "https://yurucommu.test";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
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

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<Actor> {
  const apId = localApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name: "Old Name",
    summary: "old summary",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: "Old Name",
    summary: "old summary",
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

type Sent = { activityId: string; followeeApId: string; type: string };

function envFor(db: Database, sent: Sent[], batched?: string[]): Env {
  // Minimal queue stubs so enqueueFanoutToFollowers records its send instead
  // of silently no-op'ing (queueAvailable requires both bindings present).
  const DELIVERY_QUEUE = {
    send: (body: {
      type: string;
      activityId: string;
      followeeApId: string;
    }) => {
      sent.push({
        activityId: body.activityId,
        followeeApId: body.followeeApId,
        type: body.type,
      });
      return Promise.resolve();
    },
    // The synchronous follower snapshot (account deletion) dispatches
    // deliver_endpoint / resolve_actor jobs via sendBatch, not send.
    sendBatch: (requests: Array<{ body: { type: string } }>) => {
      if (batched) {
        for (const r of requests) batched.push(r.body.type);
      }
      return Promise.resolve();
    },
  };
  const DELIVERY_DLQ = { send: () => Promise.resolve() };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE,
    DELIVERY_DLQ,
  } as unknown as Env;
}

function appWith(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", actorsRoute);
  return app;
}

test("PUT /me federates Update(Person) with the post-update profile", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "alice");
  const sent: Sent[] = [];
  const app = appWith(db, actor);

  const res = await app.fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "New Name", is_private: true }),
    }),
    envFor(db, sent),
  );
  expect(res.status).toBe(200);

  const updates = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Update"));
  expect(updates.length).toBe(1);
  const row = updates[0];
  expect(row.actorApId).toBe(actor.ap_id);
  expect(row.direction).toBe("outbound");

  const doc = JSON.parse(row.rawJson) as {
    type: string;
    actor: string;
    object: {
      id: string;
      name: string;
      summary: string;
      discoverable: boolean;
      manuallyApprovesFollowers: boolean;
    };
  };
  expect(doc.type).toBe("Update");
  expect(doc.actor).toBe(actor.ap_id);
  // Object carries the POST-update values, not the stale snapshot.
  expect(doc.object.id).toBe(actor.ap_id);
  expect(doc.object.name).toBe("New Name");
  expect(doc.object.summary).toBe("old summary");
  expect(doc.object.discoverable).toBe(false);
  expect(doc.object.manuallyApprovesFollowers).toBe(true);

  // Fan-out to followers was enqueued referencing this activity.
  expect(sent).toEqual([
    {
      activityId: row.apId,
      followeeApId: actor.ap_id,
      type: "fanout_followers",
    },
  ]);
});

test("PUT /me with no fields does not federate", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "carol");
  const sent: Sent[] = [];
  const app = appWith(db, actor);

  const res = await app.fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    envFor(db, sent),
  );
  expect(res.status).toBe(400);
  expect(sent.length).toBe(0);
  const updates = await db.select().from(activities);
  expect(updates.length).toBe(0);
});

test("POST /me/delete snapshots follower inboxes into delivery jobs before teardown", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "bob");
  const remoteFollower = "https://remote.test/users/dave";
  await db.insert(follows).values({
    followerApId: remoteFollower,
    followingApId: actor.ap_id,
    status: "accepted",
  });
  // Fresh actor_cache row so the synchronous snapshot resolves the follower's
  // endpoint immediately (deliver_endpoint) rather than deferring to
  // resolve_actor.
  await db.insert(actorCache).values({
    apId: remoteFollower,
    type: "Person",
    inbox: "https://remote.test/users/dave/inbox",
    sharedInbox: "https://remote.test/inbox",
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });
  const sent: Sent[] = [];
  const batched: string[] = [];
  const app = appWith(db, actor);

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db, sent, batched),
  );
  expect(res.status).toBe(200);

  // Local actor row is gone (hard delete) and so are the follows rows.
  const remaining = await db
    .select()
    .from(actors)
    .where(eq(actors.apId, actor.ap_id));
  expect(remaining.length).toBe(0);
  const remainingFollows = await db
    .select()
    .from(follows)
    .where(eq(follows.followingApId, actor.ap_id));
  expect(remainingFollows.length).toBe(0);

  // The Delete activity survives teardown so the async delivery consumer can
  // still read its rawJson.
  const deletes = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Delete"));
  expect(deletes.length).toBe(1);
  const row = deletes[0];
  const doc = JSON.parse(row.rawJson) as {
    type: string;
    actor: string;
    object: string;
  };
  expect(doc.type).toBe("Delete");
  expect(doc.actor).toBe(actor.ap_id);
  expect(doc.object).toBe(actor.ap_id);

  // The race fix: a delivery job for the Delete activity was persisted against
  // the follower's shared inbox while the follows row still existed. The async
  // fanout_followers message is NOT used here (it would read an empty graph
  // post-teardown), so no fanout_followers send was recorded.
  expect(sent).toEqual([]);
  expect(batched).toContain("deliver_endpoint");

  const jobs = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.activityApId, row.apId));
  expect(jobs.length).toBe(1);
  expect(jobs[0].inboxUrl).toBe("https://remote.test/inbox");
});
