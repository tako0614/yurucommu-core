import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { stub } from "#test/mock";

import {
  activities,
  actorCache,
  deliveryEndpointRecipients,
  deliveryQueue,
  deliveryResolutions,
  remoteActorTombstones,
} from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import type { IQueueMessage, IQueueProducer } from "../../runtime/queue.ts";
import {
  createTestDb,
  readMigration,
  stripPragmasNotHonouredByD1,
} from "../helpers/d1-semantics.ts";
import {
  enqueueDeliveryToActor,
  enqueuePendingDeliveryEndpointJobs,
  upsertDeliveryJob,
} from "../../lib/delivery/queue.ts";
import {
  claimDeliveryResolutionJob,
  enqueueDeliveryResolutionJobs,
  enqueuePendingDeliveryResolutionJobs,
  persistDeliveryResolutionJobs,
  retryDeliveryResolutionJob,
} from "../../lib/delivery/resolution-outbox.ts";
import { processResolveActor } from "../../lib/delivery/queue-batching.ts";
import type { DeliveryQueueMessageV1 } from "../../lib/delivery/types.ts";

const APP_URL = "https://yuru.test";
const ACTIVITY_ID = `${APP_URL}/ap/activities/create-1`;
const RECIPIENT_ID = "https://remote.example/users/bob";
const ENDPOINT = "https://remote.example/inbox";

function queueHarness() {
  const sent: DeliveryQueueMessageV1[] = [];
  let fail = false;
  const queue: IQueueProducer<DeliveryQueueMessageV1> = {
    async send(body) {
      if (fail) throw new Error("simulated queue outage");
      sent.push(body);
    },
    async sendBatch(messages) {
      if (fail) throw new Error("simulated queue outage");
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
    actorApId: `${APP_URL}/ap/users/alice`,
    objectApId: `${APP_URL}/ap/objects/note-1`,
    rawJson: JSON.stringify({
      id: ACTIVITY_ID,
      type: "Create",
      actor: `${APP_URL}/ap/users/alice`,
      object: `${APP_URL}/ap/objects/note-1`,
    }),
    direction: "outbound",
  });
}

test("a failed first resolve_actor Queue RPC leaves a durable pending row that a sweep recovers", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  harness.setFail(true);

  await expect(
    enqueueDeliveryToActor(env, ACTIVITY_ID, RECIPIENT_ID),
  ).rejects.toThrow("simulated queue outage");

  const retained = await db.select().from(deliveryResolutions).get();
  expect(retained).toMatchObject({
    activityApId: ACTIVITY_ID,
    recipientActorApId: RECIPIENT_ID,
    status: "pending",
    attempts: 0,
  });

  harness.setFail(false);
  expect(await enqueuePendingDeliveryResolutionJobs(env)).toBe(1);
  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]).toMatchObject({
    type: "resolve_actor",
    activityId: ACTIVITY_ID,
    recipientActorApId: RECIPIENT_ID,
  });
  expect((await db.select().from(deliveryResolutions).get())?.status).toBe(
    "queued",
  );
});

test("resolution completion creates the durable endpoint job before acknowledging the outbox row", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(actorCache).values({
    apId: RECIPIENT_ID,
    type: "Person",
    preferredUsername: "bob",
    inbox: ENDPOINT,
    sharedInbox: ENDPOINT,
    rawJson: JSON.stringify({
      id: RECIPIENT_ID,
      type: "Person",
      inbox: ENDPOINT,
    }),
    lastFetchedAt: new Date().toISOString(),
  });
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  await enqueuePendingDeliveryResolutionJobs(env);
  harness.sent.length = 0;
  const acked: boolean[] = [];
  const retries: number[] = [];
  const body: DeliveryQueueMessageV1 = {
    version: 1,
    type: "resolve_actor",
    activityId: ACTIVITY_ID,
    recipientActorApId: RECIPIENT_ID,
    scheduledAt: new Date().toISOString(),
  };
  const message: IQueueMessage<DeliveryQueueMessageV1> = {
    id: "resolve-1",
    body,
    timestamp: new Date(),
    attempts: 1,
    ack: () => acked.push(true),
    retry: (options) => retries.push(options?.delaySeconds ?? 0),
  };

  await processResolveActor(db, env, body, message);

  expect(acked).toEqual([true]);
  expect(retries).toEqual([]);
  expect((await db.select().from(deliveryResolutions).get())?.status).toBe(
    "resolved",
  );
  expect(await db.select().from(deliveryQueue).get()).toMatchObject({
    activityApId: ACTIVITY_ID,
    inboxUrl: ENDPOINT,
    status: "pending",
    recipientAttributionComplete: 1,
  });
  expect(
    await db.select().from(deliveryEndpointRecipients).get(),
  ).toMatchObject({
    recipientActorApId: RECIPIENT_ID,
  });
  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]?.type).toBe("deliver_endpoint");
});

