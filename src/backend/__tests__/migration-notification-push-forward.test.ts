import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  createTestDb,
  listMigrationFiles,
  readMigration,
} from "./helpers/d1-semantics.ts";

const HISTORICAL_0019 = new URL(
  "./fixtures/core-3.2.0-0019_notification_push_delivery.sql",
  import.meta.url,
);
const REPAIR_MIGRATION = "0036_notification_push_actor_fk_repair.sql";
const REPAIR_AFTER = "0035_published_media_deletion_claims.sql";
const ACTOR = "https://local.example/ap/users/alice";
const OTHER_ACTOR = "https://local.example/ap/users/bob";
const MISSING_ACTOR = "https://old.example/ap/users/missing";

const JOB_STATUSES = [
  "pending",
  "queued",
  "retry_wait",
  "processing",
  "delivered",
  "failed",
  "legacy_unknown_status",
] as const;

async function applyThroughHistorical0019(
  client: Awaited<ReturnType<typeof createTestDb>>["client"],
): Promise<void> {
  for (const file of await listMigrationFiles()) {
    if (file >= "0019_notification_push_delivery.sql") break;
    await client.executeMultiple(await readMigration(file));
  }
  await client.executeMultiple(await readFile(HISTORICAL_0019, "utf8"));
}

async function applyExistingPost0019(
  client: Parameters<typeof applyThroughHistorical0019>[0],
) {
  for (const file of await listMigrationFiles()) {
    if (file > "0019_notification_push_delivery.sql" && file <= REPAIR_AFTER) {
      await client.executeMultiple(await readMigration(file));
    }
  }
}

async function applyForwardRepair(
  client: Parameters<typeof applyThroughHistorical0019>[0],
) {
  const files = (await listMigrationFiles()).filter(
    (file) => file >= REPAIR_MIGRATION,
  );
  // On a checkout before 0036 lands this intentionally does nothing. The
  // baseline assertions still exercise the old FK and trigger behavior.
  for (const file of files) {
    await client.executeMultiple(await readMigration(file));
  }
}

async function seedActor(
  client: Parameters<typeof applyThroughHistorical0019>[0],
  apId: string,
  username: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO actors (
      ap_id, type, preferred_username, inbox, outbox, followers_url,
      following_url, public_key_pem, private_key_pem
    ) VALUES (?, 'Person', ?, 'inbox', 'outbox', 'followers', 'following', 'public', 'private')`,
    args: [apId, username],
  });
}

async function seedPushRows(
  client: Parameters<typeof applyThroughHistorical0019>[0],
) {
  const timestamps = [
    "2025-01-02T03:04:05.006Z",
    "2025-02-03T04:05:06.007Z",
    "2025-03-04T05:06:07.008Z",
  ];
  for (let index = 0; index < JOB_STATUSES.length; index += 1) {
    const status = JOB_STATUSES[index]!;
    const id = `job-${status}`;
    await client.execute({
      sql: `INSERT INTO notification_push_jobs (
        id, actor_ap_id, activity_ap_id, product, status, processing_token,
        attempts, pending_pusher_ids_json, next_attempt_at, last_error,
        created_at, updated_at, delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        ACTOR,
        `https://local.example/ap/activities/${index}`,
        index % 2 === 0 ? "takos" : null,
        status,
        status === "processing" ? "opaque-processing-lease" : null,
        11 + index,
        JSON.stringify([`push-${index}`, "historical-pusher-id"]),
        `2025-04-0${index + 1}T06:07:08.009Z`,
        `opaque-error-${index}`,
        timestamps[0],
        timestamps[1],
        status === "delivered" ? timestamps[2] : null,
      ],
    });
  }
  await client.execute({
    sql: `INSERT INTO notification_pushers (
      id, actor_ap_id, product, scope, kind, app_id, pushkey, pushkey_hash,
      app_display_name, device_display_name, profile_tag, lang, data_json,
      gateway_url, created_at, updated_at, last_seen_at
    ) VALUES (?, ?, 'takos', NULL, 'http', 'app-main', ?, ?, NULL, 'phone', 'opaque-profile', 'ja', ?, ?, ?, ?, ?)`,
    args: [
      "pusher-primary",
      ACTOR,
      "SYNTHETIC_OPAQUE_PUSH_KEY_01",
      "sha256:synthetic-opaque-key-hash-01",
      '{"opaque":{"future":true},"nullable":null}',
      "https://gateway.example/push",
      timestamps[0],
      timestamps[1],
      timestamps[2],
    ],
  });
}

