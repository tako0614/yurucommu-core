import { expect, test } from "bun:test";

import {
  activities,
  actors,
  communities,
  communityMembers,
  deliveryFanouts,
  deliveryResolutions,
  follows,
  inbox,
  insertMany,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import type { IQueueMessage, IQueueProducer } from "../../runtime/queue.ts";
import type {
  DeliveryFanoutFollowersMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";
import {
  enqueueFanoutToCommunity,
  enqueueFanoutToFollowers,
  handleDeliveryDlqBatch,
  MAX_AUTO_DLQ_REDRIVES,
} from "../../lib/delivery/queue.ts";
import {
  processFanoutCommunity,
  processFanoutFollowers,
} from "../../lib/delivery/queue-batching.ts";
import { enqueuePendingDeliveryFanoutJobs } from "../../lib/delivery/fanout-outbox.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const ACTIVITY_ID = `${APP_URL}/ap/activities/fanout-proof`;
const FOLLOWEE_ID = `${APP_URL}/ap/users/alice`;
const COMMUNITY_ID = `${APP_URL}/ap/groups/builders`;
const ANNOUNCE_ID = `${APP_URL}/ap/activities/community-announce`;

function queueHarness() {
  const sent: DeliveryQueueMessageV1[] = [];
  let fail = false;
  const queue: IQueueProducer<DeliveryQueueMessageV1> = {
    async send(body) {
      if (fail) throw new Error("simulated initial Queue outage");
      sent.push(body);
    },
    async sendBatch(messages) {
      if (fail) throw new Error("simulated initial Queue outage");
      sent.push(...messages.map((message) => message.body));
    },
  };
  return {
    queue,
    sent,
    setFail(value: boolean) {
      fail = value;
    },
  };
}

function envWith(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  queue: IQueueProducer<DeliveryQueueMessageV1>,
): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue as never,
  } as unknown as Env;
}

async function seedActivity(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
) {
  await db.insert(activities).values({
    apId: ACTIVITY_ID,
    type: "Create",
    actorApId: FOLLOWEE_ID,
    rawJson: JSON.stringify({ id: ACTIVITY_ID, type: "Create" }),
    direction: "outbound",
  });
}

test("a failed initial follower-fanout Queue RPC leaves a durable pending wakeup", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const harness = queueHarness();
  harness.setFail(true);
  const env = envWith(db, harness.queue);

  await expect(
    enqueueFanoutToFollowers(env, ACTIVITY_ID, FOLLOWEE_ID),
  ).rejects.toThrow("simulated initial Queue outage");
  expect(await db.select().from(deliveryFanouts).get()).toMatchObject({
    activityApId: ACTIVITY_ID,
    kind: "followers",
    targetApId: FOLLOWEE_ID,
    status: "pending",
  });

  harness.setFail(false);
  expect(await enqueuePendingDeliveryFanoutJobs(env)).toBe(1);
  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]).toMatchObject({
    type: "fanout_followers",
    activityId: ACTIVITY_ID,
    followeeApId: FOLLOWEE_ID,
  });
  expect((await db.select().from(deliveryFanouts).get())?.status).toBe(
    "published",
  );
});

test("community fanout persists the exact Announce relay intent", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const harness = queueHarness();
  const env = envWith(db, harness.queue);

  await enqueueFanoutToCommunity(env, ACTIVITY_ID, COMMUNITY_ID, ANNOUNCE_ID);

  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]).toMatchObject({
    type: "fanout_community",
    activityId: ACTIVITY_ID,
    communityApId: COMMUNITY_ID,
    announceActivityId: ANNOUNCE_ID,
  });
  expect(await db.select().from(deliveryFanouts).get()).toMatchObject({
    activityApId: ACTIVITY_ID,
    kind: "community",
    targetApId: COMMUNITY_ID,
    announceActivityApId: ANNOUNCE_ID,
    status: "published",
    publications: 1,
  });
});

test("Bun startup can replay a published fanout and final processing makes it terminal", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  await enqueueFanoutToFollowers(env, ACTIVITY_ID, FOLLOWEE_ID);
  harness.sent.length = 0;

  expect(
    await enqueuePendingDeliveryFanoutJobs(env, { includePublished: true }),
  ).toBe(1);
  expect(harness.sent).toHaveLength(1);
  expect(await db.select().from(deliveryFanouts).get()).toMatchObject({
    status: "published",
    publications: 2,
  });

  const body = harness.sent[0] as DeliveryFanoutFollowersMessageV1;
  const acknowledgements: string[] = [];
  const retries: number[] = [];
  const message: IQueueMessage<DeliveryQueueMessageV1> = {
    id: "fanout-proof",
    body,
    timestamp: new Date(),
    attempts: 1,
    ack: () => acknowledgements.push(body.type),
    retry: (options) => retries.push(options?.delaySeconds ?? 0),
  };

  await processFanoutFollowers(db, env, body, message);

  expect(acknowledgements).toEqual(["fanout_followers"]);
  expect(retries).toEqual([]);
  expect((await db.select().from(deliveryFanouts).get())?.status).toBe(
    "completed",
  );
  harness.sent.length = 0;
  expect(
    await enqueuePendingDeliveryFanoutJobs(env, { includePublished: true }),
  ).toBe(0);
  expect(harness.sent).toEqual([]);
});

