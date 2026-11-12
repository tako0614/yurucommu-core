import { expect, test } from "bun:test";
import { createTestDb, readMigration } from "../helpers/d1-semantics.ts";

test("0040 preserves existing job data and grants no inferred repair authority", async () => {
  const { client } = await createTestDb({
    through: "0039_inbound_note_update_order.sql",
  });
  try {
    await client.execute(
      "INSERT INTO delivery_queue (id,activity_ap_id,inbox_url,status,attempts,reconcile_attempt,dlq_pending,error) VALUES ('legacy','https://local.test/activity','https://remote.test/inbox','dead_letter',8,5,1,'preserve-original')",
    );
    await client.execute(
      "INSERT INTO delivery_endpoint_recipients(delivery_job_id,recipient_actor_ap_id) VALUES ('legacy','https://remote.test/actor')",
    );
    const before = await client.execute(
      "SELECT id,activity_ap_id,inbox_url,status,attempts,reconcile_attempt,dlq_pending,error,created_at FROM delivery_queue",
    );
    const recipients = await client.execute(
      "SELECT * FROM delivery_endpoint_recipients",
    );
    await client.executeMultiple(
      await readMigration("0040_delivery_endpoint_recovery.sql"),
    );
    expect(
      (
        await client.execute(
          "SELECT id,activity_ap_id,inbox_url,status,attempts,reconcile_attempt,dlq_pending,error,created_at FROM delivery_queue",
        )
      ).rows,
    ).toEqual(before.rows);
    expect(
      (await client.execute("SELECT * FROM delivery_endpoint_recipients")).rows,
    ).toEqual(recipients.rows);
    expect(
      (
        await client.execute(
          "SELECT endpoint_recovery_pending,endpoint_recovery_generation,endpoint_recovery_cursor,endpoint_recovery_attempts FROM delivery_queue",
        )
      ).rows,
    ).toMatchObject([
      {
        endpoint_recovery_pending: 0,
        endpoint_recovery_generation: null,
        endpoint_recovery_cursor: null,
        endpoint_recovery_attempts: 0,
      },
    ]);
    expect(
      (
        await client.execute(
          "SELECT name FROM sqlite_master WHERE name='delivery_queue_endpoint_recovery_due_idx'",
        )
      ).rows,
    ).toHaveLength(1);
    expect((await client.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  } finally {
    client.close();
  }
});
