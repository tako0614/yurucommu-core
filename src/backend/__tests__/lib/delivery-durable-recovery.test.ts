import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { activities, actors, deliveryQueue } from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import {
  enqueuePendingDeliveryEndpointJobs,
  type Bulkhead,
} from "../../lib/delivery/queue.ts";
import { processReconcileJob } from "../../lib/delivery/queue-batching.ts";
import { processDeliverEndpoint } from "../../lib/delivery/queue-delivery.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryDeliverEndpointMessageV1,
  DeliveryQueueMessageV1,
  DeliveryReconcileJobMessageV1,
} from "../../lib/delivery/types.ts";
import type { Env } from "../../types.ts";
import type { IQueueMessage } from "../../runtime/queue.ts";

const APP_URL = "https://yuru.test";
const SENDER = `${APP_URL}/ap/users/alice`;
const ACTIVITY_ID = `${APP_URL}/ap/activities/durable-recovery`;
const ENDPOINT = "https://remote.example/inbox";
const JOB_ID = "durable-recovery-job";
const ISO = "2026-01-01T00:00:00.000Z";

function queueHarness(
  db: Database,
  options: { failDlqOnce?: boolean; acceptThenDropDlq?: boolean } = {},
) {
  const sent: Array<DeliveryQueueMessageV1 | DeliveryDlqMessageV1> = [];
  let shouldFailDlq = options.failDlqOnce ?? false;
  let shouldDropDlq = options.acceptThenDropDlq ?? false;
  const queue = {
    send: async (body: DeliveryQueueMessageV1 | DeliveryDlqMessageV1) => {
      if (body.type === "dlq" && shouldFailDlq) {
        shouldFailDlq = false;
        throw new Error("simulated DLQ outage");
      }
      if (body.type === "dlq" && shouldDropDlq) {
        shouldDropDlq = false;
        return;
      }
      sent.push(body);
    },
    sendBatch: async (messages: { body: DeliveryQueueMessageV1 }[]) => {
      for (const message of messages) sent.push(message.body);
    },
  };
  let acknowledgements = 0;
  let retries = 0;
  const message = {
    id: "delivery-message",
    body: {
      version: 1,
      type: "deliver_endpoint",
      jobId: JOB_ID,
      scheduledAt: ISO,
    },
    timestamp: new Date(ISO),
    attempts: 1,
    ack: () => {
      acknowledgements += 1;
    },
    retry: () => {
      retries += 1;
    },
  } as unknown as IQueueMessage<DeliveryQueueMessageV1>;
  return {
    sent,
    message,
    get acknowledgements() {
      return acknowledgements;
    },
    get retries() {
      return retries;
    },
    env: {
      APP_URL,
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as unknown as Env,
  };
}

async function seedDeadLetter(
  db: Database,
  values: {
    reconcileAttempt?: number;
    dlqPending?: number;
    nextAttemptAt?: string;
  } = {},
): Promise<void> {
  await db.insert(deliveryQueue).values({
    id: JOB_ID,
    activityApId: ACTIVITY_ID,
    inboxUrl: ENDPOINT,
    status: "dead_letter",
    attempts: 8,
    reconcileAttempt: values.reconcileAttempt ?? 0,
    dlqPending: values.dlqPending ?? 1,
    nextAttemptAt: values.nextAttemptAt ?? ISO,
    createdAt: ISO,
  });
}

function reconcileMessage(
  reconcileAttempt: number,
): DeliveryReconcileJobMessageV1 {
  return {
    version: 1,
    type: "reconcile_job",
    jobId: JOB_ID,
    reconcileAttempt,
    scheduledAt: ISO,
  };
}

const noopQueueMessage = {
  ack() {},
  retry() {},
} as unknown as IQueueMessage<DeliveryQueueMessageV1>;

test("fresh-pending recovery retains generation five after repeated dead-letter cycles", async () => {
  const { db } = await createTestDb();
  await seedDeadLetter(db);
  const harness = queueHarness(db);

  for (let generation = 1; generation <= 5; generation += 1) {
    await processReconcileJob(
      db,
      harness.env,
      reconcileMessage(generation),
      noopQueueMessage,
    );
    if (generation < 5) {
      await db
        .update(deliveryQueue)
        .set({
          status: "dead_letter",
          attempts: 8,
          dlqPending: 1,
          nextAttemptAt: ISO,
        })
        .where(eq(deliveryQueue.id, JOB_ID));
    }
  }
  harness.sent.length = 0;

  await enqueuePendingDeliveryEndpointJobs(harness.env, new Date(), {
    includeFreshPending: true,
  });

  const wakeup = harness.sent.find(
    (body): body is DeliveryDeliverEndpointMessageV1 =>
      body.type === "deliver_endpoint",
  );
  expect(wakeup?.reconcileAttempt).toBe(5);
});

test("a stale generation-zero wakeup cannot erase generation five in future work", async () => {
  const { db } = await createTestDb();
  await db.insert(deliveryQueue).values({
    id: JOB_ID,
    activityApId: ACTIVITY_ID,
    inboxUrl: ENDPOINT,
    status: "pending",
    attempts: 1,
    reconcileAttempt: 5,
    nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: ISO,
  });
  const harness = queueHarness(db);

  await processDeliverEndpoint(
    db,
    harness.env,
    {
      version: 1,
      type: "deliver_endpoint",
      jobId: JOB_ID,
      reconcileAttempt: 0,
      scheduledAt: ISO,
    },
    harness.message,
    { acquire() {}, release() {} } as unknown as Bulkhead,
  );

  const wakeup = harness.sent.find(
    (body): body is DeliveryDeliverEndpointMessageV1 =>
      body.type === "deliver_endpoint",
  );
  expect(wakeup?.reconcileAttempt).toBe(5);
});

test("future and older reconcile generations cannot consume a pending repair", async () => {
  const { db } = await createTestDb();
  await seedDeadLetter(db, { reconcileAttempt: 2 });
  const harness = queueHarness(db);

  await processReconcileJob(
    db,
    harness.env,
    reconcileMessage(4),
    noopQueueMessage,
  );
  await processReconcileJob(
    db,
    harness.env,
    reconcileMessage(2),
    noopQueueMessage,
  );

  const row = await db
    .select({
      status: deliveryQueue.status,
      reconcileAttempt: deliveryQueue.reconcileAttempt,
      dlqPending: deliveryQueue.dlqPending,
      attempts: deliveryQueue.attempts,
    })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, JOB_ID))
    .get();
  expect(row).toEqual({
    status: "dead_letter",
    reconcileAttempt: 2,
    dlqPending: 1,
    attempts: 8,
  });
  expect(harness.sent).toEqual([]);
});

