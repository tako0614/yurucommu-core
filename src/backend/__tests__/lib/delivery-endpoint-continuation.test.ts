import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  activities,
  actorCache,
  blockedActors,
  deliveryQueue,
  deliveryResolutions,
  deliveryEndpointRecipients,
  remoteActorTombstones,
  type Database,
} from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import {
  upsertDeliveryJob,
  purgeTerminalDeliveryEndpointJobs,
  enqueuePendingDeliveryEndpointJobs,
  handleDeliveryQueueBatch,
} from "../../lib/delivery/queue.ts";
import {
  beginEndpointRecovery,
  buildEndpointRecoveryMessage,
  continueEndpointRecovery,
  enqueuePendingEndpointRecoveries,
} from "../../lib/delivery/endpoint-recovery.ts";
import { persistDeliveryResolutionJobs } from "../../lib/delivery/resolution-outbox.ts";
import { processResolveActor } from "../../lib/delivery/queue-batching.ts";
import {
  isDeliveryQueueMessageV1,
  type DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";
import type { Env } from "../../types.ts";

const ACTIVITY = "https://local.test/ap/activities/recovery";
const ENDPOINT = "https://remote.test/shared";
const recipient = (n: number) =>
  `https://remote.test/users/${String(n).padStart(4, "0")}`;
async function fixture(count = 1) {
  const { db, client } = await createTestDb();
  const sent: DeliveryQueueMessageV1[] = [];
  const batches: number[] = [];
  let unavailable = false;
  const queue = {
    async send(body: DeliveryQueueMessageV1) {
      if (unavailable) throw new Error("local Queue unavailable");
      sent.push(body);
    },
    async sendBatch(rows: { body: DeliveryQueueMessageV1 }[]) {
      batches.push(rows.length);
      if (unavailable) throw new Error("local Queue unavailable");
      sent.push(...rows.map((row) => row.body));
    },
  };
  const env = {
    APP_URL: "https://local.test",
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
  await db.insert(activities).values({
    apId: ACTIVITY,
    type: "Update",
    actorApId: "https://local.test/ap/users/owner",
    rawJson: "{}",
    direction: "outbound",
  });
  const ids = Array.from({ length: count }, (_, n) => recipient(n));
  for (let i = 0; i < ids.length; i += 200)
    await upsertDeliveryJob(
      db,
      "selected-job",
      ACTIVITY,
      ENDPOINT,
      ids.slice(i, i + 200),
    );
  await db.update(deliveryQueue).set({
    status: "processing",
    processingToken: "actual-local-claim",
    attempts: 3,
    reconcileAttempt: 2,
  });
  const owner = {
    jobId: "selected-job",
    activityId: ACTIVITY,
    endpoint: ENDPOINT,
    processingToken: "actual-local-claim",
  };
  const generation = await beginEndpointRecovery(db, owner);
  expect(generation).toBe(owner.processingToken);
  const body = buildEndpointRecoveryMessage(owner.jobId, generation!);
  const job = () =>
    db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, owner.jobId))
      .get();
  const rows = () => db.select().from(deliveryResolutions);
  const run = () => continueEndpointRecovery(db, env, body);
  const due = () =>
    db
      .update(deliveryQueue)
      .set({ endpointRecoveryNextAttemptAt: "2020-01-01T00:00:00.000Z" });
  return {
    db,
    client,
    env,
    body,
    owner,
    sent,
    batches,
    job,
    rows,
    run,
    due,
    unavailable: (v: boolean) => {
      unavailable = v;
    },
  };
}

