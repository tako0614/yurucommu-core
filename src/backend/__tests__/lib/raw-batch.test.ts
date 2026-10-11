import { expect, test } from "bun:test";
import type { InArgs, ResultSet } from "@libsql/client";
import { sql } from "drizzle-orm";

import {
  affectedRowCount,
  getDb,
  rawBatchStatement,
  runBatch,
  type Database,
  type D1Statement,
} from "../../../db/index.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import {
  createEdgeSqlDatabase,
  toEdgeSqlValue,
} from "../../runtime/edge-sql.ts";
import {
  decodeEdgeBytes,
  isEdgeEncodedBytes,
  type EdgeSqlBinding,
  type EdgeSqlResult,
  type EdgeSqlValue,
} from "../../runtime/edge-facades.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

type Lane = "libsql" | "d1" | "sqlite-proxy";

async function fixture(lane: Lane) {
  const { db: libsql, client } = await createTestDb({ migrate: false });
  await client.execute(
    "CREATE TABLE raw_batch_probe " +
      "(id TEXT PRIMARY KEY, witness TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0)",
  );
  const d1Result = (result: ResultSet) => ({
    results: result.rows.map((row) =>
      Object.fromEntries(
        result.columns.map((column, index) => [column, row[index]]),
      ),
    ),
    meta: { changes: result.rowsAffected },
    success: true,
  });
  if (lane === "d1") {
    // Match the native driver's prepare/bind/batch contract while the
    // sanctioned libsql client supplies atomic SQLite execution.
    const native = {
      prepare(statement: string) {
        return {
          bind(...args: unknown[]) {
            return { statement, args };
          },
        };
      },
      async batch(statements: Array<{ statement: string; args: unknown[] }>) {
        return (
          await client.batch(
            statements.map(({ statement, args }) => ({
              sql: statement,
              args: args as InArgs,
            })),
          )
        ).map(d1Result);
      },
    };
    return {
      db: getDb(native as unknown as Parameters<typeof getDb>[0]) as Database,
      client,
    };
  }
  if (lane === "sqlite-proxy") {
    const argumentsFor = (params?: readonly EdgeSqlValue[]): InArgs =>
      (params ?? []).map((value) =>
        isEdgeEncodedBytes(value) ? decodeEdgeBytes(value) : value,
      ) as InArgs;
    const response = (result: ResultSet): EdgeSqlResult => ({
      rows: result.rows.map((row) =>
        Object.fromEntries(
          result.columns.map((column, index) => [
            column,
            toEdgeSqlValue(row[index]),
          ]),
        ),
      ),
      rowsWritten: result.rowsAffected,
    });
    const execute = async (
      statement: string,
      params?: readonly EdgeSqlValue[],
    ) =>
      response(
        await client.execute({ sql: statement, args: argumentsFor(params) }),
      );
    const binding: EdgeSqlBinding = {
      execute,
      query: execute,
      transaction: async (statements) => ({
        results: (
          await client.batch(
            statements.map((statement) => ({
              sql: statement.sql,
              args: argumentsFor(statement.params),
            })),
          )
        ).map(response),
      }),
    };
    return { db: createEdgeSqlDatabase(binding) as Database, client };
  }
  return { db: libsql, client };
}

for (const lane of ["libsql", "d1", "sqlite-proxy"] as const) {
  test(`${lane} raw batch binds lazily and rolls back a failed witness`, async () => {
    const { db, client } = await fixture(lane);
    const first = rawBatchStatement(
      db,
      sql`INSERT INTO raw_batch_probe (id, witness) VALUES (${"first"}, ${"valid"})`,
    );
    expect(
      (await client.execute("SELECT * FROM raw_batch_probe")).rows,
    ).toHaveLength(0);
    await runBatch(db, [first]);
    expect(
      (await client.execute("SELECT * FROM raw_batch_probe")).rows,
    ).toHaveLength(1);

    await expect(
      runBatch(db, [
        rawBatchStatement(
          db,
          sql`INSERT INTO raw_batch_probe (id, witness) VALUES (${"rolled-back"}, ${"valid"})`,
        ),
        rawBatchStatement(
          db,
          sql`INSERT INTO raw_batch_probe (id, witness) VALUES (${"bad"}, ${null})`,
        ),
      ]),
    ).rejects.toThrow();
    expect(
      (
        await client.execute("SELECT id FROM raw_batch_probe ORDER BY id")
      ).rows.map((row) => row.id),
    ).toEqual(["first"]);
  });

  test(`${lane} raw batch preserves run/read result actions`, async () => {
    const { db } = await fixture(lane);
    const batchable = db as Database & {
      batch(
        items: readonly [D1Statement, ...D1Statement[]],
      ): Promise<unknown[]>;
    };
    const [written, all, one, values] = await batchable.batch([
      rawBatchStatement(
        db,
        sql`INSERT INTO raw_batch_probe (id, witness) VALUES (${"row"}, ${"valid"})`,
      ),
      rawBatchStatement(
        db,
        sql`SELECT id, witness FROM raw_batch_probe WHERE id = ${"row"}`,
        "all",
      ),
      rawBatchStatement(
        db,
        sql`SELECT id, witness FROM raw_batch_probe WHERE id = ${"row"}`,
        "get",
      ),
      rawBatchStatement(
        db,
        sql`SELECT id, witness FROM raw_batch_probe WHERE id = ${"row"}`,
        "values",
      ),
    ]);
    expect(affectedRowCount(written)).toBe(1);
    expect(all as unknown[]).toHaveLength(1);
    expect(one).toBeTruthy();
    expect((values as unknown[][])[0]?.[0]).toBe("row");
  });
}

test("a guarded request cannot construct a raw batch item from its facade", async () => {
  const { db } = await fixture("libsql");
  const guarded = createGuardedDatabase(db, () => ({
    before: rawBatchStatement(
      db,
      sql`INSERT INTO raw_batch_probe (id, witness) VALUES (${"guard"}, ${"valid"})`,
    ),
    after: rawBatchStatement(
      db,
      sql`DELETE FROM raw_batch_probe WHERE id = ${"guard"}`,
    ),
  }));
  expect(() =>
    rawBatchStatement(
      guarded,
      sql`INSERT INTO raw_batch_probe (id, witness) VALUES (${"escape"}, ${"bad"})`,
    ),
  ).toThrow("bypasses the write guard");
});