async function snapshotPushRows(
  client: Parameters<typeof applyThroughHistorical0019>[0],
) {
  return {
    pushers: await client.execute(
      "SELECT * FROM notification_pushers ORDER BY id",
    ),
    jobs: await client.execute(
      "SELECT * FROM notification_push_jobs ORDER BY id",
    ),
  };
}

function normalizeSql(sql: unknown): string {
  return String(sql).replace(/\s+/gu, " ").trim().toLowerCase();
}

async function triggerSql(
  client: Parameters<typeof applyThroughHistorical0019>[0],
) {
  const rows = await client.execute({
    sql: `SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'notification_push_jobs_after_inbox_insert',
        'notification_push_jobs_after_inbox_delete',
        'account_deletion_notification_pushers_insert',
        'account_deletion_notification_pushers_update',
        'account_deletion_notification_push_jobs_insert'
      ) ORDER BY name`,
  });
  return rows.rows.map((row) => [String(row.name), normalizeSql(row.sql)]);
}

async function pushForeignKeys(
  client: Parameters<typeof applyThroughHistorical0019>[0],
) {
  const pusher = await client.execute(
    "PRAGMA foreign_key_list(notification_pushers)",
  );
  const jobs = await client.execute(
    "PRAGMA foreign_key_list(notification_push_jobs)",
  );
  return { pusher: pusher.rows, jobs: jobs.rows };
}

