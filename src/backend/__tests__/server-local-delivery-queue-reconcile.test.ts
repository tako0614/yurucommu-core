import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../db/schema.ts";
import type { Database } from "../../db/index.ts";
import { deliveryQueue } from "../../db/index.ts";
import type {
  DeliveryQueueMessageV1,
  DeliveryDeliverEndpointMessageV1,
} from "../lib/delivery/types.ts";
import { reconcileLocalDeliveryQueue } from "../server.ts";

// Regression for #6 (non-durable local queue loses in-flight deliveries on
// restart). The in-memory local queue holds queued/retry-waiting deliveries
// only in process memory + setTimeout timers, so a restart drops them. The
// durable delivery_queue table is the record of outstanding work, and the
// reconciliation sweep must re-enqueue every non-terminal row.

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../migrations/", import.meta.url);
  const sql = await readFile(new URL("0001_init.sql", root), "utf8");
  await client.executeMultiple(sql);
  return drizzle(client, { schema }) as unknown as Database;
}

/** Minimal recording stand-in for the local delivery Queue binding. */
function recordingQueue() {
  const sent: DeliveryQueueMessageV1[] = [];
  return {
    sent,
    queue: {
      send: async (body: DeliveryQueueMessageV1) => {
        sent.push(body);
      },
      sendBatch: async () => {},
    } as unknown as import("@cloudflare/workers-types").Queue<DeliveryQueueMessageV1>,
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

test("reconcileLocalDeliveryQueue re-enqueues pending and retry_wait rows, plus stale processing rows, and skips terminal rows", async () => {
  const db = await freshDb();
  const now = Date.now();

  await db.insert(deliveryQueue).values([
    {
      id: "job-pending",
      activityApId: "https://example.test/a/1",
      inboxUrl: "https://remote.test/inbox",
      status: "pending",
      attempts: 0,
      nextAttemptAt: iso(now),
      createdAt: iso(now),
    },
    {
      id: "job-retry",
      activityApId: "https://example.test/a/2",
      inboxUrl: "https://remote.test/inbox",
      status: "retry_wait",
      attempts: 2,
      nextAttemptAt: iso(now + 30_000),
      createdAt: iso(now),
    },
    {
      // Claimed by a worker that died long ago — must be reclaimed.
      id: "job-stale-processing",
      activityApId: "https://example.test/a/3",
      inboxUrl: "https://remote.test/inbox",
      status: "processing",
      attempts: 1,
      processingStartedAt: iso(now - 10 * 60 * 1000),
      nextAttemptAt: iso(now),
      createdAt: iso(now),
    },
    {
      // Just started processing — its owner is presumably alive; do not steal.
      id: "job-fresh-processing",
      activityApId: "https://example.test/a/4",
      inboxUrl: "https://remote.test/inbox",
      status: "processing",
      attempts: 1,
      processingStartedAt: iso(now - 1000),
      nextAttemptAt: iso(now),
      createdAt: iso(now),
    },
    {
      id: "job-delivered",
      activityApId: "https://example.test/a/5",
      inboxUrl: "https://remote.test/inbox",
      status: "delivered",
      attempts: 1,
      deliveredAt: iso(now),
      nextAttemptAt: iso(now),
      createdAt: iso(now),
    },
    {
      id: "job-dead",
      activityApId: "https://example.test/a/6",
      inboxUrl: "https://remote.test/inbox",
      status: "dead_letter",
      attempts: 9,
      nextAttemptAt: iso(now),
      createdAt: iso(now),
    },
    {
      id: "job-failed",
      activityApId: "https://example.test/a/7",
      inboxUrl: "https://remote.test/inbox",
      status: "failed",
      attempts: 1,
      nextAttemptAt: iso(now),
      createdAt: iso(now),
    },
  ]);

  const { sent, queue } = recordingQueue();
  const env = {
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
  } as unknown as Parameters<typeof reconcileLocalDeliveryQueue>[0];

  const requeued = await reconcileLocalDeliveryQueue(env);

  // pending + retry_wait + stale-processing = 3; fresh-processing and all
  // terminal rows are excluded.
  expect(requeued).toBe(3);
  expect(sent.length).toBe(3);

  for (const msg of sent) {
    expect(msg.type).toBe("deliver_endpoint");
  }
  const enqueuedIds = sent
    .map((m) => (m as DeliveryDeliverEndpointMessageV1).jobId)
    .sort();
  expect(enqueuedIds).toEqual([
    "job-pending",
    "job-retry",
    "job-stale-processing",
  ]);
});

test("reconcileLocalDeliveryQueue is a no-op when there is no local delivery queue (Cloudflare Queues path)", async () => {
  const db = await freshDb();
  await db.insert(deliveryQueue).values({
    id: "job-pending",
    activityApId: "https://example.test/a/1",
    inboxUrl: "https://remote.test/inbox",
    status: "pending",
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  const env = {
    DB_INSTANCE: db,
    DELIVERY_QUEUE: undefined,
  } as unknown as Parameters<typeof reconcileLocalDeliveryQueue>[0];

  expect(await reconcileLocalDeliveryQueue(env)).toBe(0);
});

test("reconcileLocalDeliveryQueue returns 0 when nothing is outstanding", async () => {
  const db = await freshDb();
  const { queue } = recordingQueue();
  const env = {
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
  } as unknown as Parameters<typeof reconcileLocalDeliveryQueue>[0];

  expect(await reconcileLocalDeliveryQueue(env)).toBe(0);
});
