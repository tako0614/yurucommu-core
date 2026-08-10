import { expect, test } from "bun:test";
import type {
  ExecutionContext,
  ScheduledController,
} from "@cloudflare/workers-types";

import worker, {
  runYurucommuRetention,
  YurucommuRetentionError,
} from "../public.ts";
import { deliveryFanouts } from "../../db/index.ts";
import { persistDeliveryFanoutJob } from "../lib/delivery/fanout-outbox.ts";
import type { DeliveryQueueMessageV1 } from "../lib/delivery/types.ts";
import type { IQueueProducer } from "../runtime/queue.ts";
import type { Env } from "../types.ts";
import { createTestDb } from "./helpers/d1-semantics.ts";

test("one bounded retention pass reuses the canonical empty-ledger cleanup paths", async () => {
  const { db } = await createTestDb();

  await expect(
    runYurucommuRetention({ DB_INSTANCE: db } as Env),
  ).resolves.toEqual({
    expiredStories: 0,
    reapedTombstones: 0,
    reapedRemoteActorFetchFailures: 0,
    mirroredStampAssets: 0,
    enqueuedDeliveryFanoutJobs: 0,
    enqueuedDeliveryEndpointJobs: 0,
    enqueuedDeliveryResolutionJobs: 0,
    enqueuedNotificationPushJobs: 0,
  });
});

test("scheduled retention republishes a durable fanout after Queue recovery", async () => {
  const { db } = await createTestDb();
  const activityId = "https://yuru.test/ap/activities/retention-fanout";
  const followeeApId = "https://yuru.test/ap/users/alice";
  await persistDeliveryFanoutJob(db, {
    kind: "followers",
    activityId,
    targetApId: followeeApId,
  });

  const sent: DeliveryQueueMessageV1[] = [];
  const queue: IQueueProducer<DeliveryQueueMessageV1> = {
    async send(body) {
      sent.push(body);
    },
    async sendBatch(messages) {
      sent.push(...messages.map((message) => message.body));
    },
  };

  const result = await runYurucommuRetention({
    APP_URL: "https://yuru.test",
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue as never,
  } as unknown as Env);

  expect(result.enqueuedDeliveryFanoutJobs).toBe(1);
  expect(sent).toEqual([
    expect.objectContaining({
      type: "fanout_followers",
      activityId,
      followeeApId,
    }),
  ]);
  expect(await db.select().from(deliveryFanouts).get()).toMatchObject({
    status: "published",
    publications: 1,
  });
});

test("retention fails closed when its database authority is missing", async () => {
  await expect(runYurucommuRetention({} as Env)).rejects.toThrow(
    "Yurucommu retention requires DB_INSTANCE",
  );
});

test("retention reports and rethrows the exact failing step", async () => {
  const invalidDatabase = {} as Env["DB_INSTANCE"];

  try {
    await runYurucommuRetention({
      DB_INSTANCE: invalidDatabase,
    } as Env);
    throw new Error("expected retention to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(YurucommuRetentionError);
    expect(error).toMatchObject({
      name: "YurucommuRetentionError",
      step: "expired_stories",
    });
    expect((error as YurucommuRetentionError).cause).toBeInstanceOf(TypeError);
  }
});

test("published Worker default exposes the scheduled retention handler", () => {
  expect(typeof worker.scheduled).toBe("function");
});

test("scheduled accepts the materialized runtime used by product wrappers", async () => {
  const { db } = await createTestDb();

  await expect(
    worker.scheduled(
      {} as ScheduledController,
      { DB_INSTANCE: db } as Env,
      {} as ExecutionContext,
    ),
  ).resolves.toBeUndefined();
});
