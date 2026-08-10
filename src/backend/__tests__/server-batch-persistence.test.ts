import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";

import { runBatch, type D1Statement } from "../../db/index.ts";
import { createLocalDatabase } from "../server.ts";

const persistenceProbe = sqliteTable("batch_persistence_probe", {
  id: text("id").primaryKey(),
  value: text("value").notNull(),
});

test("local server batch writes survive closing and reopening the SQLite file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "yurucommu-batch-persistence-"));
  const databasePath = join(dir, "yurucommu.db");

  try {
    const { db, rawDb } = createLocalDatabase(databasePath);
    await rawDb.exec(`
      CREATE TABLE batch_persistence_probe (
        id TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await runBatch(db, [
      db.insert(persistenceProbe).values({ id: "first", value: "one" }),
      db.insert(persistenceProbe).values({ id: "second", value: "two" }),
    ] as unknown as [D1Statement, ...D1Statement[]]);

    expect(
      await db
        .select()
        .from(persistenceProbe)
        .orderBy(asc(persistenceProbe.id)),
    ).toEqual([
      { id: "first", value: "one" },
      { id: "second", value: "two" },
    ]);

    (
      rawDb.getRawDatabase() as {
        close(): void;
      }
    ).close();

    const reopened = createLocalDatabase(databasePath);
    const persisted = await reopened.rawDb
      .prepare("SELECT id, value FROM batch_persistence_probe ORDER BY id")
      .all<{ id: string; value: string }>();

    expect(persisted.results).toEqual([
      { id: "first", value: "one" },
      { id: "second", value: "two" },
    ]);

    (
      reopened.rawDb.getRawDatabase() as {
        close(): void;
      }
    ).close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
