import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyMigrations,
  buildSqlCommandArgs,
} from "../scripts/apply-takosumi-migrations.ts";

test("app activation applies only migrations missing from yurucommu_migrations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-app-activate-"));
  const calls: Array<{ purpose: string; migration?: string; sql: string }> = [];
  const applied = new Set(["0001_done.sql"]);
  try {
    await writeFile(join(dir, "0001_done.sql"), "CREATE TABLE done (id TEXT);");
    await writeFile(
      join(dir, "0002_next.sql"),
      "ALTER TABLE done ADD COLUMN name TEXT;",
    );

    const result = await applyMigrations({
      resource: "database",
      migrationsDir: dir,
      sqlCommand: ["unused"],
      executeSql: async (sql, context) => {
        calls.push({ ...context, sql });
        if (context.purpose === "ledger-read") {
          return { rows: [...applied].map((name) => ({ name })) };
        }
        if (context.purpose === "migration") {
          expect(applied.has(context.migration!)).toBe(false);
          expect(sql).toContain("ALTER TABLE done ADD COLUMN name TEXT;");
          expect(sql).toContain(
            "CREATE TABLE IF NOT EXISTS yurucommu_migrations",
          );
          expect(sql).toContain(
            "INSERT INTO yurucommu_migrations (name, applied_at) VALUES ('0002_next.sql', ",
          );
          applied.add(context.migration!);
        }
        return { rows: [] };
      },
    });

    expect(result).toEqual({
      applied: ["0002_next.sql"],
      skipped: ["0001_done.sql"],
    });
    expect(calls.map((call) => call.purpose)).toEqual([
      "ledger-init",
      "ledger-read",
      "migration",
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("app activation wraps non-transactional migrations and respects owned transactions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-app-activate-"));
  const migrationSql: string[] = [];
  try {
    await writeFile(
      join(dir, "0001_plain.sql"),
      "CREATE TABLE plain (id TEXT);",
    );
    await writeFile(
      join(dir, "0002_owned.sql"),
      "BEGIN;\nCREATE TABLE owned (id TEXT);\nCOMMIT;",
    );

    await applyMigrations({
      resource: "database",
      migrationsDir: dir,
      sqlCommand: ["unused"],
      executeSql: async (sql, context) => {
        if (context.purpose === "ledger-read") return { rows: [] };
        if (context.purpose === "migration") migrationSql.push(sql);
        return { rows: [] };
      },
    });

    expect(
      migrationSql[0]!.startsWith(
        "BEGIN;\nCREATE TABLE IF NOT EXISTS yurucommu_migrations",
      ),
    ).toBe(true);
    expect(migrationSql[0]).toContain("CREATE TABLE plain");
    expect(migrationSql[0]).toContain("COMMIT;");
    expect(
      migrationSql[1]!.startsWith(
        "CREATE TABLE IF NOT EXISTS yurucommu_migrations",
      ),
    ).toBe(true);
    expect(migrationSql[1]).toContain("BEGIN;\nCREATE TABLE owned");
    expect(migrationSql[1]).not.toContain("BEGIN;\nBEGIN;");
    expect(migrationSql[1]).toContain(
      "INSERT INTO yurucommu_migrations (name, applied_at) VALUES ('0002_owned.sql', ",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("app activation can disable transaction wrappers for remote D1 execution", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-app-activate-"));
  const migrationSql: string[] = [];
  try {
    await writeFile(
      join(dir, "0001_plain.sql"),
      "CREATE TABLE plain (id TEXT);",
    );

    await applyMigrations({
      resource: "database",
      migrationsDir: dir,
      sqlCommand: ["unused"],
      wrapTransactions: false,
      executeSql: async (sql, context) => {
        if (context.purpose === "ledger-read") return { rows: [] };
        if (context.purpose === "migration") migrationSql.push(sql);
        return { rows: [] };
      },
    });

    expect(migrationSql[0]).toContain("CREATE TABLE plain");
    expect(migrationSql[0]).not.toContain("BEGIN;");
    expect(migrationSql[0]).not.toContain("COMMIT;");
    expect(migrationSql[0]).toContain(
      "INSERT INTO yurucommu_migrations (name, applied_at) VALUES ('0001_plain.sql', ",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("app activation batches sql-file command template migrations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-app-activate-"));
  const migrationSql: string[] = [];
  try {
    await writeFile(
      join(dir, "0001_plain.sql"),
      "CREATE TABLE plain (id TEXT);",
    );
    await writeFile(
      join(dir, "0002_next.sql"),
      "ALTER TABLE plain ADD COLUMN name TEXT;",
    );

    const result = await applyMigrations({
      resource: "database",
      migrationsDir: dir,
      sqlCommandTemplate: ["bunx", "wrangler", "{sql_file}"],
      executeSql: async (sql, context) => {
        if (context.purpose === "ledger-read") return { rows: [] };
        if (context.purpose === "migration") migrationSql.push(sql);
        return { rows: [] };
      },
    });

    expect(result).toEqual({
      applied: ["0001_plain.sql", "0002_next.sql"],
      skipped: [],
    });
    expect(migrationSql).toHaveLength(1);
    expect(migrationSql[0]).toContain("-- yurucommu migration: 0001_plain.sql");
    expect(migrationSql[0]).toContain("-- yurucommu migration: 0002_next.sql");
    expect(migrationSql[0]).toContain("CREATE TABLE plain");
    expect(migrationSql[0]).toContain("ALTER TABLE plain ADD COLUMN name TEXT");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("app activation treats wrangler JSON failures as SQL failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-app-activate-"));
  try {
    const statePath = join(dir, "calls.json");
    const commandPath = join(dir, "fake-wrangler.mjs");
    await writeFile(
      join(dir, "0001_plain.sql"),
      "CREATE TABLE plain (id TEXT);",
    );
    await writeFile(
      commandPath,
      [
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
        `const statePath = ${JSON.stringify(statePath)};`,
        "const calls = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : 0;",
        "const next = calls + 1;",
        "writeFileSync(statePath, JSON.stringify(next));",
        "if (next < 3) {",
        "  console.log(JSON.stringify([{ results: [], success: true }]));",
        "} else {",
        "  console.log('├ Checking if file needs uploading');",
        "  console.log(JSON.stringify([{ success: false, error: { text: 'no such table: main.objects' } }]));",
        "}",
      ].join("\n"),
    );

    await expect(
      applyMigrations({
        resource: "database",
        migrationsDir: dir,
        sqlCommandTemplate: ["bun", commandPath, "{sql_file}"],
        retryAttempts: 1,
        wrapTransactions: false,
      }),
    ).rejects.toThrow(/no such table: main\.objects/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("app activation retries transient D1 schema failures", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-app-activate-"));
  try {
    const statePath = join(dir, "calls.json");
    const commandPath = join(dir, "fake-wrangler.mjs");
    await writeFile(
      join(dir, "0001_plain.sql"),
      "CREATE TABLE plain (id TEXT);",
    );
    await writeFile(
      commandPath,
      [
        "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
        `const statePath = ${JSON.stringify(statePath)};`,
        "const calls = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : 0;",
        "const next = calls + 1;",
        "writeFileSync(statePath, JSON.stringify(next));",
        "if (next === 3) {",
        "  console.log(JSON.stringify([{ success: false, error: { text: 'no such table: actors: SQLITE_ERROR' } }]));",
        "} else {",
        "  console.log(JSON.stringify([{ results: [], success: true }]));",
        "}",
      ].join("\n"),
    );

    const result = await applyMigrations({
      resource: "database",
      migrationsDir: dir,
      sqlCommandTemplate: ["bun", commandPath, "{sql_file}"],
      retryAttempts: 2,
      retryDelayMs: 0,
      batchPendingMigrations: false,
      wrapTransactions: false,
    });

    expect(result).toEqual({
      applied: ["0001_plain.sql"],
      skipped: [],
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("app activation builds operator-provided SQL command templates", () => {
  expect(
    buildSqlCommandArgs(
      {
        resource: "DB",
        sqlCommandTemplate: [
          "bunx",
          "wrangler",
          "d1",
          "execute",
          "{resource}",
          "--remote",
          "--json",
          "--file",
          "{sql_file}",
        ],
      },
      "SELECT 1",
      ".tmp/yurucommu.sql",
    ),
  ).toEqual([
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--remote",
    "--json",
    "--file",
    ".tmp/yurucommu.sql",
  ]);

  expect(
    buildSqlCommandArgs(
      {
        resource: "DB",
        sqlCommandTemplate: [
          "bunx",
          "wrangler",
          "d1",
          "execute",
          "{resource}",
          "--remote",
          "--json",
          "--command={sql}",
        ],
      },
      "-- comment\nSELECT 1",
    ).at(-1),
  ).toBe("--command=-- comment\nSELECT 1");
});

test("app activation fails closed when sql_file templates are built without a file", () => {
  expect(() =>
    buildSqlCommandArgs(
      {
        resource: "DB",
        sqlCommandTemplate: [
          "wrangler",
          "d1",
          "execute",
          "DB",
          "--file",
          "{sql_file}",
        ],
      },
      "SELECT 1",
    ),
  ).toThrow("{sql_file}");
});

test("app activation fails closed without an operator SQL command", () => {
  expect(() =>
    buildSqlCommandArgs({ resource: "database" }, "SELECT 1"),
  ).toThrow("No SQL command configured");
});
