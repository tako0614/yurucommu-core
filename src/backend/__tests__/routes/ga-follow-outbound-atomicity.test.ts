import { expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  actors,
  deliveryResolutions,
  follows,
} from "../../../db/index.ts";
import followRoutes from "../../routes/follow.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const REMOTE_ACTOR = "https://peer.example/ap/users/alice";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function insertActor(db: Database, username: string): Promise<string> {
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
    isPrivate: 1,
  });
  return apId;
}

function appAs(db: Database, actorApId: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", {
      ap_id: actorApId,
      preferred_username: actorApId.split("/").pop(),
    } as Actor);
    await next();
  });
  app.route("/", followRoutes);
  return app;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

async function rejectResolutionWrites(db: Database): Promise<void> {
  await db.run(sql`
    CREATE TRIGGER reject_follow_delivery_resolution
    BEFORE INSERT ON delivery_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'simulated resolution ledger outage');
    END
  `);
}

async function seedPendingRemoteFollow(
  db: Database,
  recipientApId: string,
): Promise<void> {
  await db.insert(follows).values({
    followerApId: REMOTE_ACTOR,
    followingApId: recipientApId,
    status: "pending",
    activityApId: null,
  });
}

async function outboundCount(db: Database, type: string): Promise<number> {
  return (
    await db
      .select()
      .from(activities)
      .where(
        and(eq(activities.type, type), eq(activities.direction, "outbound")),
      )
  ).length;
}

test("single remote Follow acceptance rolls back edge and counter when delivery intent cannot persist", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "single-accept");
  await seedPendingRemoteFollow(db, recipient);
  await rejectResolutionWrites(db);

  const response = await appAs(db, recipient).request(
    "/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    envFor(db),
  );

  expect(response.status).toBe(500);
  expect(
    (
      await db
        .select({ status: follows.status })
        .from(follows)
        .where(eq(follows.followerApId, REMOTE_ACTOR))
        .get()
    )?.status,
  ).toBe("pending");
  expect(
    (
      await db
        .select({ followerCount: actors.followerCount })
        .from(actors)
        .where(eq(actors.apId, recipient))
        .get()
    )?.followerCount,
  ).toBe(0);
  expect(await outboundCount(db, "Accept")).toBe(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(0);
});

test("creating a remote Follow rolls back its edge and Activity when delivery intent cannot persist", async () => {
  const db = await freshDb();
  const follower = await insertActor(db, "remote-follow");
  await db.insert(actorCache).values({
    apId: REMOTE_ACTOR,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${REMOTE_ACTOR}/inbox`,
    rawJson: JSON.stringify({
      id: REMOTE_ACTOR,
      type: "Person",
      inbox: `${REMOTE_ACTOR}/inbox`,
    }),
  });
  await rejectResolutionWrites(db);

  const response = await appAs(db, follower).request(
    "/",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_ap_id: REMOTE_ACTOR }),
    },
    envFor(db),
  );

  expect(response.status).toBe(500);
  expect(
    await db.select().from(follows).where(eq(follows.followerApId, follower)),
  ).toHaveLength(0);
  expect(await outboundCount(db, "Follow")).toBe(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(0);
});

test("remote Follow acceptance succeeds with a pending durable intent when Queue publication fails", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "queue-accept");
  await seedPendingRemoteFollow(db, recipient);
  const failingQueue = {
    async send() {
      throw new Error("simulated Queue outage");
    },
    async sendBatch() {
      throw new Error("simulated Queue outage");
    },
  };

  const response = await appAs(db, recipient).request(
    "/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    {
      ...envFor(db),
      DELIVERY_QUEUE: failingQueue,
      DELIVERY_DLQ: failingQueue,
    } as unknown as Env,
  );

  expect(response.status).toBe(200);
  expect(
    (
      await db
        .select({ status: follows.status })
        .from(follows)
        .where(eq(follows.followerApId, REMOTE_ACTOR))
        .get()
    )?.status,
  ).toBe("accepted");
  expect(await outboundCount(db, "Accept")).toBe(1);
  expect(await db.select().from(deliveryResolutions)).toEqual([
    expect.objectContaining({ status: "pending", attempts: 0 }),
  ]);
});

test("batch remote Follow acceptance reports the item failed without partially accepting it", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "batch-accept");
  await seedPendingRemoteFollow(db, recipient);
  await rejectResolutionWrites(db);

  const response = await appAs(db, recipient).request(
    "/accept/batch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_ids: [REMOTE_ACTOR] }),
    },
    envFor(db),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    accepted_count: 0,
    results: [
      {
        ap_id: REMOTE_ACTOR,
        success: false,
        error: "Internal error",
      },
    ],
  });
  expect(
    (
      await db
        .select({ status: follows.status })
        .from(follows)
        .where(eq(follows.followerApId, REMOTE_ACTOR))
        .get()
    )?.status,
  ).toBe("pending");
  expect(await outboundCount(db, "Accept")).toBe(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(0);
});

test("remote Follow rejection keeps the request pending when delivery intent cannot persist", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "reject");
  await seedPendingRemoteFollow(db, recipient);
  await rejectResolutionWrites(db);

  const response = await appAs(db, recipient).request(
    "/reject",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    envFor(db),
  );

  expect(response.status).toBe(500);
  expect(
    (
      await db
        .select({ status: follows.status })
        .from(follows)
        .where(eq(follows.followerApId, REMOTE_ACTOR))
        .get()
    )?.status,
  ).toBe("pending");
  expect(await outboundCount(db, "Reject")).toBe(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(0);
});

test("remote unfollow rolls back edge and counter when Undo delivery intent cannot persist", async () => {
  const db = await freshDb();
  const follower = await insertActor(db, "unfollow");
  await db
    .update(actors)
    .set({ followingCount: 1 })
    .where(eq(actors.apId, follower));
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: REMOTE_ACTOR,
    status: "accepted",
    activityApId: null,
  });
  await rejectResolutionWrites(db);

  const response = await appAs(db, follower).request(
    "/",
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_ap_id: REMOTE_ACTOR }),
    },
    envFor(db),
  );

  expect(response.status).toBe(500);
  expect(
    await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerApId, follower),
          eq(follows.followingApId, REMOTE_ACTOR),
        ),
      ),
  ).toHaveLength(1);
  expect(
    (
      await db
        .select({ followingCount: actors.followingCount })
        .from(actors)
        .where(eq(actors.apId, follower))
        .get()
    )?.followingCount,
  ).toBe(1);
  expect(await outboundCount(db, "Undo")).toBe(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(0);
});
