import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  activities,
  communities,
  deliveryQueue,
  follows,
} from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import type { DeliveryQueueMessageV1 } from "../../lib/delivery/types.ts";
import { persistAndFanoutToCommunity } from "../../routes/posts/queries.ts";
import { handleDeliveryQueueBatch } from "../../lib/delivery/queue.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertCommunity(
  db: Database,
  name: string,
  visibility: "public" | "private" = "public",
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${name}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: name,
    name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility,
    joinPolicy: "open",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: `${APP_URL}/ap/users/owner`,
  });
  return apId;
}

function envFor(db: Database, sent: DeliveryQueueMessageV1[]): Env {
  const queue = {
    async send(body: DeliveryQueueMessageV1) {
      sent.push(body);
    },
    async sendBatch(reqs: Array<{ body: DeliveryQueueMessageV1 }>) {
      for (const r of reqs) sent.push(r.body);
    },
  };
  const dlq = {
    async send(_b: unknown) {},
    async sendBatch(_r: unknown) {},
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: dlq,
  } as unknown as Env;
}

async function drainQueue(
  env: Env,
  bodies: DeliveryQueueMessageV1[],
): Promise<void> {
  const messages = bodies.map((body) => ({
    id: Math.random().toString(36),
    timestamp: new Date(),
    body,
    attempts: 1,
    ack() {},
    retry() {},
  }));
  await handleDeliveryQueueBatch(
    { messages, queue: "delivery", ackAll() {}, retryAll() {} } as never,
    env,
  );
}

test("a community Create emits a group Announce + carries it in the fanout", async () => {
  const db = await freshDb();
  const communityApId = await insertCommunity(db, "club");
  const noteId = `${APP_URL}/ap/objects/note-1`;
  const sent: DeliveryQueueMessageV1[] = [];

  const create = {
    id: `${APP_URL}/ap/activities/create-1`,
    type: "Create",
    actor: `${APP_URL}/ap/users/owner`,
  };
  await persistAndFanoutToCommunity(
    db,
    envFor(db, sent),
    create,
    noteId,
    communityApId,
  );

  // The group's Announce is persisted (signed by + attributed to the community,
  // so it also surfaces in the community outbox, which keys on actorApId).
  const announce = await db.query.activities.findFirst({
    where: and(
      eq(activities.type, "Announce"),
      eq(activities.actorApId, communityApId),
      eq(activities.objectApId, noteId),
    ),
  });
  expect(announce).toBeTruthy();
  expect(announce?.direction).toEqual("outbound");
  const body = JSON.parse(announce!.rawJson) as {
    to: string[];
    cc: string[];
    object: string;
  };
  expect(body.to).toContain(`${communityApId}/followers`);
  expect(body.cc).toContain("https://www.w3.org/ns/activitystreams#Public");
  expect(body.object).toEqual(noteId);

  // The fanout message carries the Announce id (remote followers receive it).
  const fanout = sent.find((m) => m.type === "fanout_community") as
    { announceActivityId?: string } | undefined;
  expect(fanout?.announceActivityId).toEqual(announce!.apId);
});

test("a community Update/Delete relays directly (no Announce, no announceActivityId)", async () => {
  const db = await freshDb();
  const communityApId = await insertCommunity(db, "club");
  const noteId = `${APP_URL}/ap/objects/note-2`;
  const sent: DeliveryQueueMessageV1[] = [];

  await persistAndFanoutToCommunity(
    db,
    envFor(db, sent),
    {
      id: `${APP_URL}/ap/activities/update-1`,
      type: "Update",
      actor: `${APP_URL}/ap/users/owner`,
    },
    noteId,
    communityApId,
  );

  const announce = await db.query.activities.findFirst({
    where: and(
      eq(activities.type, "Announce"),
      eq(activities.actorApId, communityApId),
    ),
  });
  expect(announce).toBeUndefined();

  const fanout = sent.find((m) => m.type === "fanout_community") as
    { announceActivityId?: string } | undefined;
  expect(fanout?.announceActivityId).toBeUndefined();
});

test("the group's Announce (not the raw Create) is delivered to a REMOTE follower", async () => {
  const db = await freshDb();
  const communityApId = await insertCommunity(db, "club");
  const noteId = `${APP_URL}/ap/objects/note-remote`;
  const remoteFollower = "https://remote.example/users/bob";

  // A remote server has followed the community Group (Slice 2) and is cached
  // with an inbox so the fanout can plan an endpoint for it.
  await db.insert(follows).values({
    followerApId: remoteFollower,
    followingApId: communityApId,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  await db.insert(actorCache).values({
    apId: remoteFollower,
    inbox: "https://remote.example/users/bob/inbox",
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

  const sent: DeliveryQueueMessageV1[] = [];
  const env = envFor(db, sent);
  await persistAndFanoutToCommunity(
    db,
    env,
    {
      id: `${APP_URL}/ap/activities/create-remote`,
      type: "Create",
      actor: `${APP_URL}/ap/users/owner`,
    },
    noteId,
    communityApId,
  );

  const announce = await db.query.activities.findFirst({
    where: and(
      eq(activities.type, "Announce"),
      eq(activities.actorApId, communityApId),
    ),
  });
  expect(announce).toBeTruthy();

  // Drain the captured fanout through the real handler; a delivery job for the
  // remote follower's inbox must reference the ANNOUNCE, not the raw Create.
  await drainQueue(env, [...sent]);

  const jobs = await db
    .select({ activityApId: deliveryQueue.activityApId })
    .from(deliveryQueue)
    .all();
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs.every((j) => j.activityApId === announce!.apId)).toBe(true);
  expect(
    jobs.some(
      (j) => j.activityApId === `${APP_URL}/ap/activities/create-remote`,
    ),
  ).toBe(false);
});

test("a PRIVATE community Create emits NO Announce (not federated as a Group)", async () => {
  const db = await freshDb();
  const communityApId = await insertCommunity(db, "secret", "private");
  const sent: DeliveryQueueMessageV1[] = [];

  await persistAndFanoutToCommunity(
    db,
    envFor(db, sent),
    {
      id: `${APP_URL}/ap/activities/create-priv`,
      type: "Create",
      actor: `${APP_URL}/ap/users/owner`,
    },
    `${APP_URL}/ap/objects/note-priv`,
    communityApId,
  );

  const announce = await db.query.activities.findFirst({
    where: and(
      eq(activities.type, "Announce"),
      eq(activities.actorApId, communityApId),
    ),
  });
  expect(announce).toBeUndefined();

  const fanout = sent.find((m) => m.type === "fanout_community") as
    { announceActivityId?: string } | undefined;
  expect(fanout?.announceActivityId).toBeUndefined();
});