test("historical 0019 FK baseline fails on missing actors and forward repair preserves every push row", async () => {
  const { client } = await createTestDb({ migrate: false });
  await applyThroughHistorical0019(client);
  await applyExistingPost0019(client);
  await seedActor(client, ACTOR, "alice");
  await seedPushRows(client);

  // Both published 0019 push tables carry actor FKs, enforced by D1.
  await expect(
    client.execute({
      sql: `INSERT INTO notification_pushers (
        id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url
      ) VALUES ('old-orphan', ?, 'takos', 'app', 'synthetic', 'old-hash', 'https://gateway.example')`,
      args: [MISSING_ACTOR],
    }),
  ).rejects.toThrow(/FOREIGN KEY/i);
  await expect(
    client.execute({
      sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('old-orphan-job', ?, 'orphan-activity')",
      args: [MISSING_ACTOR],
    }),
  ).rejects.toThrow(/FOREIGN KEY/i);
  await client.execute({
    sql: "INSERT INTO activities (ap_id, type, actor_ap_id, raw_json) VALUES ('historical-missing-inbox', 'Create', ?, '{}')",
    args: [ACTOR],
  });
  const missingActorInbox = {
    sql: "INSERT INTO inbox (actor_ap_id, activity_ap_id, read) VALUES (?, 'historical-missing-inbox', 0)",
    args: [MISSING_ACTOR],
  };
  await expect(client.execute(missingActorInbox)).rejects.toThrow(
    /FOREIGN KEY/i,
  );
  expect(
    (
      await client.execute(
        "SELECT actor_ap_id FROM inbox WHERE activity_ap_id = 'historical-missing-inbox'",
      )
    ).rows,
  ).toEqual([]);
  const oldForeignKeys = await pushForeignKeys(client);
  expect(oldForeignKeys.pusher).toHaveLength(1);
  expect(oldForeignKeys.jobs).toHaveLength(1);
  const rowsBefore = await snapshotPushRows(client);
  const triggersBefore = await triggerSql(client);
  expect(triggersBefore).toHaveLength(5);
  await applyForwardRepair(client);
  const rowsAfter = await snapshotPushRows(client);
  expect(rowsAfter.pushers.rows).toEqual(rowsBefore.pushers.rows);
  expect(rowsAfter.jobs.rows).toEqual(rowsBefore.jobs.rows);
  const repairedForeignKeys = await pushForeignKeys(client);
  expect(repairedForeignKeys.pusher).toHaveLength(0);
  expect(repairedForeignKeys.jobs).toHaveLength(0);
  expect(await triggerSql(client)).toEqual(triggersBefore);

  await client.execute(missingActorInbox);
  expect(
    (
      await client.execute(
        "SELECT actor_ap_id, status FROM notification_push_jobs WHERE activity_ap_id = 'historical-missing-inbox'",
      )
    ).rows.map((row) => ({ actor_ap_id: row.actor_ap_id, status: row.status })),
  ).toEqual([{ actor_ap_id: MISSING_ACTOR, status: "pending" }]);

  const pusherTable = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='notification_pushers'",
  );
  expect(normalizeSql(pusherTable.rows[0]?.sql)).not.toContain(
    "references actors",
  );
  const indexes = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='notification_pushers'",
  );
  const pusherIndexNames = indexes.rows.map((row) => String(row.name));
  expect(pusherIndexNames).not.toContain(
    "notification_pushers_actor_product_app_pushkey_idx",
  );
  expect(pusherIndexNames).toContain("notification_pushers_device_idx");
  await expect(
    client.execute({
      sql: `INSERT INTO notification_pushers (
        id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url
      ) VALUES ('same-device-conflict', ?, 'takos', 'app-main', 'other-synthetic-key', 'sha256:synthetic-opaque-key-hash-01', 'https://gateway.example')`,
      args: [OTHER_ACTOR],
    }),
  ).rejects.toThrow(/unique/i);
  await client.execute({
    sql: `INSERT INTO notification_pushers (
      id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url
    ) VALUES ('same-key-other-product', ?, 'yurucommu', 'app-main', 'synthetic', 'sha256:synthetic-opaque-key-hash-01', 'https://gateway.example')`,
    args: [OTHER_ACTOR],
  });
  await client.execute({
    sql: `INSERT INTO notification_pushers (
      id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url
    ) VALUES ('same-key-other-app', ?, 'takos', 'app-secondary', 'synthetic', 'sha256:synthetic-opaque-key-hash-01', 'https://gateway.example')`,
    args: [OTHER_ACTOR],
  });
  await expect(
    client.execute({
      sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('duplicate-actor-activity', ?, 'https://local.example/ap/activities/0')",
      args: [ACTOR],
    }),
  ).rejects.toThrow(/unique/i);
});

test("fresh current push schema stays FK-free and keeps an orphan through forward repair", async () => {
  const { client } = await createTestDb({ migrate: false });
  for (const file of await listMigrationFiles()) {
    if (file > REPAIR_AFTER) break;
    await client.executeMultiple(await readMigration(file));
  }
  await client.execute({
    sql: `INSERT INTO notification_pushers (
      id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url,
      data_json, created_at, updated_at, last_seen_at
    ) VALUES ('current-orphan', ?, 'takos', 'app-current', 'synthetic-current-key', 'current-hash', 'https://gateway.example', '{"raw":null}', '2024-01-01T00:00:00Z', '2024-02-01T00:00:00Z', '2024-03-01T00:00:00Z')`,
    args: [MISSING_ACTOR],
  });
  await client.execute({
    sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('current-orphan-job', ?, 'current-orphan-activity')",
    args: [MISSING_ACTOR],
  });
  const before = await snapshotPushRows(client);
  await applyForwardRepair(client);
  const after = await snapshotPushRows(client);
  expect(after.pushers.rows).toEqual(before.pushers.rows);
  expect(after.jobs.rows).toEqual(before.jobs.rows);
  const table = await client.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='notification_pushers'",
  );
  expect(normalizeSql(table.rows[0]?.sql)).not.toContain("references actors");
  await client.execute({
    sql: `INSERT INTO notification_pushers (
        id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url
      ) VALUES ('fresh-orphan-2', ?, 'takos', 'app-current', 'synthetic-2', 'current-hash-2', 'https://gateway.example')`,
    args: [MISSING_ACTOR],
  });
  await client.execute({
    sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('fresh-orphan-job-2', ?, 'current-orphan-activity-2')",
    args: [MISSING_ACTOR],
  });
});

