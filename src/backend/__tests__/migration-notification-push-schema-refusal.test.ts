import { expect, test } from "bun:test";
import {
  createTestDb,
  listMigrationFiles,
  readMigration,
} from "./helpers/d1-semantics.ts";

const REPAIR = "0036_notification_push_actor_fk_repair.sql";
const LAST_BASELINE = "0035_published_media_deletion_claims.sql";
const MIGRATION_LEDGER = "yurucommu_migrations";

type TestClient = Awaited<ReturnType<typeof createTestDb>>["client"];
type Scenario = {
  readonly name: string;
  readonly customize0019?: boolean;
  readonly customize?: (client: TestClient) => Promise<void>;
  readonly dependentChild?: boolean;
  readonly mixedCaseIncomingFk?: boolean;
};

const scenarios: readonly Scenario[] = [
  {
    name: "generated push-table column",
    customize: (client) =>
      client.executeMultiple(
        "ALTER TABLE notification_pushers ADD COLUMN extension_generated TEXT GENERATED ALWAYS AS (pushkey || '-derived') VIRTUAL;",
      ),
  },
  {
    name: "customized current 0019 default",
    customize0019: true,
  },
  {
    name: "custom push-table index",
    customize: (client) =>
      client.executeMultiple(
        "CREATE INDEX notification_pushers_custom_idx ON notification_pushers(device_display_name);",
      ),
  },
  {
    name: "changed existing trigger body",
    customize: (client) =>
      client.executeMultiple(`
        DROP TRIGGER notification_push_jobs_after_inbox_delete;
        CREATE TRIGGER notification_push_jobs_after_inbox_delete
        AFTER DELETE ON inbox
        BEGIN
          SELECT 1;
        END;
      `),
  },
  {
    name: "dependent view over a push table",
    customize: (client) =>
      client.executeMultiple(
        "CREATE VIEW custom_notification_push_view AS SELECT id, actor_ap_id FROM notification_pushers;",
      ),
  },
  {
    name: "inbound cascading foreign key and dependent child row",
    dependentChild: true,
    customize: (client) =>
      client.executeMultiple(`
        CREATE TABLE custom_notification_push_child (
          id TEXT PRIMARY KEY,
          pusher_id TEXT NOT NULL REFERENCES notification_pushers(id) ON DELETE CASCADE
        );
        INSERT INTO custom_notification_push_child (id, pusher_id)
        VALUES ('child-row', 'schema-refusal-pusher');
      `),
  },
  {
    name: "case-insensitive mixed-case inbound foreign key and dependent child row",
    dependentChild: true,
    mixedCaseIncomingFk: true,
    customize: async (client) => {
      await client.executeMultiple(`
        CREATE TABLE custom_notification_push_child (
          id TEXT PRIMARY KEY,
          pusher_id TEXT NOT NULL REFERENCES "Notification_Pushers"(id) ON DELETE CASCADE
        );
        INSERT INTO custom_notification_push_child (id, pusher_id)
        VALUES ('mixed-case-child-row', 'schema-refusal-pusher');
      `);
    },
  },
];