test("a legacy exhausted job and a generation-five job cannot be reconciled again", async () => {
  for (const [id, reconcileAttempt, dlqPending] of [
    ["legacy-exhausted", 5, 0],
    ["generation-five", 5, 1],
  ] as const) {
    const { db } = await createTestDb();
    await db.insert(deliveryQueue).values({
      id,
      activityApId: ACTIVITY_ID,
      inboxUrl: ENDPOINT,
      status: "dead_letter",
      attempts: 8,
      reconcileAttempt,
      dlqPending,
      nextAttemptAt: ISO,
      createdAt: ISO,
    });
    const harness = queueHarness(db);
    await processReconcileJob(
      db,
      harness.env,
      { ...reconcileMessage(5), jobId: id },
      noopQueueMessage,
    );
    expect(
      await db
        .select({ status: deliveryQueue.status })
        .from(deliveryQueue)
        .where(eq(deliveryQueue.id, id))
        .get(),
    ).toEqual({ status: "dead_letter" });
    expect(harness.sent).toEqual([]);
  }
});

test("an exact due successor revives only once and retains the retry attempt budget", async () => {
  const { db } = await createTestDb();
  await seedDeadLetter(db, { reconcileAttempt: 0 });
  const harness = queueHarness(db);

  await processReconcileJob(
    db,
    harness.env,
    reconcileMessage(1),
    noopQueueMessage,
  );
  await db
    .update(deliveryQueue)
    .set({ status: "retry_wait", attempts: 4, error: "HTTP 503" })
    .where(eq(deliveryQueue.id, JOB_ID));
  await processReconcileJob(
    db,
    harness.env,
    reconcileMessage(1),
    noopQueueMessage,
  );

  const row = await db
    .select({
      status: deliveryQueue.status,
      attempts: deliveryQueue.attempts,
      reconcileAttempt: deliveryQueue.reconcileAttempt,
    })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, JOB_ID))
    .get();
  expect(row).toEqual({
    status: "retry_wait",
    attempts: 4,
    reconcileAttempt: 1,
  });
});