test("push inbox triggers retain unread creation and delete only retryable jobs", async () => {
  const { client } = await createTestDb({ migrate: false });
  await applyThroughHistorical0019(client);
  await applyExistingPost0019(client);
  await seedActor(client, ACTOR, "alice");
  await applyForwardRepair(client);
  await client.execute({
    sql: "INSERT INTO activities (ap_id, type, actor_ap_id, raw_json) VALUES ('activity-trigger', 'Create', ?, '{}')",
    args: [ACTOR],
  });
  await client.execute({
    sql: "INSERT INTO activities (ap_id, type, actor_ap_id, raw_json) VALUES ('activity-trigger-unread', 'Create', ?, '{}')",
    args: [ACTOR],
  });
  await client.execute({
    sql: "INSERT INTO inbox (actor_ap_id, activity_ap_id, read) VALUES (?, 'activity-trigger', 1)",
    args: [ACTOR],
  });
  expect(
    Number(
      (await client.execute("SELECT COUNT(*) AS n FROM notification_push_jobs"))
        .rows[0]?.n,
    ),
  ).toBe(0);
  await client.execute({
    sql: "INSERT INTO inbox (actor_ap_id, activity_ap_id, read) VALUES (?, 'activity-trigger-unread', 0)",
    args: [ACTOR],
  });
  expect(
    (
      await client.execute(
        "SELECT status FROM notification_push_jobs WHERE activity_ap_id = 'activity-trigger-unread'",
      )
    ).rows.map((row) => row.status),
  ).toEqual(["pending"]);
  expect(
    Number(
      (await client.execute("SELECT COUNT(*) AS n FROM notification_push_jobs"))
        .rows[0]?.n,
    ),
  ).toBe(1);
  await client.execute({
    sql: "DELETE FROM inbox WHERE actor_ap_id = ? AND activity_ap_id = 'activity-trigger-unread'",
    args: [ACTOR],
  });

  for (const status of JOB_STATUSES) {
    const id = `delete-${status}`;
    const activityId = `activity-${status}`;
    await client.execute({
      sql: "INSERT INTO activities (ap_id, type, actor_ap_id, raw_json) VALUES (?, 'Create', ?, '{}')",
      args: [activityId, ACTOR],
    });
    await client.execute({
      sql: "INSERT INTO inbox (actor_ap_id, activity_ap_id, read) VALUES (?, ?, 0)",
      args: [ACTOR, activityId],
    });
    await client.execute({
      sql: "UPDATE notification_push_jobs SET id = ?, status = ? WHERE actor_ap_id = ? AND activity_ap_id = ?",
      args: [id, status, ACTOR, activityId],
    });
    await client.execute({
      sql: "DELETE FROM inbox WHERE actor_ap_id = ? AND activity_ap_id = ?",
      args: [ACTOR, activityId],
    });
  }
  const remaining = await client.execute(
    "SELECT id FROM notification_push_jobs ORDER BY id",
  );
  expect(remaining.rows.map((row) => String(row.id))).toEqual([
    "delete-delivered",
    "delete-failed",
    "delete-legacy_unknown_status",
    "delete-processing",
  ]);
});

