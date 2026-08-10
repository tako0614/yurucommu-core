import { expect, test } from "bun:test";
import type {
  ExecutionContext,
  ScheduledController,
} from "@cloudflare/workers-types";

import worker, {
  runYurucommuRetention,
  YurucommuRetentionError,
} from "../public.ts";
import type { Env } from "../types.ts";
import { createTestDb } from "./helpers/d1-semantics.ts";

test("one bounded retention pass reuses the canonical empty-ledger cleanup paths", async () => {
  const { db } = await createTestDb();

  await expect(
    runYurucommuRetention({ DB_INSTANCE: db } as Env),
  ).resolves.toEqual({
    expiredStories: 0,
    reapedTombstones: 0,
    enqueuedDeliveryEndpointJobs: 0,
    enqueuedDeliveryResolutionJobs: 0,
    enqueuedNotificationPushJobs: 0,
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