test("2001 positive recipients resume the durable tail without another HTTP attempt", async () => {
  const f = await fixture(2001);
  try {
    expect(await f.run()).toBe(2000);
    expect(await f.rows()).toHaveLength(2000);
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 1,
      endpointRecoveryCursor: recipient(1999),
      attempts: 3,
      reconcileAttempt: 2,
    });
    // The original HTTP verdict is terminal; continuation does not revive it.
    await f.db
      .update(deliveryQueue)
      .set({ status: "failed", processingToken: null });
    f.sent.length = 0;
    expect(await enqueuePendingEndpointRecoveries(f.env)).toBe(1);
    expect(f.sent).toMatchObject([
      {
        version: 1,
        type: "recover_endpoint",
        jobId: f.body.jobId,
        generation: f.body.generation,
      },
    ]);
    expect(await f.run()).toBe(1);
    expect(await f.rows()).toHaveLength(2001);
    expect(await f.job()).toMatchObject({
      status: "failed",
      endpointRecoveryPending: 0,
      endpointRecoveryCursor: recipient(2000),
      attempts: 3,
      reconcileAttempt: 2,
    });
    await f.db
      .update(deliveryResolutions)
      .set({ status: "failed", attempts: 8 });
    const before = await f.rows();
    expect(await f.run()).toBe(0);
    expect(await f.rows()).toEqual(before);
    expect(Math.max(...f.batches)).toBeLessThanOrEqual(100);
  } finally {
    f.client.close();
  }
});

test("a failed post-commit Queue send retains the page and restart resumes the tail", async () => {
  const f = await fixture(201);
  try {
    f.unavailable(true);
    await expect(f.run()).rejects.toThrow("local Queue unavailable");
    expect(await f.rows()).toHaveLength(200);
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 1,
      endpointRecoveryCursor: recipient(199),
      endpointRecoveryProcessingToken: null,
      endpointRecoveryAttempts: 1,
    });
    f.unavailable(false);
    await f.due();
    expect(await f.run()).toBe(1);
    expect(await f.rows()).toHaveLength(201);
    expect(await f.job()).toMatchObject({ endpointRecoveryPending: 0 });
  } finally {
    f.client.close();
  }
});

test("a failed cursor commit rolls back the complete page's resolution inserts", async () => {
  const f = await fixture(30);
  try {
    await f.db.run(
      sql`CREATE TRIGGER local_recovery_abort BEFORE UPDATE OF endpoint_recovery_cursor ON delivery_queue WHEN NEW.endpoint_recovery_cursor IS NOT NULL BEGIN SELECT RAISE(ABORT, 'local page fault'); END`,
    );
    await expect(f.run()).rejects.toThrow("local page fault");
    expect(await f.rows()).toHaveLength(0);
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 1,
      endpointRecoveryCursor: null,
      endpointRecoveryProcessingToken: null,
    });
    await f.db.run(sql`DROP TRIGGER local_recovery_abort`);
    await f.due();
    expect(await f.run()).toBe(30);
    expect(await f.rows()).toHaveLength(30);
  } finally {
    f.client.close();
  }
});

