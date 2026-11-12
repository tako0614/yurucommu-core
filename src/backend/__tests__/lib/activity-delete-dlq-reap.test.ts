import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  activities,
  actors,
  communities,
  deliveryQueue,
  notificationPushJobs,
} from "../../../db/index.ts";
import { processReconcileJob } from "../../lib/delivery/queue-batching.ts";
import type { DeliveryQueueMessageV1 } from "../../lib/delivery/types.ts";
import { reapDrainedTombstones } from "../../routes/actors.ts";
import type { IQueueMessage } from "../../runtime/queue.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
type SignerKind = "actor" | "group";

async function fixture(
  kind: SignerKind,
  options: { generation?: number; due?: string } = {},
) {
  const { db, client } = await createTestDb();
  const apId = `${APP_URL}/ap/${kind}/retired`;
  const activityId = `${APP_URL}/ap/activities/delete-retired`;
  const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const signer = {
    apId,
    preferredUsername: "deleted-retired",
    name: "Retired fixture",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "FIXTURE-PUBLIC",
    privateKeyPem: "FIXTURE-PRIVATE",
    deletedAt: old,
  };
  if (kind === "actor") {
    await db.insert(actors).values({
      ...signer,
      type: "Person",
      followingUrl: `${apId}/following`,
      takosUserId: "fixture-retired-user",
    });
  } else {
    await db.insert(communities).values({
      ...signer,
      createdBy: `${APP_URL}/ap/users/retired-owner`,
    });
  }
  await db.insert(activities).values({
    apId: activityId,
    type: "Delete",
    actorApId: apId,
    objectApId: apId,
    rawJson: "{}",
    direction: "outbound",
  });
  await db.insert(deliveryQueue).values({
    id: "delete-job",
    activityApId: activityId,
    inboxUrl: "https://remote.test/inbox",
    status: "dead_letter",
    attempts: 8,
    reconcileAttempt: options.generation ?? 0,
    dlqPending: 1,
    nextAttemptAt: options.due ?? old,
    createdAt: old,
  });
  await db.insert(notificationPushJobs).values({
    id: "delete-projection",
    actorApId: apId,
    activityApId: activityId,
    status: "delivered",
  });

  const signerRow = () =>
    kind === "actor"
      ? db.select().from(actors).where(eq(actors.apId, apId)).get()
      : db.select().from(communities).where(eq(communities.apId, apId)).get();
  const snapshot = async () => ({
    signer: await signerRow(),
    activities: await db.select().from(activities),
    jobs: await db.select().from(deliveryQueue),
    projections: await db.select().from(notificationPushJobs),
  });
  const sent: DeliveryQueueMessageV1[] = [];
  let acknowledgements = 0;
  const queue = {
    send: async (body: DeliveryQueueMessageV1) => {
      sent.push(body);
    },
  };
  const env = {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
  const repair = (generation: number) =>
    processReconcileJob(
      db,
      env,
      {
        version: 1,
        type: "reconcile_job",
        jobId: "delete-job",
        reconcileAttempt: generation,
        scheduledAt: old,
      },
      {
        ack() {
          acknowledgements += 1;
        },
        retry() {
          throw new Error("Unexpected repair retry");
        },
      } as unknown as IQueueMessage<DeliveryQueueMessageV1>,
    );
  return {
    db,
    client,
    apId,
    activityId,
    snapshot,
    signerRow,
    repair,
    sent,
    acknowledgements: () => acknowledgements,
  };
}

for (const kind of ["actor", "group"] as const) {
  test(`${kind} retains Delete material through DLQ repair until delivery completes`, async () => {
    const f = await fixture(kind);
    try {
      const before = await f.snapshot();
      expect(await reapDrainedTombstones(f.db)).toBe(0);
      expect(await f.snapshot()).toEqual(before);

      // Real reconcile consumes the retained intent but active delivery still
      // needs the original signer. Queue sends stay in this in-memory fixture.
      await f.repair(1);
      expect(f.acknowledgements()).toBe(1);
      expect(f.sent).toMatchObject([
        { type: "deliver_endpoint", jobId: "delete-job", reconcileAttempt: 1 },
      ]);
      expect(await f.db.select().from(deliveryQueue).get()).toMatchObject({
        status: "pending",
        dlqPending: 0,
        reconcileAttempt: 1,
      });
      const repairing = await f.snapshot();
      expect(await reapDrainedTombstones(f.db)).toBe(0);
      expect(await f.snapshot()).toEqual(repairing);

      // Model the durable completion fact, without sending to a remote peer.
      await f.db
        .update(deliveryQueue)
        .set({ status: "delivered" })
        .where(eq(deliveryQueue.id, "delete-job"));
      expect(await reapDrainedTombstones(f.db)).toBe(1);
      expect((await f.snapshot()).activities).toHaveLength(0);
      expect((await f.snapshot()).jobs).toHaveLength(0);
      expect((await f.snapshot()).projections).toHaveLength(0);
      if (kind === "actor") expect(await f.signerRow()).toBeUndefined();
      else expect(await f.signerRow()).toMatchObject({ privateKeyPem: "" });
    } finally {
      f.client.close();
    }
  });
}

for (const status of ["delivered", "failed", "dead_letter"] as const) {
  test(`terminal ${status} with no repair intent retains the existing reap behavior`, async () => {
    const f = await fixture("actor");
    try {
      await f.db
        .update(deliveryQueue)
        .set({ status, dlqPending: 0 })
        .where(eq(deliveryQueue.id, "delete-job"));
      expect(await reapDrainedTombstones(f.db)).toBe(1);
      expect(await f.signerRow()).toBeUndefined();
      expect((await f.snapshot()).activities).toHaveLength(0);
      expect((await f.snapshot()).jobs).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const repairCase of [
  { name: "stale", generation: 1, requested: 1, sent: 0 },
  { name: "out-of-budget", generation: 0, requested: 6, sent: 0 },
  { name: "invalid due time", due: "invalid", requested: 1, sent: 0 },
  {
    name: "not yet due",
    due: "9999-01-01T00:00:00.000Z",
    requested: 1,
    sent: 1,
  },
]) {
  test(`${repairCase.name} repair wakeup cannot authorize removal of Delete material`, async () => {
    const f = await fixture("actor", repairCase);
    try {
      const before = await f.snapshot();
      await f.repair(repairCase.requested);
      expect(f.acknowledgements()).toBe(1);
      expect(f.sent).toHaveLength(repairCase.sent);
      expect(await f.snapshot()).toEqual(before);
      expect(await reapDrainedTombstones(f.db)).toBe(0);
      expect(await f.snapshot()).toEqual(before);
    } finally {
      f.client.close();
    }
  });
}

test("a DLQ intent appearing during cleanup fences later deletes and the Group signer", async () => {
  const f = await fixture("group");
  try {
    await f.db.delete(deliveryQueue);
    await f.db.run(
      sql.raw(`
      CREATE TRIGGER retain_dlq_during_reap
      BEFORE DELETE ON notification_push_jobs
      WHEN OLD.id = 'delete-projection'
      BEGIN
        INSERT INTO delivery_queue (
          id, activity_ap_id, inbox_url, status, dlq_pending,
          reconcile_attempt, next_attempt_at, created_at
        ) VALUES (
          'delete-job', OLD.activity_ap_id, 'https://remote.test/inbox',
          'dead_letter', 1, 0, '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z'
        );
      END
    `),
    );
    expect(await reapDrainedTombstones(f.db)).toBe(0);
    expect(await f.signerRow()).toMatchObject({
      privateKeyPem: "FIXTURE-PRIVATE",
    });
    expect((await f.snapshot()).activities).toHaveLength(1);
    expect((await f.snapshot()).jobs).toMatchObject([
      { id: "delete-job", status: "dead_letter", dlqPending: 1 },
    ]);
    await f.db.run(sql`DROP TRIGGER retain_dlq_during_reap`);
    await f.db
      .update(deliveryQueue)
      .set({ dlqPending: 0 })
      .where(eq(deliveryQueue.id, "delete-job"));
    expect(await reapDrainedTombstones(f.db)).toBe(1);
    expect(await f.signerRow()).toMatchObject({ privateKeyPem: "" });
  } finally {
    f.client.close();
  }
});