test("a pre-existing actor tombstone fences new resolution materialization", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(remoteActorTombstones).values({
    actorApId: RECIPIENT_ID,
    deleteActivityApId: `${RECIPIENT_ID}#delete`,
  });
  const harness = queueHarness();

  expect(
    await enqueueDeliveryResolutionJobs(db, harness.queue, [
      { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
    ]),
  ).toBe(0);
  expect(await db.select().from(deliveryResolutions)).toEqual([]);
  expect(harness.sent).toEqual([]);
});

test("the tombstone fence preserves unrelated recipients in the same insert", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(remoteActorTombstones).values({
    actorApId: RECIPIENT_ID,
    deleteActivityApId: `${RECIPIENT_ID}#delete`,
  });
  const otherRecipient = "https://other.example/users/carol";
  const harness = queueHarness();

  expect(
    await enqueueDeliveryResolutionJobs(db, harness.queue, [
      { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
      { activityId: ACTIVITY_ID, recipientActorApId: otherRecipient },
    ]),
  ).toBe(1);
  expect(await db.select().from(deliveryResolutions)).toEqual([
    expect.objectContaining({ recipientActorApId: otherRecipient }),
  ]);
  expect(harness.sent).toEqual([
    expect.objectContaining({
      type: "resolve_actor",
      recipientActorApId: otherRecipient,
    }),
  ]);
});

test("endpoint materialization drops a tombstoned recipient but keeps its live co-recipient", async () => {
  const { db } = await createTestDb();
  await db.insert(remoteActorTombstones).values({
    actorApId: RECIPIENT_ID,
    deleteActivityApId: `${RECIPIENT_ID}#delete`,
  });
  const endpointJobId = "endpoint-attribution-race";

  expect(
    await upsertDeliveryJob(db, endpointJobId, ACTIVITY_ID, ENDPOINT, [
      RECIPIENT_ID,
    ]),
  ).toBe(false);
  expect(await db.select().from(deliveryQueue)).toEqual([]);
  expect(await db.select().from(deliveryEndpointRecipients)).toEqual([]);

  const otherRecipient = "https://other.example/users/carol";
  expect(
    await upsertDeliveryJob(db, endpointJobId, ACTIVITY_ID, ENDPOINT, [
      RECIPIENT_ID,
      otherRecipient,
    ]),
  ).toBe(true);
  expect(await db.select().from(deliveryQueue).get()).toMatchObject({
    id: endpointJobId,
    recipientAttributionComplete: 1,
  });
  expect(await db.select().from(deliveryEndpointRecipients)).toEqual([
    expect.objectContaining({ recipientActorApId: otherRecipient }),
  ]);
});

test("migration 0028 removes resolution rows written after the tombstone migration", async () => {
  const { db, client } = await createTestDb({
    through: "0027_remote_actor_tombstones.sql",
  });
  await seedActivity(db);
  await db.insert(remoteActorTombstones).values({
    actorApId: RECIPIENT_ID,
    deleteActivityApId: `${RECIPIENT_ID}#delete`,
  });
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(1);

  await client.executeMultiple(
    stripPragmasNotHonouredByD1(
      await readMigration("0028_remote_actor_delivery_fence.sql"),
    ),
  );

  expect(await db.select().from(deliveryResolutions)).toEqual([]);
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  expect(await db.select().from(deliveryResolutions)).toEqual([]);
});