// Interleave a real durable change immediately before the actual atomic SQL
// batch. This wraps scheduling only; SQL, row values and every oracle stay real.
function beforeBatch(db: Database, change: () => Promise<void>): Database {
  let first = true;
  return new Proxy(db, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "batch")
        return async (...args: unknown[]) => {
          if (first) {
            first = false;
            await change();
          }
          return Reflect.apply(value, target, args);
        };
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

test("a superseded generation cannot insert, reopen terminal budgets or advance a cursor", async () => {
  const f = await fixture(2);
  try {
    await persistDeliveryResolutionJobs(f.db, [
      { activityId: ACTIVITY, recipientActorApId: recipient(0) },
    ]);
    await f.db
      .update(deliveryResolutions)
      .set({ status: "failed", attempts: 8 });
    const original = await f.rows();
    const raced = beforeBatch(f.db, async () => {
      await f.db.update(deliveryQueue).set({
        endpointRecoveryGeneration: "successor",
        endpointRecoveryProcessingToken: "successor-owner",
      });
    });
    expect(await continueEndpointRecovery(raced, f.env, f.body)).toBe(0);
    expect(await f.rows()).toEqual(original);
    expect(await f.job()).toMatchObject({
      endpointRecoveryGeneration: "successor",
      endpointRecoveryProcessingToken: "successor-owner",
      endpointRecoveryCursor: null,
      endpointRecoveryPending: 1,
    });
    expect(f.sent).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

for (const removal of ["recipient", "tombstone", "activity"] as const) {
  test(`late ${removal} removal cannot materialize authority from a stale page`, async () => {
    const f = await fixture();
    try {
      const raced = beforeBatch(f.db, async () => {
        if (removal === "recipient")
          await f.db.delete(deliveryEndpointRecipients);
        else if (removal === "activity") await f.db.delete(activities);
        else
          await f.db.insert(remoteActorTombstones).values({
            actorApId: recipient(0),
            deleteActivityApId: "https://remote.test/activities/delete",
          });
      });
      await continueEndpointRecovery(raced, f.env, f.body);
      expect(await f.rows()).toHaveLength(0);
      expect(f.sent).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

test("strict moderation failure preserves the unconsumed cursor, then applies current blocks", async () => {
  const f = await fixture(2);
  try {
    await f.db.run(
      sql`ALTER TABLE blocked_domains RENAME TO local_saved_blocked_domains`,
    );
    await expect(f.run()).rejects.toThrow();
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 1,
      endpointRecoveryCursor: null,
    });
    expect(await f.rows()).toHaveLength(0);
    await f.db.run(
      sql`ALTER TABLE local_saved_blocked_domains RENAME TO blocked_domains`,
    );
    await f.db.insert(blockedActors).values({ actorApId: recipient(1) });
    await f.due();
    expect(await f.run()).toBe(1);
    expect((await f.rows()).map((row) => row.recipientActorApId)).toEqual([
      recipient(0),
    ]);
  } finally {
    f.client.close();
  }
});

test("pending recovery survives terminal reap, normal cleanup resumes after completion", async () => {
  const f = await fixture();
  try {
    await f.db
      .update(deliveryQueue)
      .set({ status: "failed", createdAt: "2020-01-01T00:00:00.000Z" });
    expect(await purgeTerminalDeliveryEndpointJobs(f.db)).toBe(0);
    expect(await f.run()).toBe(1);
    expect(await purgeTerminalDeliveryEndpointJobs(f.db)).toBe(1);
    expect(await f.job()).toBeUndefined();
    expect(await f.db.select().from(deliveryEndpointRecipients)).toHaveLength(
      0,
    );
  } finally {
    f.client.close();
  }
});

test("a new HTTP claim joins pending progress; old or completed claim cannot restart it", async () => {
  const f = await fixture(201);
  try {
    f.unavailable(true);
    await expect(f.run()).rejects.toThrow();
    await f.db.update(deliveryQueue).set({ processingToken: "new-http-claim" });
    expect(await beginEndpointRecovery(f.db, f.owner)).toBeNull();
    expect(
      await beginEndpointRecovery(f.db, {
        ...f.owner,
        processingToken: "new-http-claim",
      }),
    ).toBe(f.body.generation);
    expect(await f.job()).toMatchObject({
      endpointRecoveryCursor: recipient(199),
      endpointRecoveryAttempts: 1,
    });
    f.unavailable(false);
    await f.due();
    await f.run();
    // Only a genuinely newer HTTP invalidation may create a fresh generation.
    expect(await beginEndpointRecovery(f.db, f.owner)).toBeNull();
    expect(await f.run()).toBe(0);
  } finally {
    f.client.close();
  }
});

test("malformed/still-live claims fail closed; a stale claim is recoverable", async () => {
  const f = await fixture();
  try {
    await f.db.update(deliveryQueue).set({
      endpointRecoveryProcessingToken: "interrupted",
      endpointRecoveryProcessingStartedAt: "invalid",
    });
    expect(await enqueuePendingEndpointRecoveries(f.env)).toBe(0);
    expect(await f.run()).toBe(0);
    await f.db
      .update(deliveryQueue)
      .set({ endpointRecoveryProcessingStartedAt: new Date().toISOString() });
    expect(await f.run()).toBe(0);
    await f.db
      .update(deliveryQueue)
      .set({ endpointRecoveryProcessingStartedAt: "2020-01-01T00:00:00.000Z" });
    expect(await enqueuePendingEndpointRecoveries(f.env)).toBe(1);
    expect(await f.run()).toBe(1);
  } finally {
    f.client.close();
  }
});

test("lost accepted wakeup is swept independently of the 500 HTTP-job window", async () => {
  const f = await fixture();
  try {
    await f.db.update(deliveryQueue).set({ status: "failed" });
    for (let i = 0; i < 500; i++)
      await f.db.insert(deliveryQueue).values({
        id: `other-${i}`,
        activityApId: ACTIVITY,
        inboxUrl: ENDPOINT,
        createdAt: "2020-01-01T00:00:00.000Z",
      });
    expect(await enqueuePendingDeliveryEndpointJobs(f.env)).toBe(501);
    expect(
      f.sent.filter((row) => row.type === "recover_endpoint"),
    ).toHaveLength(1);
    f.sent.length = 0; // An accepted local signal was lost before consumption.
    expect(await enqueuePendingEndpointRecoveries(f.env)).toBe(1);
    expect(isDeliveryQueueMessageV1(f.sent[0])).toBe(true);
    let acks = 0;
    await handleDeliveryQueueBatch(
      {
        queue: "local",
        ackAll() {},
        retryAll() {},
        messages: [
          {
            id: "local",
            body: f.sent[0]!,
            timestamp: new Date(),
            attempts: 1,
            ack() {
              acks++;
            },
            retry() {
              throw new Error("unexpected retry");
            },
          },
        ],
      },
      f.env,
    );
    expect(acks).toBe(1);
    expect(await f.job()).toMatchObject({ endpointRecoveryPending: 0 });
  } finally {
    f.client.close();
  }
});

test("a late tombstone is still rejected by the actual resolution consumer", async () => {
  const f = await fixture();
  try {
    await f.run();
    const msg = f.sent.find((row) => row.type === "resolve_actor");
    if (!msg || msg.type !== "resolve_actor") throw new Error("missing wakeup");
    await f.db.insert(remoteActorTombstones).values({
      actorApId: recipient(0),
      deleteActivityApId: "https://remote.test/activities/delete",
    });
    let acks = 0;
    await processResolveActor(f.db, f.env, msg, {
      id: "local",
      body: msg,
      timestamp: new Date(),
      attempts: 1,
      ack() {
        acks++;
      },
      retry() {
        throw new Error("unexpected retry");
      },
    });
    expect(acks).toBe(1);
    expect(await f.rows()).toMatchObject([
      { status: "discarded", lastError: "recipient_tombstoned" },
    ]);
  } finally {
    f.client.close();
  }
});

test("a replacement processing token fences stale page writes within the same generation", async () => {
  const f = await fixture();
  try {
    const raced = beforeBatch(f.db, async () => {
      await f.db
        .update(deliveryQueue)
        .set({ endpointRecoveryProcessingToken: "new-recovery-owner" });
    });
    expect(await continueEndpointRecovery(raced, f.env, f.body)).toBe(0);
    expect(await f.rows()).toHaveLength(0);
    expect(await f.job()).toMatchObject({
      endpointRecoveryProcessingToken: "new-recovery-owner",
      endpointRecoveryCursor: null,
      endpointRecoveryPending: 1,
    });
  } finally {
    f.client.close();
  }
});

test("resuming after a committed page never reopens that page's later terminal resolution", async () => {
  const f = await fixture(201);
  try {
    await persistDeliveryResolutionJobs(f.db, [
      { activityId: ACTIVITY, recipientActorApId: recipient(0) },
    ]);
    await f.db
      .update(deliveryResolutions)
      .set({ status: "resolved", attempts: 7 });
    f.unavailable(true);
    await expect(f.run()).rejects.toThrow();
    expect(
      (await f.rows()).find((row) => row.recipientActorApId === recipient(0)),
    ).toMatchObject({ status: "pending", attempts: 0 });
    await f.db
      .update(deliveryResolutions)
      .set({ status: "failed", attempts: 8 })
      .where(eq(deliveryResolutions.recipientActorApId, recipient(0)));
    f.unavailable(false);
    await f.due();
    expect(await f.run()).toBe(1);
    expect(
      (await f.rows()).find((row) => row.recipientActorApId === recipient(0)),
    ).toMatchObject({ status: "failed", attempts: 8 });
  } finally {
    f.client.close();
  }
});

test("blocked pages still consume the fixed scan budget and keep the tail durable", async () => {
  const f = await fixture(2001);
  try {
    await f.db.run(
      sql`INSERT INTO blocked_domains(domain) VALUES ('remote.test')`,
    );
    expect(await f.run()).toBe(0);
    expect(await f.rows()).toHaveLength(0);
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 1,
      endpointRecoveryCursor: recipient(1999),
    });
    expect(await f.run()).toBe(0);
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 0,
      endpointRecoveryCursor: recipient(2000),
    });
  } finally {
    f.client.close();
  }
});

test("invalid due dates cannot occupy the finite due-recovery scan", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 50; i++)
      await f.db.insert(deliveryQueue).values({
        id: `invalid-${i}`,
        activityApId: ACTIVITY,
        inboxUrl: ENDPOINT,
        endpointRecoveryPending: 1,
        endpointRecoveryGeneration: "unknown-preserved",
        endpointRecoveryNextAttemptAt: "",
      });
    expect(await enqueuePendingEndpointRecoveries(f.env)).toBe(1);
    expect(f.sent).toMatchObject([
      { jobId: f.body.jobId, type: "recover_endpoint" },
    ]);
    expect(
      await f.db
        .select()
        .from(deliveryQueue)
        .where(
          eq(deliveryQueue.endpointRecoveryGeneration, "unknown-preserved"),
        ),
    ).toHaveLength(50);
  } finally {
    f.client.close();
  }
});