test.each(["failed", "delivered"] as const)(
  "a delayed reconcile job never revives a %s delivery",
  async (status) => {
    const { db } = await createTestDb();
    await db.insert(deliveryQueue).values({
      id: JOB_ID,
      activityApId: ACTIVITY_ID,
      inboxUrl: ENDPOINT,
      status,
      attempts: 4,
      reconcileAttempt: 0,
      deliveredAt: status === "delivered" ? ISO : null,
      nextAttemptAt: ISO,
      createdAt: ISO,
    });
    const harness = queueHarness(db);

    await processReconcileJob(
      db,
      harness.env,
      reconcileMessage(1),
      noopQueueMessage,
    );

    const row = await db
      .select({
        status: deliveryQueue.status,
        attempts: deliveryQueue.attempts,
      })
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, JOB_ID))
      .get();
    expect(row).toEqual({ status, attempts: 4 });
    expect(harness.sent).toEqual([]);
  },
);

async function seedSignedDelivery(
  db: Database,
  values: {
    reconcileAttempt: number;
    dlqPending: number;
    status?: "pending" | "dead_letter";
  },
): Promise<void> {
  const keys = await generateKeyPair();
  await db.insert(actors).values({
    apId: SENDER,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${SENDER}/inbox`,
    outbox: `${SENDER}/outbox`,
    followersUrl: `${SENDER}/followers`,
    followingUrl: `${SENDER}/following`,
    publicKeyPem: keys.publicKeyPem,
    privateKeyPem: keys.privateKeyPem,
  });
  await db.insert(activities).values({
    apId: ACTIVITY_ID,
    type: "Create",
    actorApId: SENDER,
    objectApId: `${APP_URL}/ap/objects/durable-recovery`,
    rawJson: JSON.stringify({
      id: ACTIVITY_ID,
      type: "Create",
      actor: SENDER,
      object: `${APP_URL}/ap/objects/durable-recovery`,
    }),
    direction: "outbound",
  });
  await db.insert(deliveryQueue).values({
    id: JOB_ID,
    activityApId: ACTIVITY_ID,
    inboxUrl: ENDPOINT,
    status: values.status ?? "pending",
    attempts: 7,
    reconcileAttempt: values.reconcileAttempt,
    dlqPending: values.dlqPending,
    nextAttemptAt: ISO,
    createdAt: ISO,
  });
}

const failingFetch = async () => new Response(null, { status: 503 });
const noopBulkhead = { acquire() {}, release() {} } as unknown as Bulkhead;

test("failed DLQ publication recovers its signal without posting the activity twice", async () => {
  const { db } = await createTestDb();
  await seedSignedDelivery(db, { reconcileAttempt: 3, dlqPending: 0 });
  const harness = queueHarness(db, { failDlqOnce: true });
  let posts = 0;
  const deliveryFetch = async () => {
    posts += 1;
    return failingFetch();
  };
  const msg: DeliveryDeliverEndpointMessageV1 = {
    version: 1,
    type: "deliver_endpoint",
    jobId: JOB_ID,
    reconcileAttempt: 0,
    scheduledAt: ISO,
  };

  await expect(
    processDeliverEndpoint(
      db,
      harness.env,
      msg,
      harness.message,
      noopBulkhead,
      deliveryFetch,
    ),
  ).rejects.toThrow("simulated DLQ outage");
  await processDeliverEndpoint(
    db,
    harness.env,
    msg,
    harness.message,
    noopBulkhead,
    deliveryFetch,
  );

  expect(posts).toBe(1);
  expect(harness.sent.filter((body) => body.type === "dlq")).toHaveLength(1);
  expect(harness.acknowledgements).toBe(1);
  expect(harness.retries).toBe(0);
});

test("a due-reconcile sweep recovers stored generation without another HTTP POST", async () => {
  const { db } = await createTestDb();
  await seedSignedDelivery(db, {
    reconcileAttempt: 3,
    dlqPending: 1,
    status: "dead_letter",
  });
  const harness = queueHarness(db);
  const afterReconcileDelay = new Date(
    Date.now() + 6 * 60 * 60 * 1000 + 60_000,
  );

  await enqueuePendingDeliveryEndpointJobs(harness.env, afterReconcileDelay);

  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]).toMatchObject({
    type: "reconcile_job",
    jobId: JOB_ID,
    reconcileAttempt: 4,
  });
});

test("an accepted but lost DLQ signal remains sweepable until one reconcile consumes it", async () => {
  const { db } = await createTestDb();
  await seedSignedDelivery(db, { reconcileAttempt: 3, dlqPending: 0 });
  const harness = queueHarness(db, { acceptThenDropDlq: true });
  let posts = 0;
  const deliveryFetch = async () => {
    posts += 1;
    return failingFetch();
  };
  const msg: DeliveryDeliverEndpointMessageV1 = {
    version: 1,
    type: "deliver_endpoint",
    jobId: JOB_ID,
    reconcileAttempt: 0,
    scheduledAt: ISO,
  };

  await processDeliverEndpoint(
    db,
    harness.env,
    msg,
    harness.message,
    noopBulkhead,
    deliveryFetch,
  );
  expect(harness.sent.filter((body) => body.type === "dlq")).toHaveLength(0);
  expect(
    await db
      .select({ dlqPending: deliveryQueue.dlqPending })
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, JOB_ID))
      .get(),
  ).toEqual({ dlqPending: 1 });

  await enqueuePendingDeliveryEndpointJobs(
    harness.env,
    new Date(Date.now() + 6 * 60 * 60 * 1000 + 60_000),
  );
  expect(harness.sent).toHaveLength(1);
  expect(harness.sent[0]).toMatchObject({
    type: "reconcile_job",
    jobId: JOB_ID,
    reconcileAttempt: 4,
  });
  expect(posts).toBe(1);

  await db
    .update(deliveryQueue)
    .set({
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
    })
    .where(eq(deliveryQueue.id, JOB_ID));
  await processReconcileJob(
    db,
    harness.env,
    reconcileMessage(4),
    noopQueueMessage,
  );
  await db
    .update(deliveryQueue)
    .set({ status: "retry_wait", attempts: 4 })
    .where(eq(deliveryQueue.id, JOB_ID));
  await processReconcileJob(
    db,
    harness.env,
    reconcileMessage(4),
    noopQueueMessage,
  );

  const row = await db
    .select({
      status: deliveryQueue.status,
      attempts: deliveryQueue.attempts,
      reconcileAttempt: deliveryQueue.reconcileAttempt,
      dlqPending: deliveryQueue.dlqPending,
    })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, JOB_ID))
    .get();
  expect(row).toEqual({
    status: "retry_wait",
    attempts: 4,
    reconcileAttempt: 4,
    dlqPending: 0,
  });
  expect(posts).toBe(1);
});
