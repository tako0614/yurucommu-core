import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { applyMigrations } from "../scripts/apply-takos-migrations.ts";

test("app activation applies only migrations missing from _cf_migrations", async () => {
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
            "INSERT INTO _cf_migrations (name) VALUES ('0002_next.sql');",
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
      "INSERT INTO _cf_migrations (name) VALUES ('0002_owned.sql');",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