test("invalidation marker and cache expiry are atomic before any page or wakeup", async () => {
  const f = await fixture();
  try {
    await f.db
      .update(deliveryQueue)
      .set({ endpointRecoveryPending: 0, endpointRecoveryGeneration: null });
    await f.db.insert(actorCache).values({
      apId: recipient(0),
      inbox: `${recipient(0)}/inbox`,
      sharedInbox: ENDPOINT,
      lastFetchedAt: new Date().toISOString(),
      rawJson: "{}",
    });
    const original = await f.db.select().from(actorCache).get();
    await f.db.run(
      sql`CREATE TRIGGER local_begin_abort BEFORE UPDATE OF endpoint_recovery_pending ON delivery_queue WHEN NEW.endpoint_recovery_pending = 1 BEGIN SELECT RAISE(ABORT, 'local marker fault'); END`,
    );
    await expect(beginEndpointRecovery(f.db, f.owner)).rejects.toThrow(
      "local marker fault",
    );
    expect(await f.job()).toMatchObject({
      endpointRecoveryPending: 0,
      endpointRecoveryGeneration: null,
    });
    expect(await f.db.select().from(actorCache).get()).toEqual(original);
    expect(f.sent).toHaveLength(0);
    await f.db.run(sql`DROP TRIGGER local_begin_abort`);
    expect(await beginEndpointRecovery(f.db, f.owner)).toBe(f.body.generation);
    expect(await f.db.select().from(actorCache).get()).toMatchObject({
      sharedInbox: null,
      lastFetchedAt: "1970-01-01T00:00:00.000Z",
    });
    expect(await f.job()).toMatchObject({ endpointRecoveryPending: 1 });
  } finally {
    f.client.close();
  }
});
