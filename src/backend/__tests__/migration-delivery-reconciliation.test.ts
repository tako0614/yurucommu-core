import { expect, test } from "bun:test";
import { deliveryQueue } from "../../db/index.ts";
import { upsertDeliveryJob } from "../lib/delivery/queue.ts";
import { createTestDb, readMigration } from "./helpers/d1-semantics.ts";

test("0033 retains legacy delivery history and exhausts only its unknown additional reconcile budget", async () => {
  const { client, db } = await createTestDb({
    through: "0032_outbox_revocations.sql",
  });
  for (const status of [
    "pending",
    "retry_wait",
    "processing",
    "dead_letter",
    "failed",
    "delivered",
  ]) {
    await client.execute({
      sql: "INSERT INTO delivery_queue (id, activity_ap_id, inbox_url, status, attempts, next_attempt_at) VALUES (?, ?, 'https://remote.example/inbox', ?, 7, '2026-01-01T00:00:00.000Z')",
      args: [status, `https://local.example/activities/${status}`, status],
    });
  }
  await client.execute(
    "INSERT INTO delivery_endpoint_recipients (delivery_job_id, recipient_actor_ap_id) VALUES ('pending', 'https://remote.example/actor')",
  );
  const before = await client.execute(
    "SELECT * FROM delivery_queue ORDER BY id",
  );
  const recipients = await client.execute(
    "SELECT * FROM delivery_endpoint_recipients",
  );
  await client.executeMultiple(
    await readMigration("0033_delivery_reconciliation.sql"),
  );
  const after = await client.execute(
    "SELECT * FROM delivery_queue ORDER BY id",
  );
  expect(
    after.rows.map(
      ({ reconcile_attempt, dlq_pending, processing_token, ...row }) => row,
    ),
  ).toEqual(before.rows);
  for (const row of after.rows) {
    expect(row.reconcile_attempt).toBe(5);
    expect(row.dlq_pending).toBe(0);
    expect(row.processing_token).toBeNull();
  }
  expect(
    (await client.execute("SELECT * FROM delivery_endpoint_recipients")).rows,
  ).toEqual(recipients.rows);
  expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  expect(
    await upsertDeliveryJob(
      db,
      "new-job",
      "https://local.example/new-activity",
      "https://remote.example/inbox",
      ["https://remote.example/actor"],
    ),
  ).toBe(true);
  expect(
    (await db.select().from(deliveryQueue)).find((row) => row.id === "new-job"),
  ).toMatchObject({ reconcileAttempt: 0, dlqPending: 0, status: "pending" });
  // Re-materialization does not grant a fresh budget to legacy conflicts.
  expect(
    await upsertDeliveryJob(
      db,
      "pending",
      "https://local.example/activities/pending",
      "https://remote.example/inbox",
      ["https://remote.example/actor"],
    ),
  ).toBe(true);
  expect(
    (await db.select().from(deliveryQueue)).find((row) => row.id === "pending")
      ?.reconcileAttempt,
  ).toBe(5);
  const plan = await client.execute(
    "EXPLAIN QUERY PLAN SELECT id FROM delivery_queue WHERE status = 'dead_letter' AND dlq_pending = 1 AND next_attempt_at <= '2026-10-04T00:00:00.000Z' ORDER BY next_attempt_at LIMIT 50",
  );
  expect(plan.rows.some((row) => String(row.detail).includes("INDEX"))).toBe(
    true,
  );
});
