import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { activities, actors, deliveryQueue } from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import {
  Bulkhead,
  purgeTerminalDeliveryEndpointJobs,
} from "../../lib/delivery/queue.ts";
import { processDeliverEndpoint } from "../../lib/delivery/queue-delivery.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const ENDPOINT = "https://example.com/inbox";
const ISO = "2026-01-01T00:00:00.000Z";

test("an invalid-endpoint stale reader cannot fail a replacement processing token", async () => {
  const { db } = await createTestDb();
  await db.insert(deliveryQueue).values({
    id: "job",
    activityApId: "activity",
    inboxUrl: "invalid",
    status: "processing",
    reconcileAttempt: 3,
    processingStartedAt: ISO,
    processingToken: "old-claim",
    nextAttemptAt: ISO,
  });
  // Interleave a replacement claim precisely between the preclaim SELECT and
  // its conditional failed-state UPDATE; execute the real predicate on SQLite.
  const interleaved = new Proxy(db, {
    get(target, property) {
      if (property === "update") {
        return (...args: Parameters<typeof db.update>) => {
          const update = target.update(...args);
          return {
            set(values: Parameters<typeof update.set>[0]) {
              const query = update.set(values);
              return {
                where(predicate: Parameters<typeof query.where>[0]) {
                  return (async () => {
                    await db
                      .update(deliveryQueue)
                      .set({
                        processingToken: "new-claim",
                        processingStartedAt: new Date().toISOString(),
                      })
                      .where(eq(deliveryQueue.id, "job"));
                    return await query.where(predicate);
                  })();
                },
              };
            },
          };
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Database;
  const queue = { async send() {}, async sendBatch() {} };
  let acked = 0;
  await processDeliverEndpoint(
    interleaved,
    {
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as unknown as Env,
    { version: 1, type: "deliver_endpoint", jobId: "job", scheduledAt: ISO },
    {
      ack() {
        acked++;
      },
      retry() {},
    } as never,
    new Bulkhead(1, 1),
  );
  expect(acked).toBe(1);
  expect(
    await db
      .select({
        status: deliveryQueue.status,
        token: deliveryQueue.processingToken,
      })
      .from(deliveryQueue)
      .get(),
  ).toEqual({ status: "processing", token: "new-claim" });
});

test.each([202, 403, 503])(
  "a stale claimant's HTTP %s completion cannot overwrite a newer claim",
  async (status) => {
    const { db } = await createTestDb();
    const keys = await generateKeyPair();
    const sender = "https://local.example/users/alice";
    await db.insert(actors).values({
      apId: sender,
      preferredUsername: "alice",
      inbox: `${sender}/inbox`,
      outbox: `${sender}/outbox`,
      followersUrl: `${sender}/followers`,
      followingUrl: `${sender}/following`,
      publicKeyPem: keys.publicKeyPem,
      privateKeyPem: keys.privateKeyPem,
    });
    await db.insert(activities).values({
      apId: "activity",
      type: "Create",
      actorApId: sender,
      rawJson: JSON.stringify({
        id: "activity",
        type: "Create",
        actor: sender,
      }),
      direction: "outbound",
    });
    await db.insert(deliveryQueue).values({
      id: "job",
      activityApId: "activity",
      inboxUrl: ENDPOINT,
      reconcileAttempt: 3,
      attempts: 7,
      nextAttemptAt: ISO,
    });
    const sent: unknown[] = [];
    const queue = {
      async send(body: unknown) {
        sent.push(body);
      },
      async sendBatch() {},
    };
    const env = {
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as unknown as Env;
    let posts = 0;
    let acked = 0;
    const newStartedAt = new Date().toISOString();
    await processDeliverEndpoint(
      db,
      env,
      {
        version: 1,
        type: "deliver_endpoint",
        jobId: "job",
        reconcileAttempt: 0,
        scheduledAt: ISO,
      },
      {
        ack() {
          acked++;
        },
        retry() {},
      } as never,
      new Bulkhead(10, 5),
      async () => {
        posts++;
        await db
          .update(deliveryQueue)
          .set({
            status: "processing",
            processingToken: "new-claim",
            processingStartedAt: newStartedAt,
            attempts: 4,
          })
          .where(eq(deliveryQueue.id, "job"));
        return new Response(null, { status });
      },
    );
    expect(posts).toBe(1);
    expect(acked).toBe(1);
    expect(sent).toEqual([]);
    expect(
      await db
        .select({
          status: deliveryQueue.status,
          token: deliveryQueue.processingToken,
          started: deliveryQueue.processingStartedAt,
          attempts: deliveryQueue.attempts,
          generation: deliveryQueue.reconcileAttempt,
          pending: deliveryQueue.dlqPending,
        })
        .from(deliveryQueue)
        .get(),
    ).toEqual({
      status: "processing",
      token: "new-claim",
      started: newStartedAt,
      attempts: 4,
      generation: 3,
      pending: 0,
    });
  },
);

test("a generation changed while waiting for bulkhead prevents the older claim", async () => {
  const { db } = await createTestDb();
  await db.insert(deliveryQueue).values({
    id: "job",
    activityApId: "activity",
    inboxUrl: ENDPOINT,
    reconcileAttempt: 0,
    nextAttemptAt: ISO,
  });
  const queue = { async send() {}, async sendBatch() {} };
  const env = {
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
  let acked = 0;
  let posts = 0;
  const bulkhead = {
    async acquire() {
      await db
        .update(deliveryQueue)
        .set({ reconcileAttempt: 1, attempts: 2 })
        .where(eq(deliveryQueue.id, "job"));
    },
    release() {},
  } as unknown as Bulkhead;
  await processDeliverEndpoint(
    db,
    env,
    { version: 1, type: "deliver_endpoint", jobId: "job", scheduledAt: ISO },
    {
      ack() {
        acked++;
      },
      retry() {},
    } as never,
    bulkhead,
    async () => {
      posts++;
      return new Response(null, { status: 202 });
    },
  );
  expect(posts).toBe(0);
  expect(acked).toBe(1);
  expect(
    await db
      .select({
        status: deliveryQueue.status,
        attempts: deliveryQueue.attempts,
        generation: deliveryQueue.reconcileAttempt,
        token: deliveryQueue.processingToken,
      })
      .from(deliveryQueue)
      .get(),
  ).toEqual({ status: "pending", attempts: 2, generation: 1, token: null });
});

test("terminal retention cannot purge an unconsumed repair intent", async () => {
  const { db } = await createTestDb();
  for (const [id, pending] of [
    ["repair", 1],
    ["settled", 0],
  ] as const) {
    await db.insert(deliveryQueue).values({
      id,
      activityApId: id,
      inboxUrl: ENDPOINT,
      status: "dead_letter",
      reconcileAttempt: 3,
      dlqPending: pending,
      nextAttemptAt: ISO,
      createdAt: ISO,
    });
  }
  expect(await purgeTerminalDeliveryEndpointJobs(db)).toBe(1);
  expect((await db.select().from(deliveryQueue)).map((row) => row.id)).toEqual([
    "repair",
  ]);
});
