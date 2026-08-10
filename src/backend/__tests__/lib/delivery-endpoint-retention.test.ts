import { expect, test } from "bun:test";
import { and, inArray, lte } from "drizzle-orm";

import {
  deliveryQueue,
  insertMany,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import { enqueuePendingDeliveryEndpointJobs } from "../../lib/delivery/queue.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

test("endpoint retention purges only 50 old terminal jobs per sweep without Queue bindings", async () => {
  const { db } = await createTestDb();
  const now = new Date("2026-08-10T08:00:00.000Z");
  const oldIso = "2026-07-01T00:00:00.000Z";
  const recentIso = "2026-08-09T00:00:00.000Z";
  const oldTerminalRows = Array.from({ length: 51 }, (_, index) => ({
    id: `old-terminal-${index}`,
    activityApId: `https://yuru.test/ap/activities/${index}`,
    inboxUrl: `https://remote-${index}.test/inbox`,
    status:
      index === 48 ? "failed" : index === 49 ? "dead_letter" : "delivered",
    createdAt: oldIso,
  }));
  await runBatch(
    db,
    insertMany(db, deliveryQueue, [
      ...oldTerminalRows,
      {
        id: "recent-terminal",
        activityApId: "https://yuru.test/ap/activities/recent",
        inboxUrl: "https://recent.remote.test/inbox",
        status: "failed",
        createdAt: recentIso,
      },
      {
        id: "old-retryable",
        activityApId: "https://yuru.test/ap/activities/retryable",
        inboxUrl: "https://retryable.remote.test/inbox",
        status: "retry_wait",
        createdAt: oldIso,
      },
    ]) as [D1Statement, ...D1Statement[]],
  );
  const env = { DB_INSTANCE: db } as unknown as Env;
  const cutoff = "2026-07-11T08:00:00.000Z";

  expect(await enqueuePendingDeliveryEndpointJobs(env, now)).toBe(0);
  expect(
    await db
      .select()
      .from(deliveryQueue)
      .where(
        and(
          inArray(deliveryQueue.status, ["delivered", "dead_letter", "failed"]),
          lte(deliveryQueue.createdAt, cutoff),
        ),
      ),
  ).toHaveLength(1);

  expect(await enqueuePendingDeliveryEndpointJobs(env, now)).toBe(0);
  expect(
    await db.select().from(deliveryQueue).orderBy(deliveryQueue.id),
  ).toMatchObject([
    { id: "old-retryable", status: "retry_wait" },
    { id: "recent-terminal", status: "failed" },
  ]);
});
