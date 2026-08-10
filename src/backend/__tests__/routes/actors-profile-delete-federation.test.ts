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
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  actors,
  deliveryFanouts,
  deliveryQueue,
  deliveryResolutions,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { enqueuePendingDeliveryFanoutJobs } from "../../lib/delivery/fanout-outbox.ts";

const APP_URL = "https://yurucommu.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
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

function envFor(
  db: Database,
  sent: Sent[],
  batched?: string[],
  options: { readonly failFanoutSend?: boolean } = {},
): Env {
  // Minimal queue stubs so enqueueFanoutToFollowers records its send instead
  // of silently no-op'ing (queueAvailable requires both bindings present).
  const DELIVERY_QUEUE = {
    send: (body: {
      type: string;
      activityId: string;
      followeeApId: string;
    }) => {
      if (options.failFanoutSend) {
        return Promise.reject(new Error("simulated fanout Queue outage"));
      }
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

test("PUT /me rolls back the profile and Activity when durable fanout persistence fails", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "atomic-profile");
  const sent: Sent[] = [];
  await db.run(sql`
    CREATE TRIGGER reject_profile_fanout
    BEFORE INSERT ON delivery_fanouts
    BEGIN
      SELECT RAISE(ABORT, 'simulated fanout ledger outage');
    END
  `);

  const res = await appWith(db, actor).fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Must Not Commit" }),
    }),
    envFor(db, sent),
  );

  expect(res.status).toBe(500);
  expect(
    (
      await db
        .select({ name: actors.name })
        .from(actors)
        .where(eq(actors.apId, actor.ap_id))
        .get()
    )?.name,
  ).toBe("Old Name");
  expect(await db.select().from(activities)).toHaveLength(0);
  expect(await db.select().from(deliveryFanouts)).toHaveLength(0);
  expect(sent).toHaveLength(0);
});

test("PUT /me keeps a pending durable fanout and recovers after Queue failure", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "profile-queue-retry");
  const sent: Sent[] = [];

  const res = await appWith(db, actor).fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ summary: "durable profile update" }),
    }),
    envFor(db, sent, undefined, { failFanoutSend: true }),
  );

  expect(res.status).toBe(200);
  expect(sent).toHaveLength(0);
  expect(
    await db
      .select({
        status: deliveryFanouts.status,
        publications: deliveryFanouts.publications,
      })
      .from(deliveryFanouts),
  ).toEqual([{ status: "pending", publications: 0 }]);

  const recovered: string[] = [];
  expect(
    await enqueuePendingDeliveryFanoutJobs(envFor(db, [], recovered)),
  ).toBe(1);
  expect(recovered).toEqual(["fanout_followers"]);
  expect(
    await db
      .select({
        status: deliveryFanouts.status,
        publications: deliveryFanouts.publications,
      })
      .from(deliveryFanouts),
  ).toEqual([{ status: "published", publications: 1 }]);
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

  // The actor row is TOMBSTONED, not hard-deleted: the snapshotted
  // deliver_endpoint jobs for the Delete(actor) must later sign with this
  // actor's private key, so the row (apId + signing material) is preserved and
  // `deletedAt` is stamped, while every piece of personal data is scrubbed. A
  // hard delete would destroy the signing key and the Delete could never be
  // delivered.
  const remaining = await db
    .select()
    .from(actors)
    .where(eq(actors.apId, actor.ap_id));
  expect(remaining.length).toBe(1);
  const tombstone = remaining[0];
  expect(tombstone.deletedAt).not.toBeNull();
  // Personal data is scrubbed.
  expect(tombstone.name).toBeNull();
  expect(tombstone.summary).toBeNull();
  expect(tombstone.iconUrl).toBeNull();
  expect(tombstone.headerUrl).toBeNull();
  expect(tombstone.takosUserId).toBeNull();
  expect(tombstone.postCount).toBe(0);
  // Signing material survives so the queued Delete jobs can be signed.
  expect(tombstone.privateKeyPem).toBe("priv");
  expect(tombstone.publicKeyPem).toBe("pub");
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

