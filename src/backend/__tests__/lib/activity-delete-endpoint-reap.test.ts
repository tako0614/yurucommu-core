import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  activities,
  actors,
  communities,
  deliveryQueue,
  deliveryResolutions,
  notificationPushJobs,
} from "../../../db/index.ts";
import {
  beginEndpointRecovery,
  buildEndpointRecoveryMessage,
  continueEndpointRecovery,
} from "../../lib/delivery/endpoint-recovery.ts";
import { upsertDeliveryJob } from "../../lib/delivery/queue.ts";
import { reapDrainedTombstones } from "../../routes/actors.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

async function fixture(kind: "actor" | "group") {
  const { db, client } = await createTestDb();
  const apId = `https://local.test/ap/${kind}/retired`,
    activityId = "https://local.test/ap/activities/delete",
    endpoint = "https://remote.test/inbox";
  const old = "2020-01-01T00:00:00.000Z";
  const signer = {
    apId,
    preferredUsername: "retired",
    name: "Retired local fixture",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "LOCAL-UNUSED-PUBLIC-FIXTURE",
    privateKeyPem: "LOCAL-UNUSED-PRIVATE-FIXTURE",
    deletedAt: old,
  };
  if (kind === "actor")
    await db
      .insert(actors)
      .values({ ...signer, type: "Person", followingUrl: `${apId}/following` });
  else
    await db
      .insert(communities)
      .values({ ...signer, createdBy: "https://local.test/ap/users/owner" });
  await db.insert(activities).values({
    apId: activityId,
    type: "Delete",
    actorApId: apId,
    objectApId: apId,
    rawJson: "{}",
    direction: "outbound",
  });
  await upsertDeliveryJob(db, "recovery-owner", activityId, endpoint, [
    "https://remote.test/users/intended",
  ]);
  await db.update(deliveryQueue).set({
    status: "processing",
    processingToken: "local-http-claim",
    createdAt: old,
  });
  const generation = await beginEndpointRecovery(db, {
    jobId: "recovery-owner",
    activityId,
    endpoint,
    processingToken: "local-http-claim",
  });
  // Durable HTTP410 verdict; no real peer receives a request in this fixture.
  await db
    .update(deliveryQueue)
    .set({ status: "failed", processingToken: null, dlqPending: 0 });
  await db.insert(notificationPushJobs).values({
    id: "projection",
    actorApId: apId,
    activityApId: activityId,
    status: "delivered",
  });
  const env = {
    APP_URL: "https://local.test",
    DB_INSTANCE: db,
  } as unknown as Env;
  const signerRow = () =>
    kind === "actor"
      ? db.select().from(actors).get()
      : db.select().from(communities).get();
  const snapshot = async () => ({
    signer: await signerRow(),
    activities: await db.select().from(activities),
    jobs: await db.select().from(deliveryQueue),
    projections: await db.select().from(notificationPushJobs),
  });
  return {
    db,
    client,
    env,
    activityId,
    generation: generation!,
    signerRow,
    snapshot,
  };
}

for (const kind of ["actor", "group"] as const) {
  test(`${kind} retains Delete and signer across endpoint recovery outage, then resumes normal reap`, async () => {
    const f = await fixture(kind);
    try {
      const msg = buildEndpointRecoveryMessage("recovery-owner", f.generation);
      await f.db.run(
        sql`ALTER TABLE blocked_domains RENAME TO local_saved_blocked_domains`,
      );
      await expect(
        continueEndpointRecovery(f.db, f.env, msg),
      ).rejects.toThrow();
      const retained = await f.snapshot();
      expect(retained.jobs).toMatchObject([
        {
          status: "failed",
          dlqPending: 0,
          endpointRecoveryPending: 1,
          endpointRecoveryCursor: null,
        },
      ]);
      expect(await f.db.select().from(deliveryResolutions)).toHaveLength(0);
      expect(await reapDrainedTombstones(f.db)).toBe(0);
      expect(await f.snapshot()).toEqual(retained);
      await f.db.run(
        sql`ALTER TABLE local_saved_blocked_domains RENAME TO blocked_domains`,
      );
      await f.db
        .update(deliveryQueue)
        .set({ endpointRecoveryNextAttemptAt: "2020-01-01T00:00:00.000Z" });
      expect(await continueEndpointRecovery(f.db, f.env, msg)).toBe(1);
      expect(await reapDrainedTombstones(f.db)).toBe(0);
      // Isolated completion fact, not a claim of remote delivery qualification.
      await f.db.update(deliveryResolutions).set({ status: "resolved" });
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

test("a recovery marker appearing during Group cleanup fences the later cascade and signer", async () => {
  const f = await fixture("group");
  try {
    await f.db.delete(deliveryQueue);
    await f.db
      .run(sql`CREATE TRIGGER local_recovery_during_reap BEFORE DELETE ON notification_push_jobs WHEN OLD.id='projection' BEGIN
      INSERT INTO delivery_queue(id,activity_ap_id,inbox_url,status,dlq_pending,endpoint_recovery_pending,endpoint_recovery_generation,endpoint_recovery_next_attempt_at)
      VALUES ('late-repair',OLD.activity_ap_id,'https://remote.test/inbox','failed',0,1,'local-existing-repair','2020-01-01T00:00:00.000Z'); END`);
    expect(await reapDrainedTombstones(f.db)).toBe(0);
    expect(await f.signerRow()).toMatchObject({
      privateKeyPem: "LOCAL-UNUSED-PRIVATE-FIXTURE",
    });
    expect((await f.snapshot()).activities).toHaveLength(1);
    expect((await f.snapshot()).jobs).toMatchObject([
      { endpointRecoveryPending: 1 },
    ]);
    await f.db.run(sql`DROP TRIGGER local_recovery_during_reap`);
    await f.db.update(deliveryQueue).set({ endpointRecoveryPending: 0 });
    expect(await reapDrainedTombstones(f.db)).toBe(1);
    expect(await f.signerRow()).toMatchObject({ privateKeyPem: "" });
  } finally {
    f.client.close();
  }
});
