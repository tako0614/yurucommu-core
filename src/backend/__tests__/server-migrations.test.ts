import { expect, test } from "bun:test";

import { runMigrations } from "../server.ts";

function createMigrationDb(applied: string[] = []) {
  const execCalls: string[] = [];
  const markedApplied: string[] = [];
  const finalizedStatements: string[] = [];

  const rawDb = {
    exec: (sql: string) => {
      execCalls.push(sql);
    },
    prepare: (sql: string) => ({
      all: () => applied.map((name) => ({ name })),
      run: (name: string) => {
        markedApplied.push(name);
      },
      get: () => undefined,
      finalize: () => {
        finalizedStatements.push(sql);
      },
    }),
    transaction: <T>(fn: () => T) => fn,
    changes: 0,
    lastInsertRowId: 0,
  };

  const db = {
    getRawDatabase: () => rawDb,
  };

  return { db, execCalls, markedApplied, finalizedStatements };
}

test("server migrations - executes each SQL migration as one script", async () => {
  const dir = await Deno.makeTempDir();
  const sql = `
    CREATE TABLE demo (value TEXT);
    INSERT INTO demo (value) VALUES ('literal; semicolon');
    -- comment with a semicolon;
    CREATE TRIGGER demo_ai AFTER INSERT ON demo
    BEGIN
      UPDATE demo SET value = value || ';trigger';
    END;
  `;

  try {
    await Deno.writeTextFile(`${dir}/001_semicolons.sql`, sql);
    const { db, execCalls, markedApplied, finalizedStatements } =
      createMigrationDb();

    await runMigrations(db as never, dir);

    expect(execCalls.length).toEqual(2);
    expect(execCalls[1]).toEqual(sql);
    expect(markedApplied).toEqual(["001_semicolons.sql"]);
    expect(finalizedStatements.length).toEqual(2);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

test("server migrations - skips files already recorded as applied", async () => {
  const dir = await Deno.makeTempDir();

  try {
    await Deno.writeTextFile(
      `${dir}/001_done.sql`,
      "CREATE TABLE done (id TEXT);",
    );
    const { db, execCalls, markedApplied } = createMigrationDb([
      "001_done.sql",
    ]);

    await runMigrations(db as never, dir);

    expect(execCalls.length).toEqual(1);
    expect(markedApplied).toEqual([]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