test("a tombstoned recipient is discarded before endpoint materialization", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(actorCache).values({
    apId: RECIPIENT_ID,
    type: "Person",
    preferredUsername: "bob",
    inbox: ENDPOINT,
    sharedInbox: ENDPOINT,
    rawJson: JSON.stringify({
      id: RECIPIENT_ID,
      type: "Person",
      inbox: ENDPOINT,
    }),
    lastFetchedAt: new Date().toISOString(),
  });
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  await db.update(deliveryResolutions).set({ status: "queued" });
  await db.insert(remoteActorTombstones).values({
    actorApId: RECIPIENT_ID,
    deleteActivityApId: `${RECIPIENT_ID}#delete`,
  });
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  const acked: boolean[] = [];
  const retries: number[] = [];
  const body: DeliveryQueueMessageV1 = {
    version: 1,
    type: "resolve_actor",
    activityId: ACTIVITY_ID,
    recipientActorApId: RECIPIENT_ID,
    scheduledAt: new Date().toISOString(),
  };

  await processResolveActor(db, env, body, {
    id: "resolve-tombstoned",
    body,
    timestamp: new Date(),
    attempts: 1,
    ack: () => acked.push(true),
    retry: (options) => retries.push(options?.delaySeconds ?? 0),
  });

  expect(acked).toEqual([true]);
  expect(retries).toEqual([]);
  expect(harness.sent).toEqual([]);
  expect(await db.select().from(deliveryResolutions).get()).toMatchObject({
    status: "discarded",
    attempts: 0,
    processingToken: null,
    lastError: "recipient_tombstoned",
  });
  expect(await db.select().from(deliveryQueue).get()).toBeUndefined();
});

test("resolution defers without spending its remote-attempt budget when blocklist authority is unavailable", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(actorCache).values({
    apId: RECIPIENT_ID,
    type: "Person",
    preferredUsername: "bob",
    inbox: ENDPOINT,
    sharedInbox: ENDPOINT,
    rawJson: JSON.stringify({
      id: RECIPIENT_ID,
      type: "Person",
      inbox: ENDPOINT,
    }),
    lastFetchedAt: new Date().toISOString(),
  });
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  await db.update(deliveryResolutions).set({ status: "queued" });
  const actorLookupStub = stub(db.query.blockedActors, "findFirst", () =>
    Promise.reject(new Error("simulated blocklist outage")),
  );
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  const acked: boolean[] = [];
  const retries: number[] = [];
  const body: DeliveryQueueMessageV1 = {
    version: 1,
    type: "resolve_actor",
    activityId: ACTIVITY_ID,
    recipientActorApId: RECIPIENT_ID,
    scheduledAt: new Date().toISOString(),
  };

  try {
    await processResolveActor(db, env, body, {
      id: "resolve-blocklist-outage",
      body,
      timestamp: new Date(),
      attempts: 1,
      ack: () => acked.push(true),
      retry: (options) => retries.push(options?.delaySeconds ?? 0),
    });
  } finally {
    actorLookupStub.restore();
  }

  expect(acked).toEqual([]);
  expect(retries).toEqual([60]);
  expect(harness.sent).toEqual([]);
  expect(await db.select().from(deliveryResolutions).get()).toMatchObject({
    status: "retry_wait",
    attempts: 0,
    processingToken: null,
    lastError: "simulated blocklist outage",
  });
  expect(await db.select().from(deliveryQueue).get()).toBeUndefined();
});

test("an actor document without a usable inbox terminates the durable row", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  const recipientActorApId = "http://127.0.0.1/users/unresolvable";
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId },
  ]);
  await db
    .update(deliveryResolutions)
    .set({ status: "queued", attempts: 7 })
    .where(eq(deliveryResolutions.activityApId, ACTIVITY_ID));
  const harness = queueHarness();
  const env = envWith(db, harness.queue);
  const acked: boolean[] = [];
  const retries: number[] = [];
  const body: DeliveryQueueMessageV1 = {
    version: 1,
    type: "resolve_actor",
    activityId: ACTIVITY_ID,
    recipientActorApId,
    scheduledAt: new Date().toISOString(),
  };

  await processResolveActor(db, env, body, {
    id: "resolve-terminal",
    body,
    timestamp: new Date(),
    attempts: 1,
    ack: () => acked.push(true),
    retry: (options) => retries.push(options?.delaySeconds ?? 0),
  });

  expect(acked).toEqual([true]);
  expect(retries).toEqual([]);
  expect(await db.select().from(deliveryResolutions).get()).toMatchObject({
    status: "discarded",
    attempts: 7,
    processingToken: null,
    lastError: "endpoint_unresolved",
  });
  expect(await db.select().from(deliveryQueue).get()).toBeUndefined();
});