async function createBaseline(scenario: Scenario): Promise<{
  readonly client: TestClient;
  readonly applied: readonly string[];
}> {
  const { client } = await createTestDb({ migrate: false });
  const applied: string[] = [];
  for (const file of await listMigrationFiles()) {
    if (file > LAST_BASELINE) break;
    let sql = await readMigration(file);
    if (
      file === "0019_notification_push_delivery.sql" &&
      scenario.customize0019
    ) {
      const canonical = "kind TEXT NOT NULL DEFAULT 'http'";
      expect(sql).toContain(canonical);
      sql = sql.replace(canonical, "kind TEXT NOT NULL DEFAULT 'custom-http'");
    }
    await client.executeMultiple(sql);
    applied.push(file);
  }

  await client.executeMultiple(`
    CREATE TABLE ${MIGRATION_LEDGER} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);
  for (const name of applied) {
    await client.execute({
      sql: `INSERT INTO ${MIGRATION_LEDGER} (name) VALUES (?)`,
      args: [name],
    });
  }

  await client.execute({
    sql: `INSERT INTO notification_pushers (
      id, actor_ap_id, product, app_id, pushkey, pushkey_hash,
      device_display_name, data_json, gateway_url, created_at, updated_at, last_seen_at
    ) VALUES ('schema-refusal-pusher', 'https://example.test/actor', 'takos',
      'app', 'synthetic-opaque-pushkey', 'synthetic-hash', 'device',
      '{"opaque":true}', 'https://gateway.invalid/push', '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z',
      '2025-01-03T00:00:00Z')`,
  });
  await client.execute({
    sql: `INSERT INTO notification_push_jobs (
      id, actor_ap_id, activity_ap_id, status, attempts, pending_pusher_ids_json,
      next_attempt_at, last_error, created_at, updated_at
    ) VALUES ('schema-refusal-job', 'https://example.test/actor',
      'https://example.test/activity', 'retry_wait', 4, '["schema-refusal-pusher"]',
      '2025-02-01T00:00:00Z', 'preserve-me', '2025-01-01T00:00:00Z',
      '2025-01-02T00:00:00Z')`,
  });

  await scenario.customize?.(client);
  return { client, applied };
}

async function snapshot(client: TestClient, hasDependentChild: boolean) {
  return {
    schema: (
      await client.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name",
      )
    ).rows,
    pushers: (
      await client.execute("SELECT * FROM notification_pushers ORDER BY id")
    ).rows,
    jobs: (
      await client.execute("SELECT * FROM notification_push_jobs ORDER BY id")
    ).rows,
    ledger: (
      await client.execute(
        `SELECT id, name, applied_at FROM ${MIGRATION_LEDGER} ORDER BY id`,
      )
    ).rows,
    child: hasDependentChild
      ? (
          await client.execute(
            "SELECT id, pusher_id FROM custom_notification_push_child ORDER BY id",
          )
        ).rows
      : undefined,
  };
}

async function applyRepairWithLedger(client: TestClient): Promise<void> {
  const sql = await readMigration(REPAIR);
  try {
    await client.executeMultiple(`
      BEGIN;
      ${sql}
      INSERT INTO ${MIGRATION_LEDGER} (name) VALUES ('${REPAIR}');
      COMMIT;
    `);
  } catch (error) {
    // A rejected shape guard is expected to roll back the migration and its
    // ledger mark together. Explicit rollback also closes libsql's open tx.
    try {
      await client.executeMultiple("ROLLBACK;");
    } catch {
      // SQLite may already have rolled the script back on the failed statement.
    }
    throw error;
  }
}

for (const scenario of scenarios) {
  test(`0036 refuses ${scenario.name} before changing schema or data`, async () => {
    const { client, applied } = await createBaseline(scenario);
    expect(applied.at(-1)).toBe(LAST_BASELINE);
    if (scenario.mixedCaseIncomingFk) {
      const fk = await client.execute(
        "PRAGMA foreign_key_list(custom_notification_push_child)",
      );
      expect(fk.rows).toHaveLength(1);
      expect(fk.rows[0]?.table).toBe("Notification_Pushers");
    }
    const before = await snapshot(client, scenario.dependentChild === true);

    await expect(applyRepairWithLedger(client)).rejects.toThrow(
      /CHECK constraint failed: supported = 1/i,
    );

    const after = await snapshot(client, scenario.dependentChild === true);
    expect(after).toEqual(before);
    const repairArtifacts = await client.execute(
      `SELECT name FROM sqlite_master
       WHERE name LIKE 'notification_push_repair_%'
          OR name LIKE 'notification_pushers_repair_0036'
          OR name LIKE 'notification_push_jobs_repair_0036'`,
    );
    expect(repairArtifacts.rows).toEqual([]);
    expect(
      (
        await client.execute({
          sql: `SELECT COUNT(*) AS n FROM ${MIGRATION_LEDGER} WHERE name = ?`,
          args: [REPAIR],
        })
      ).rows[0]?.n,
    ).toBe(0);
  });
}
