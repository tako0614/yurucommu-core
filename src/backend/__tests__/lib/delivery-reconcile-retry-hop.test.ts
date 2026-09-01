import { expect, test } from "bun:test";

import type { Database } from "../../../db/index.ts";
import { deliveryQueue } from "../../../db/index.ts";
import { Bulkhead } from "../../lib/delivery/queue.ts";
import { processDeliverEndpoint } from "../../lib/delivery/queue-delivery.ts";
import type {
  DeliveryDeliverEndpointMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

// DEEP round-2 #6: the reconcile-cycle counter (`reconcileAttempt`) was carried
// across reconcile_job -> deliver_endpoint and deliver_endpoint(dead-letter) ->
// dlq, but every INTRA-attempt re-enqueue inside processDeliverEndpoint called
// buildDeliverEndpointMessage(job.id) with NO second arg, resetting the count to
// 0. A reconcile cycle resets attempts to 0, so a re-enqueue always preceded the
// dead-letter and dropped the cycle count -> a permanently-dead endpoint
// reconciled forever. Each re-enqueue site now threads `msg.reconcileAttempt`.
//
// These cases exercise the two re-enqueue sites that run BEFORE the verified-CAS
// claim (the nextAttemptAt defer and the stale-processing re-poll). The
// cross-runtime claim itself and its Actor Delete ordering are covered by
// delivery-endpoint-claim.test.ts.

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
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
    env: { DELIVERY_QUEUE: queue, DELIVERY_DLQ: queue } as never,
  };
}

const msgFor = (
  reconcileAttempt: number,
): DeliveryDeliverEndpointMessageV1 => ({
  version: 1,
  type: "deliver_endpoint",
  jobId: "j1",
  reconcileAttempt,
  scheduledAt: new Date().toISOString(),
});

const noopMessage = { ack() {}, retry() {} } as never;

test("the nextAttemptAt defer re-enqueue preserves the reconcile-cycle count", async () => {
  const db = await freshDb();
  const { sent, env } = recordingQueue();
  // nextAttemptAt in the future -> the defer branch re-enqueues + acks.
  await db.insert(deliveryQueue).values({
    id: "j1",
    activityApId: "https://yuru.test/ap/activities/x1",
    inboxUrl: "https://remote.test/inbox",
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  });

  await processDeliverEndpoint(
    db,
    env,
    msgFor(3),
    noopMessage,
    new Bulkhead(10, 5),
  );

  const deliver = sent.find(
    (m): m is DeliveryDeliverEndpointMessageV1 => m.type === "deliver_endpoint",
  );
  expect(deliver).toBeTruthy();
  expect(deliver?.reconcileAttempt).toBe(3);
});

test("the stale-processing re-poll re-enqueue preserves the reconcile-cycle count", async () => {
  const db = await freshDb();
  const { sent, env } = recordingQueue();
  // A fresh 'processing' row (started recently) re-polls + acks rather than
  // stealing the in-flight job — and must keep the cycle count.
  await db.insert(deliveryQueue).values({
    id: "j1",
    activityApId: "https://yuru.test/ap/activities/x1",
    inboxUrl: "https://remote.test/inbox",
    status: "processing",
    attempts: 1,
    processingStartedAt: new Date(Date.now() - 1000).toISOString(),
    nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
    createdAt: new Date().toISOString(),
  });

  await processDeliverEndpoint(
    db,
    env,
    msgFor(4),
    noopMessage,
    new Bulkhead(10, 5),
  );

  const deliver = sent.find(
    (m): m is DeliveryDeliverEndpointMessageV1 => m.type === "deliver_endpoint",
  );
  expect(deliver).toBeTruthy();
  expect(deliver?.reconcileAttempt).toBe(4);
});