test("the durable actor-resolution failure budget becomes terminal at attempt eight", async () => {
  const { db } = await createTestDb();
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  await db.update(deliveryResolutions).set({ attempts: 7 });
  const claim = await claimDeliveryResolutionJob(db, ACTIVITY_ID, RECIPIENT_ID);
  if (claim.state !== "claimed") throw new Error("expected claim");

  expect(
    await retryDeliveryResolutionJob(
      db,
      claim,
      new Error("simulated remote outage"),
    ),
  ).toEqual({ owned: true, terminal: true });
  expect(await db.select().from(deliveryResolutions).get()).toMatchObject({
    status: "failed",
    attempts: 8,
    processingToken: null,
    lastError: "simulated remote outage",
  });
});

test("the shared endpoint sweep recovers a durable delivery job whose first Queue RPC was lost", async () => {
  const { db } = await createTestDb();
  await seedActivity(db);
  await db.insert(deliveryQueue).values({
    id: "endpoint-job-1",
    activityApId: ACTIVITY_ID,
    inboxUrl: ENDPOINT,
    status: "pending",
    nextAttemptAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
  });
  const harness = queueHarness();
  const env = envWith(db, harness.queue);

  expect(await enqueuePendingDeliveryEndpointJobs(env)).toBe(1);
  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]).toMatchObject({
    type: "deliver_endpoint",
    jobId: "endpoint-job-1",
  });

  const row = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, "endpoint-job-1"))
    .get();
  expect(row?.status).toBe("pending");
});

test("endpoint invalidation reopens a previously resolved actor-resolution row", async () => {
  const { db } = await createTestDb();
  const harness = queueHarness();
  await persistDeliveryResolutionJobs(db, [
    { activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID },
  ]);
  await db.update(deliveryResolutions).set({
    status: "resolved",
    attempts: 3,
    lastError: "old endpoint",
    resolvedAt: new Date().toISOString(),
  });

  expect(
    await enqueueDeliveryResolutionJobs(
      db,
      harness.queue,
      [{ activityId: ACTIVITY_ID, recipientActorApId: RECIPIENT_ID }],
      { reopenTerminal: true },
    ),
  ).toBe(1);
  expect(harness.sent).toHaveLength(1);
  expect(await db.select().from(deliveryResolutions).get()).toMatchObject({
    status: "queued",
    attempts: 0,
    lastError: null,
    resolvedAt: null,
  });
});

test("a full follower page persists and enqueues below D1 and Queue batch limits", async () => {
  const { db } = await createTestDb();
  const harness = queueHarness();
  const intents = Array.from({ length: 200 }, (_, index) => ({
    activityId: ACTIVITY_ID,
    recipientActorApId: `https://remote-${index}.example/users/follower`,
  }));

  expect(await enqueueDeliveryResolutionJobs(db, harness.queue, intents)).toBe(
    200,
  );
  expect(await db.select().from(deliveryResolutions)).toHaveLength(200);
  expect(harness.sent).toHaveLength(200);
});

test("a full shared-endpoint group persists recipient attribution below D1 limits", async () => {
  const { db } = await createTestDb();
  const recipients = Array.from(
    { length: 200 },
    (_, index) => `https://shared.example/users/follower-${index}`,
  );

  expect(
    await upsertDeliveryJob(
      db,
      "full-attributed-endpoint-job",
      ACTIVITY_ID,
      "https://shared.example/inbox",
      recipients,
    ),
  ).toBe(true);
  expect(await db.select().from(deliveryEndpointRecipients)).toHaveLength(200);
  expect(await db.select().from(deliveryQueue).get()).toMatchObject({
    id: "full-attributed-endpoint-job",
    recipientAttributionComplete: 1,
  });
});
