import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyMigrations } from "../scripts/apply-takosumi-migrations.ts";

for (const batchPendingMigrations of [false, true]) {
  test(`activation does not replay a committed migration after response loss (batch=${batchPendingMigrations})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "yuru-migration-response-loss-"));
    try {
      const statePath = join(dir, "state.json");
      const commandPath = join(dir, "executor.mjs");
      await writeFile(
        join(dir, "0036_rebuild.sql"),
        "ALTER TABLE example ADD COLUMN restored TEXT;",
      );
      // The command's durable state models a committed schema+ledger followed
      // by lost acknowledgement. It is a command-boundary test, not D1 proof.
      await writeFile(
        commandPath,
        `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const path = ${JSON.stringify(statePath)};
const sql = readFileSync(process.argv[2], "utf8");
const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { migrationCalls: 0, committed: false, ledgerReads: 0 };
let result = [{ success: true, results: [] }];
if (sql.includes("SELECT name FROM yurucommu_migrations")) {
  state.ledgerReads += 1;
  result = [{ success: true, results: state.committed ? [{ name: "0036_rebuild.sql" }] : [] }];
} else if (sql.includes("ALTER TABLE example")) {
  state.migrationCalls += 1;
  state.committed = true;
  if (state.migrationCalls === 1) {
    result = [{ success: false, error: { text: "internal error: timeout after commit" } }];
  }
}
writeFileSync(path, JSON.stringify(state));
console.log(JSON.stringify(result));
`,
      );
      const options = {
        resource: "fixture",
        migrationsDir: dir,
        wrapTransactions: false,
        batchPendingMigrations,
        retryAttempts: 4,
        retryDelayMs: 0,
        sqlCommandTemplate: [process.execPath, commandPath, "{sql_file}"],
      };
      await expect(applyMigrations(options)).rejects.toThrow(
        "timeout after commit",
      );
      const failed = JSON.parse(await readFile(statePath, "utf8"));
      expect(failed).toMatchObject({
        migrationCalls: 1,
        committed: true,
        ledgerReads: 1,
      });
      // A separate activation must read the ledger and skip the committed file.
      expect(await applyMigrations(options)).toEqual({
        applied: [],
        skipped: ["0036_rebuild.sql"],
      });
      const resumed = JSON.parse(await readFile(statePath, "utf8"));
      expect(resumed).toMatchObject({
        migrationCalls: 1,
        committed: true,
        ledgerReads: 2,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test("ledger initialization and reads retain bounded transient retries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yuru-ledger-transient-"));
  try {
    const statePath = join(dir, "state.json");
    const commandPath = join(dir, "executor.mjs");
    await writeFile(join(dir, "0001_done.sql"), "SELECT 1;");
    await writeFile(
      commandPath,
      `
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const path = ${JSON.stringify(statePath)};
const sql = readFileSync(process.argv[2], "utf8");
const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { init: 0, read: 0 };
const phase = sql.includes("SELECT name FROM") ? "read" : "init";
state[phase] += 1;
writeFileSync(path, JSON.stringify(state));
console.log(JSON.stringify(state[phase] === 1
 ? [{ success: false, error: { text: "database is locked" } }]
 : [{ success: true, results: phase === "read" ? [{ name: "0001_done.sql" }] : [] }]));
`,
    );
    expect(
      await applyMigrations({
        resource: "fixture",
        migrationsDir: dir,
        wrapTransactions: false,
        retryAttempts: 2,
        retryDelayMs: 0,
        sqlCommandTemplate: [process.execPath, commandPath, "{sql_file}"],
      }),
    ).toEqual({ applied: [], skipped: ["0001_done.sql"] });
    expect(JSON.parse(await readFile(statePath, "utf8"))).toEqual({
      init: 2,
      read: 2,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
