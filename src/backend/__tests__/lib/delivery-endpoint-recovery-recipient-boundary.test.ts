import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  activities,
  actorCache,
  blockedActors,
  deliveryEndpointRecipients,
  deliveryQueue,
  deliveryResolutions,
  insertMany,
  remoteActorTombstones,
} from "../../../db/index.ts";
import {
  enqueueResolveForEndpointActors,
  upsertDeliveryJob,
} from "../../lib/delivery/queue.ts";
import { processResolveActor } from "../../lib/delivery/queue-batching.ts";
import {
  enqueuePendingDeliveryResolutionJobs,
  persistDeliveryResolutionJobs,
} from "../../lib/delivery/resolution-outbox.ts";
import { computeDeliveryJobId } from "../../lib/delivery/transformers.ts";
import type { DeliveryQueueMessageV1 } from "../../lib/delivery/types.ts";
import type { IQueueProducer } from "../../runtime/queue.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const ACTIVITY = `${APP_URL}/ap/activities/selected`;
const ENDPOINT = "https://remote.test/shared";
const INTENDED = "https://remote.test/users/intended";
const OTHER = "https://remote.test/users/other";

async function fixture() {
  const { db, client } = await createTestDb();
  const sent: DeliveryQueueMessageV1[] = [];
  let queueFails = false;
  const queue: IQueueProducer<DeliveryQueueMessageV1> = {
    async send(body) {
      if (queueFails) throw new Error("fixture Queue unavailable");
      sent.push(body);
    },
    async sendBatch(messages) {
      if (queueFails) throw new Error("fixture Queue unavailable");
      sent.push(...messages.map((message) => message.body));
    },
  };
  const env = {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
  const seedActivity = (apId = ACTIVITY) =>
    db.insert(activities).values({
      apId,
      type: "Update",
      actorApId: `${APP_URL}/ap/users/owner`,
      direction: "outbound",
      rawJson: "{}",
    });
  await seedActivity();
  await db.insert(actorCache).values(
    [INTENDED, OTHER].map((apId) => ({
      apId,
      inbox: `${apId}/inbox`,
      sharedInbox: ENDPOINT,
      rawJson: "{}",
    })),
  );
  const retain = async (
    recipients = [INTENDED],
    activity = ACTIVITY,
    endpoint = ENDPOINT,
    id?: string,
  ) => {
    const jobId = id ?? (await computeDeliveryJobId(activity, endpoint));
    await upsertDeliveryJob(db, jobId, activity, endpoint, recipients);
    return jobId;
  };
  const recover = () =>
    enqueueResolveForEndpointActors(db, env, ACTIVITY, ENDPOINT);
  const recipientIds = async () =>
    (await db.select().from(deliveryResolutions))
      .map((row) => row.recipientActorApId)
      .sort();
  const endpointSnapshot = async () => ({
    jobs: await db.select().from(deliveryQueue),
    recipients: await db.select().from(deliveryEndpointRecipients),
    cache: await db.select().from(actorCache),
  });
  return {
    db,
    client,
    env,
    sent,
    retain,
    recover,
    recipientIds,
    seedActivity,
    endpointSnapshot,
    failQueue: (value: boolean) => {
      queueFails = value;
    },
  };
}

test("endpoint recovery never promotes a cache-only actor into a recipient", async () => {
  const f = await fixture();
  try {
    await f.retain();
    const before = await f.endpointSnapshot();
    expect(await f.recover()).toBe(1);
    expect(await f.recipientIds()).toEqual([INTENDED]);
    expect(f.sent).toMatchObject([
      { type: "resolve_actor", recipientActorApId: INTENDED },
    ]);
    expect(await f.endpointSnapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("recipient attribution is scoped to the selected Activity and endpoint", async () => {
  const f = await fixture();
  try {
    await f.retain();
    const unrelatedActivity = `${ACTIVITY}-other`;
    await f.seedActivity(unrelatedActivity);
    await f.retain([OTHER], unrelatedActivity);
    await f.retain([OTHER], ACTIVITY, "https://remote.test/other-inbox");
    expect(await f.recover()).toBe(1);
    expect(await f.recipientIds()).toEqual([INTENDED]);
  } finally {
    f.client.close();
  }
});

for (const cache of ["missing", "changed"] as const) {
  test(`a ${cache} actor cache does not erase a positively retained recipient`, async () => {
    const f = await fixture();
    try {
      await f.retain();
      if (cache === "missing") await f.db.delete(actorCache);
      else
        await f.db
          .update(actorCache)
          .set({ sharedInbox: null, inbox: "https://remote.test/new-inbox" });
      expect(await f.recover()).toBe(1);
      expect(await f.recipientIds()).toEqual([INTENDED]);
    } finally {
      f.client.close();
    }
  });
}

test("an unattributed legacy job keeps its state without inferred recipients", async () => {
  const f = await fixture();
  try {
    await f.db.insert(deliveryQueue).values({
      id: "legacy-job",
      activityApId: ACTIVITY,
      inboxUrl: ENDPOINT,
      status: "dead_letter",
      attempts: 8,
      reconcileAttempt: 5,
    });
    const before = await f.endpointSnapshot();
    expect(await f.recover()).toBe(0);
    expect(await f.recipientIds()).toEqual([]);
    expect(f.sent).toHaveLength(0);
    expect(await f.endpointSnapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("orphan attribution cannot authorize recovery without its retained endpoint job", async () => {
  const f = await fixture();
  try {
    await f.retain();
    await f.db
      .insert(deliveryEndpointRecipients)
      .values({ deliveryJobId: "missing-job", recipientActorApId: OTHER });
    expect(await f.recover()).toBe(1);
    expect(await f.recipientIds()).toEqual([INTENDED]);
  } finally {
    f.client.close();
  }
});

test("operator blocks still exclude a positively retained recipient", async () => {
  const f = await fixture();
  try {
    await f.retain([INTENDED, OTHER]);
    await f.db.insert(blockedActors).values({ actorApId: OTHER });
    const before = await f.endpointSnapshot();
    expect(await f.recover()).toBe(1);
    expect(await f.recipientIds()).toEqual([INTENDED]);
    expect(await f.endpointSnapshot()).toEqual(before);
  } finally {
    f.client.close();
  }
});

test("a strict moderation read failure retains only the original recipient intent", async () => {
  const f = await fixture();
  try {
    await f.retain();
    // This is a disposable fixture database, never an operator database.
    await f.db.run(sql`DROP TABLE blocked_domains`);
    await expect(f.recover()).rejects.toThrow();
    expect(await f.recipientIds()).toEqual([INTENDED]);
    expect(await f.db.select().from(deliveryResolutions).get()).toMatchObject({
      status: "pending",
      attempts: 0,
    });
    expect(f.sent).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a lost Queue wakeup recovers only positively attributed intent", async () => {
  const f = await fixture();
  try {
    await f.retain();
    f.failQueue(true);
    await expect(f.recover()).rejects.toThrow("fixture Queue unavailable");
    expect(await f.recipientIds()).toEqual([INTENDED]);
    expect(await f.db.select().from(deliveryResolutions).get()).toMatchObject({
      status: "pending",
    });
    f.failQueue(false);
    expect(await enqueuePendingDeliveryResolutionJobs(f.env)).toBe(1);
    expect(f.sent).toMatchObject([
      { type: "resolve_actor", recipientActorApId: INTENDED },
    ]);
  } finally {
    f.client.close();
  }
});

test("an explicit endpoint invalidation reopens the existing intended resolution once", async () => {
  const f = await fixture();
  try {
    await f.retain();
    await persistDeliveryResolutionJobs(f.db, [
      { activityId: ACTIVITY, recipientActorApId: INTENDED },
    ]);
    await f.db.update(deliveryResolutions).set({
      status: "resolved",
      attempts: 7,
      resolvedAt: "2026-01-01T00:00:00.000Z",
    });
    const original = (await f.db.select().from(deliveryResolutions).get())!;
    expect(await f.recover()).toBe(1);
    expect(await f.recipientIds()).toEqual([INTENDED]);
    expect(await f.db.select().from(deliveryResolutions).get()).toMatchObject({
      id: original.id,
      status: "queued",
      attempts: 0,
      resolvedAt: null,
    });
  } finally {
    f.client.close();
  }
});

test("a tombstoned recipient stays fenced at the existing resolution consumer", async () => {
  const f = await fixture();
  try {
    await f.retain();
    await f.recover();
    const body = f.sent.find(
      (message) =>
        message.type === "resolve_actor" &&
        message.recipientActorApId === INTENDED,
    );
    if (!body || body.type !== "resolve_actor")
      throw new Error("Missing intended wakeup");
    await f.db.insert(remoteActorTombstones).values({
      actorApId: INTENDED,
      deleteActivityApId: "https://remote.test/activities/delete",
    });
    const before = await f.endpointSnapshot();
    f.sent.length = 0;
    let acks = 0;
    await processResolveActor(f.db, f.env, body, {
      id: "local-resolution",
      body,
      timestamp: new Date(),
      attempts: 1,
      ack: () => {
        acks++;
      },
      retry: () => {
        throw new Error("Unexpected retry");
      },
    });
    expect(acks).toBe(1);
    expect(
      await f.db
        .select()
        .from(deliveryResolutions)
        .where(eq(deliveryResolutions.recipientActorApId, INTENDED))
        .get(),
    ).toMatchObject({ status: "discarded", lastError: "recipient_tombstoned" });
    expect(await f.endpointSnapshot()).toEqual(before);
    expect(f.sent).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("the recipient keyset crosses a page without duplication across retained jobs", async () => {
  const f = await fixture();
  try {
    const recipients = Array.from(
      { length: 201 },
      (_, i) =>
        `https://remote.test/users/member-${String(i).padStart(3, "0")}`,
    );
    await f.db.delete(actorCache);
    for (const statement of insertMany(
      f.db,
      actorCache,
      recipients.map((apId) => ({
        apId,
        inbox: `${apId}/inbox`,
        sharedInbox: ENDPOINT,
        rawJson: "{}",
      })),
    ))
      await statement;
    await f.retain(recipients);
    // A retained legacy alias can repeat known positive attribution. It does
    // not justify a duplicate recipient or a second resolution identity.
    await f.retain(
      recipients.slice(0, 3),
      ACTIVITY,
      ENDPOINT,
      "retained-alias-job",
    );
    expect(await f.recover()).toBe(201);
    expect(await f.recipientIds()).toEqual(recipients);
    expect(f.sent).toHaveLength(201);
  } finally {
    f.client.close();
  }
});