test("POST /me/delete durably snapshots known and unresolved followers without Queue bindings", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "queue-less");
  const knownFollower = "https://known.remote.test/users/follower";
  const unknownFollower = "https://unknown.remote.test/users/follower";
  await db.insert(follows).values([
    {
      followerApId: knownFollower,
      followingApId: actor.ap_id,
      status: "accepted",
    },
    {
      followerApId: unknownFollower,
      followingApId: actor.ap_id,
      status: "accepted",
    },
  ]);
  await db.insert(actorCache).values({
    apId: knownFollower,
    type: "Person",
    inbox: "https://known.remote.test/users/follower/inbox",
    sharedInbox: "https://known.remote.test/inbox",
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });
  const app = appWith(db, actor);

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
  expect(res.status).toBe(200);

  // Teardown erases the follower graph, so these durable rows are the only
  // remaining authority from which a later correctly configured runtime can
  // recover the remote Delete(actor) delivery.
  expect(
    await db
      .select()
      .from(follows)
      .where(eq(follows.followingApId, actor.ap_id)),
  ).toHaveLength(0);
  const deleteActivity = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Delete"))
    .get();
  expect(deleteActivity).toBeDefined();

  expect(
    await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.activityApId, deleteActivity!.apId)),
  ).toMatchObject([
    {
      inboxUrl: "https://known.remote.test/inbox",
      status: "pending",
    },
  ]);
  expect(
    await db
      .select()
      .from(deliveryResolutions)
      .where(eq(deliveryResolutions.activityApId, deleteActivity!.apId)),
  ).toMatchObject([
    {
      recipientActorApId: unknownFollower,
      status: "pending",
    },
  ]);
});

test("POST /me/delete keeps the complete durable snapshot when the Queue RPC fails", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "queue-failure");
  const knownFollower = "https://known.remote.test/users/rpc-failure";
  const unknownFollower = "https://unknown.remote.test/users/rpc-failure";
  await db.insert(follows).values([
    {
      followerApId: knownFollower,
      followingApId: actor.ap_id,
      status: "accepted",
    },
    {
      followerApId: unknownFollower,
      followingApId: actor.ap_id,
      status: "accepted",
    },
  ]);
  await db.insert(actorCache).values({
    apId: knownFollower,
    type: "Person",
    inbox: "https://known.remote.test/users/rpc-failure/inbox",
    sharedInbox: "https://known.remote.test/rpc-failure-inbox",
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });
  const app = appWith(db, actor);
  let sendAttempts = 0;
  const env = {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: {
      send: () => Promise.reject(new Error("Queue unavailable")),
      sendBatch: () => {
        sendAttempts += 1;
        return Promise.reject(new Error("Queue unavailable"));
      },
    },
    DELIVERY_DLQ: { send: () => Promise.resolve() },
  } as unknown as Env;

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    env,
  );
  expect(res.status).toBe(200);
  expect(sendAttempts).toBe(1);

  const deleteActivity = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Delete"))
    .get();
  expect(deleteActivity).toBeDefined();
  expect(
    await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.activityApId, deleteActivity!.apId)),
  ).toMatchObject([
    {
      inboxUrl: "https://known.remote.test/rpc-failure-inbox",
      status: "pending",
    },
  ]);
  expect(
    await db
      .select()
      .from(deliveryResolutions)
      .where(eq(deliveryResolutions.activityApId, deleteActivity!.apId)),
  ).toMatchObject([
    {
      recipientActorApId: unknownFollower,
      status: "pending",
    },
  ]);
  expect(
    await db
      .select()
      .from(follows)
      .where(eq(follows.followingApId, actor.ap_id)),
  ).toHaveLength(0);
});

test("POST /me/delete keeps the actor and follower graph when the durable snapshot write fails", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "snapshot-failure");
  const remoteFollower = "https://unknown.remote.test/users/snapshot-failure";
  await db.insert(follows).values({
    followerApId: remoteFollower,
    followingApId: actor.ap_id,
    status: "accepted",
  });
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_account_delete_resolution
    BEFORE INSERT ON delivery_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'simulated account Delete snapshot failure');
    END
  `),
  );
  const app = appWith(db, actor);
  const env = { APP_URL, DB_INSTANCE: db } as Env;

  const failed = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    env,
  );
  expect(failed.status).toBe(500);
  expect(
    await db
      .select()
      .from(follows)
      .where(eq(follows.followingApId, actor.ap_id)),
  ).toHaveLength(1);
  expect(
    await db
      .select({ deletedAt: actors.deletedAt })
      .from(actors)
      .where(eq(actors.apId, actor.ap_id))
      .get(),
  ).toMatchObject({ deletedAt: null });

  // The same authenticated actor can retry after D1 recovers. The partial
  // first-attempt Delete activity is replaced by the successful durable
  // snapshot before final tombstoning.
  await db.run(sql`DROP TRIGGER reject_account_delete_resolution`);
  const retried = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    env,
  );
  expect(retried.status).toBe(200);
  expect(
    await db
      .select()
      .from(follows)
      .where(eq(follows.followingApId, actor.ap_id)),
  ).toHaveLength(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(1);
  expect(
    await db.select().from(activities).where(eq(activities.type, "Delete")),
  ).toHaveLength(1);
});
