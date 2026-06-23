import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { deliveryQueue } from "../../../db/index.ts";
import {
  handleDeliveryDlqBatch,
  MAX_RECONCILE_ATTEMPTS,
} from "../../lib/delivery/queue.ts";
import { processReconcileJob } from "../../lib/delivery/queue-batching.ts";
import type {
  DeliveryDeliverEndpointMessageV1,
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
  DeliveryReconcileJobMessageV1,
} from "../../lib/delivery/types.ts";

// Audit #10 finding #1: the dead-letter reconcile loop had no working terminal
// condition — handleDeliveryDlqBatch always seeded reconcile(1) and
// processReconcileJob never advanced the count, so a permanently-dead endpoint
// churned dead_letter -> reconcile -> dead_letter forever. The count is now
// carried in-band (deliver_endpoint -> dlq -> reconcile_job -> deliver_endpoint)
// and the loop terminates after MAX_RECONCILE_ATTEMPTS.

const ISO = "2026-01-01T00:00:00.000Z";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  await client.executeMultiple(
    await readFile(new URL("0001_init.sql", root), "utf8"),
  );
  return drizzle(client, { schema }) as unknown as Database;
}

function recordingQueue() {
  const sent: DeliveryQueueMessageV1[] = [];
  const queue = {
    send: async (body: DeliveryQueueMessageV1) => {
      sent.push(body);
    },
    sendBatch: async () => {},
  };
  return {
    sent,
    env: {
      // queueAvailable() requires BOTH bindings to be present.
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

function dlqMsg(reconcileAttempt: number): DeliveryDlqMessageV1 {
  return {
    version: 1,
    type: "dlq",
    jobId: "j1",
    activityId: "a1",
    endpoint: "https://dead.example/inbox",
    attempts: 8,
    lastError: "fail",
    reconcileAttempt,
    deadLetteredAt: ISO,
  };
}

function dlqBatch(bodies: DeliveryDlqMessageV1[]) {
  return {
    messages: bodies.map((body, i) => ({
      body,
      id: String(i),
      timestamp: new Date(0),
      attempts: 1,
      ack: () => {},
      retry: () => {},
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("DLQ reconcile is scheduled with attempt+1 while below the cap", async () => {
  const { sent, env } = recordingQueue();
  await handleDeliveryDlqBatch(dlqBatch([dlqMsg(0), dlqMsg(3)]), env);
  const reconciles = sent.filter(
    (m): m is DeliveryReconcileJobMessageV1 => m.type === "reconcile_job",
  );
  // 0 -> 1, 3 -> 4
  expect(reconciles.map((m) => m.reconcileAttempt).sort()).toEqual([1, 4]);
});

test("DLQ gives up at the reconcile cap (no further reconcile scheduled)", async () => {
  const { sent, env } = recordingQueue();
  await handleDeliveryDlqBatch(dlqBatch([dlqMsg(MAX_RECONCILE_ATTEMPTS)]), env);
  expect(sent.filter((m) => m.type === "reconcile_job").length).toBe(0);
});

test("a DLQ message with no reconcileAttempt (legacy/first dead-letter) seeds reconcile(1)", async () => {
  const { sent, env } = recordingQueue();
  const legacy = dlqMsg(0) as DeliveryDlqMessageV1;
  delete legacy.reconcileAttempt;
  await handleDeliveryDlqBatch(dlqBatch([legacy]), env);
  const reconciles = sent.filter(
    (m): m is DeliveryReconcileJobMessageV1 => m.type === "reconcile_job",
  );
  expect(reconciles.length).toBe(1);
  expect(reconciles[0].reconcileAttempt).toBe(1);
});

test("processReconcileJob revives the job and carries the generation into the new deliver_endpoint", async () => {
  const db = await freshDb();
  await db.insert(deliveryQueue).values({
    id: "j1",
    activityApId: "a1",
    inboxUrl: "https://dead.example/inbox",
    status: "dead_letter",
    attempts: 8,
    nextAttemptAt: ISO,
    createdAt: ISO,
  });
  const { sent, env } = recordingQueue();
  const msg: DeliveryReconcileJobMessageV1 = {
    version: 1,
    type: "reconcile_job",
    jobId: "j1",
    reconcileAttempt: 3,
    scheduledAt: ISO,
  };
  await processReconcileJob(db, env, msg, {
    ack: () => {},
    retry: () => {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const row = await db
    .select({ status: deliveryQueue.status, attempts: deliveryQueue.attempts })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, "j1"))
    .get();
  expect(row?.status).toBe("pending");
  expect(row?.attempts).toBe(0);

  const deliver = sent.find(
    (m): m is DeliveryDeliverEndpointMessageV1 => m.type === "deliver_endpoint",
  );
  expect(deliver?.reconcileAttempt).toBe(3); // generation carried forward
});

test("processReconcileJob is a no-op once a job has been delivered", async () => {
  const db = await freshDb();
  await db.insert(deliveryQueue).values({
    id: "j1",
    activityApId: "a1",
    inboxUrl: "https://dead.example/inbox",
    status: "delivered",
    attempts: 2,
    deliveredAt: ISO,
    nextAttemptAt: ISO,
    createdAt: ISO,
  });
  const { sent, env } = recordingQueue();
  await processReconcileJob(
    db,
    env,
    {
      version: 1,
      type: "reconcile_job",
      jobId: "j1",
      reconcileAttempt: 2,
      scheduledAt: ISO,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { ack: () => {}, retry: () => {} } as any,
  );
  expect(sent.length).toBe(0);
});