test("a stale fanout wakeup for a deleted Activity is acknowledged without recreating work", async () => {
  const { db } = await createTestDb();
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  const body: DeliveryFanoutFollowersMessageV1 = {
    version: 1,
    type: "fanout_followers",
    activityId: ACTIVITY_ID,
    followeeApId: FOLLOWEE_ID,
    scheduledAt: new Date().toISOString(),
  };
  const acknowledgements: string[] = [];

  await processFanoutFollowers(db, env, body, {
    id: "deleted-activity-fanout",
    body,
    timestamp: new Date(),
    attempts: 1,
    ack: () => acknowledgements.push(body.type),
    retry: () => {
      throw new Error("deleted Activity must not retry");
    },
  });

  expect(acknowledgements).toEqual(["fanout_followers"]);
  expect(await db.select().from(deliveryFanouts)).toEqual([]);
  expect(harness.sent).toEqual([]);
});

test("a fanout that exhausts bounded Queue redrives becomes terminal", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  await enqueueFanoutToFollowers(env, ACTIVITY_ID, FOLLOWEE_ID);
  const body = {
    ...(harness.sent[0] as DeliveryFanoutFollowersMessageV1),
    autoDlqAttempt: MAX_AUTO_DLQ_REDRIVES,
  };
  const acknowledgements: string[] = [];

  await handleDeliveryDlqBatch(
    {
      messages: [
        {
          id: "fanout-exhausted",
          body,
          timestamp: new Date(),
          attempts: 1,
          ack: () => acknowledgements.push(body.type),
          retry: () => {
            throw new Error("terminal fanout must not retry the DLQ message");
          },
        },
      ],
      queue: "delivery-dlq",
      ackAll() {},
      retryAll() {},
    } as never,
    env,
  );

  expect(acknowledgements).toEqual(["fanout_followers"]);
  expect(await db.select().from(deliveryFanouts).get()).toMatchObject({
    status: "failed",
    lastError: `Queue delivery exhausted after ${MAX_AUTO_DLQ_REDRIVES} automatic redrives`,
  });
});

test("community fanout advances through bounded stage/cursor pages without a D1-wide insert", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(communities).values({
    apId: COMMUNITY_ID,
    preferredUsername: "builders",
    name: "Builders",
    inbox: `${COMMUNITY_ID}/inbox`,
    outbox: `${COMMUNITY_ID}/outbox`,
    followersUrl: `${COMMUNITY_ID}/followers`,
    publicKeyPem: "public",
    privateKeyPem: "private",
    createdBy: FOLLOWEE_ID,
  });
  const localActors = Array.from({ length: 201 }, (_, index) => {
    const username = `member-${index.toString().padStart(3, "0")}`;
    const apId = `${APP_URL}/ap/users/${username}`;
    return {
      apId,
      preferredUsername: username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "public",
      privateKeyPem: "private",
    };
  });
  await runBatch(
    db,
    insertMany(db, actors, localActors) as [D1Statement, ...D1Statement[]],
  );
  await runBatch(
    db,
    insertMany(
      db,
      communityMembers,
      localActors.map(({ apId }) => ({
        communityApId: COMMUNITY_ID,
        actorApId: apId,
      })),
    ) as [D1Statement, ...D1Statement[]],
  );

  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  await enqueueFanoutToCommunity(env, ACTIVITY_ID, COMMUNITY_ID);
  const stages: Array<string | undefined> = [];
  const acknowledgements: string[] = [];

  while (harness.sent.length > 0) {
    const body = harness.sent.shift();
    if (!body || body.type !== "fanout_community") continue;
    stages.push(body.stage);
    await processFanoutCommunity(db, env, body, {
      id: `community-stage-${stages.length}`,
      body,
      timestamp: new Date(),
      attempts: 1,
      ack: () => acknowledgements.push(body.type),
      retry: () => {
        throw new Error("bounded community fanout must not retry");
      },
    });
    if (stages.length > 8) throw new Error("community fanout did not converge");
  }

  expect(stages).toEqual([
    undefined,
    "local_members",
    "remote_members",
    "remote_members",
    "remote_followers",
  ]);
  expect(acknowledgements).toHaveLength(stages.length);
  expect(await db.select().from(inbox)).toHaveLength(201);
  expect((await db.select().from(deliveryFanouts).get())?.status).toBe(
    "completed",
  );
});

test("community remote followers continue past one full page without the old 20k terminal cap", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const remoteFollowers = Array.from({ length: 201 }, (_, index) => ({
    followerApId: `https://remote-${index
      .toString()
      .padStart(3, "0")}.example/users/member`,
    followingApId: COMMUNITY_ID,
    status: "accepted",
  }));
  await runBatch(
    db,
    insertMany(db, follows, remoteFollowers) as [D1Statement, ...D1Statement[]],
  );

  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  await enqueueFanoutToCommunity(env, ACTIVITY_ID, COMMUNITY_ID);
  const fanoutStages: Array<string | undefined> = [];

  while (true) {
    const nextIndex = harness.sent.findIndex(
      (body) => body.type === "fanout_community",
    );
    if (nextIndex < 0) break;
    const [body] = harness.sent.splice(nextIndex, 1);
    if (!body || body.type !== "fanout_community") continue;
    fanoutStages.push(body.stage);
    await processFanoutCommunity(db, env, body, {
      id: `remote-community-stage-${fanoutStages.length}`,
      body,
      timestamp: new Date(),
      attempts: 1,
      ack() {},
      retry() {
        throw new Error("remote community fanout must not retry");
      },
    });
    if (fanoutStages.length > 8) {
      throw new Error("remote community fanout did not converge");
    }
  }

  expect(fanoutStages).toEqual([
    undefined,
    "remote_members",
    "remote_followers",
    "remote_followers",
  ]);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(201);
  expect((await db.select().from(deliveryFanouts).get())?.status).toBe(
    "completed",
  );
});
