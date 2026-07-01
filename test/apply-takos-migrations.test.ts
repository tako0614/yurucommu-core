import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  applyMigrations,
  buildSqlCommandArgs,
} from "../scripts/apply-takos-migrations.ts";

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

    expect(migrationSql[0]!.startsWith("BEGIN;\nCREATE TABLE plain")).toBe(
      true,
    );
    expect(migrationSql[0]).toContain("COMMIT;");
    expect(migrationSql[1]!.startsWith("BEGIN;\nCREATE TABLE owned")).toBe(
      true,
    );
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