test("0031 push deletion reservation triggers reject unmarked writes and accept matching markers", async () => {
  const { client } = await createTestDb({ migrate: false });
  await applyThroughHistorical0019(client);
  await applyExistingPost0019(client);
  await seedActor(client, ACTOR, "alice");
  await seedActor(client, OTHER_ACTOR, "bob");
  await seedPushRows(client);
  await client.execute({
    sql: "INSERT INTO account_deletion_targets (actor_ap_id, operation_id, public_key_pem, followers_url, delete_activity_ap_id) VALUES (?, 'op-alice', 'public', 'followers', 'delete-alice')",
    args: [ACTOR],
  });
  await client.execute({
    sql: "INSERT INTO account_deletion_targets (actor_ap_id, operation_id, public_key_pem, followers_url, delete_activity_ap_id) VALUES (?, 'op-bob', 'public', 'followers', 'delete-bob')",
    args: [OTHER_ACTOR],
  });
  const reservedRowsBefore = await snapshotPushRows(client);
  await applyForwardRepair(client);
  const reservedRowsAfter = await snapshotPushRows(client);
  expect(reservedRowsAfter.pushers.rows).toEqual(
    reservedRowsBefore.pushers.rows,
  );
  expect(reservedRowsAfter.jobs.rows).toEqual(reservedRowsBefore.jobs.rows);

  const insertPusher = () =>
    client.execute({
      sql: `INSERT INTO notification_pushers (
        id, actor_ap_id, product, app_id, pushkey, pushkey_hash, gateway_url
      ) VALUES ('reserved-pusher', ?, 'takos', 'app', 'synthetic', 'reserved-hash', 'https://gateway.example')`,
      args: [ACTOR],
    });
  await expect(insertPusher()).rejects.toThrow(/account deletion reserved/i);
  await client.execute(
    "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('wrong-op', 1, 'op-other')",
  );
  await expect(insertPusher()).rejects.toThrow(/account deletion reserved/i);
  await client.execute(
    "DELETE FROM actor_write_assertions WHERE id = 'wrong-op'",
  );
  await client.execute(
    "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('right-op', 1, 'op-alice')",
  );
  await insertPusher();

  await client.execute(
    "DELETE FROM actor_write_assertions WHERE id = 'right-op'",
  );
  await expect(
    client.execute({
      sql: "UPDATE notification_pushers SET actor_ap_id = ? WHERE id = 'reserved-pusher'",
      args: [OTHER_ACTOR],
    }),
  ).rejects.toThrow(/account deletion reserved/i);
  await client.execute(
    "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('right-update', 1, 'op-alice')",
  );
  await expect(
    client.execute({
      sql: "UPDATE notification_pushers SET actor_ap_id = ? WHERE id = 'reserved-pusher'",
      args: [OTHER_ACTOR],
    }),
  ).rejects.toThrow(/account deletion reserved/i);
  await client.execute(
    "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('right-update-bob', 1, 'op-bob')",
  );
  await client.execute({
    sql: "UPDATE notification_pushers SET actor_ap_id = ? WHERE id = 'reserved-pusher'",
    args: [OTHER_ACTOR],
  });

  await client.execute(
    "DELETE FROM actor_write_assertions WHERE id IN ('right-update', 'right-update-bob')",
  );
  await expect(
    client.execute({
      sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('reserved-job', ?, 'reserved-activity')",
      args: [ACTOR],
    }),
  ).rejects.toThrow(/account deletion reserved/i);
  await expect(
    client.execute({
      sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('reserved-bob-job', ?, 'reserved-bob-activity')",
      args: [OTHER_ACTOR],
    }),
  ).rejects.toThrow(/account deletion reserved/i);
  await client.execute(
    "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('right-bob-job', 1, 'op-bob')",
  );
  await client.execute({
    sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('reserved-bob-job', ?, 'reserved-bob-activity')",
    args: [OTHER_ACTOR],
  });
  await client.execute(
    "INSERT INTO actor_write_assertions (id, witness, operation_id) VALUES ('right-job', 1, 'op-alice')",
  );
  await client.execute({
    sql: "INSERT INTO notification_push_jobs (id, actor_ap_id, activity_ap_id) VALUES ('reserved-job', ?, 'reserved-activity')",
    args: [ACTOR],
  });
});
