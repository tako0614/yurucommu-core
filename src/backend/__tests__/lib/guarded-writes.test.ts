import { expect, test } from "bun:test";
import type { InArgs, ResultSet } from "@libsql/client";
import { eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { affectedRowCount, type Database } from "../../../db/index.ts";
import {
  D1BatchTooLargeError,
  type D1Statement,
} from "../../../db/d1-write.ts";
import {
  createGuardedDatabase,
  withGuardedWrites,
} from "../../../db/guarded-writes.ts";
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

const fence = sqliteTable("test_write_fence", {
  id: text("id").primaryKey(),
  witness: text("witness").notNull(),
  counter: integer("counter").notNull().default(0),
});

async function fixture() {
  const { db } = await createTestDb({ migrate: false });
  await db.run(
    sql.raw(
      "CREATE TABLE test_write_fence " +
        "(id TEXT PRIMARY KEY, witness TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0)",
    ),
  );
  await db.insert(fence).values({ id: "counter", witness: "valid" });
  const guarded = createGuardedDatabase(db, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
  }));
  return { db, guarded };
}

async function counter(db: Database): Promise<number> {
  const [row] = await db
    .select({ counter: fence.counter })
    .from(fence)
    .where(eq(fence.id, "counter"));
  return row?.counter ?? -1;
}

/**
 * Exercise the owning edge.sql sqlite-proxy adapter against the sanctioned
 * test client. Result records use the driver's column names and cells; the
 * Host transaction delegates to the client's real atomic batch.
 */
async function edgeFixture() {
  const { client } = await createTestDb({ migrate: false });
  await client.execute(
    "CREATE TABLE test_write_fence " +
      "(id TEXT PRIMARY KEY, witness TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0)",
  );
  const transactionSizes: number[] = [];
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
  const execute = async (statement: string, params?: readonly EdgeSqlValue[]) =>
    response(
      await client.execute({ sql: statement, args: argumentsFor(params) }),
    );
  const binding: EdgeSqlBinding = {
    execute,
    query: async (statement, params) => {
      if (!/^\s*SELECT\b/i.test(statement)) {
        throw new Error("test edge.sql query accepts SELECT only");
      }
      return execute(statement, params);
    },
    transaction: async (statements) => {
      transactionSizes.push(statements.length);
      const results = await client.batch(
        statements.map((statement) => ({
          sql: statement.sql,
          args: argumentsFor(statement.params),
        })),
      );
      return { results: results.map(response) };
    },
  };
  const db = createEdgeSqlDatabase(binding) as Database;
  await db.insert(fence).values({ id: "counter", witness: "valid" });
  return { db, transactionSizes };
}

test("guard is lazy and a failing after assertion rolls back before and payload", async () => {
  const { db } = await fixture();
  let errors = 0;
  const guarded = withGuardedWrites(db, {
    before: () =>
      db
        .update(fence)
        .set({ counter: sql`${fence.counter} + 1` })
        .where(eq(fence.id, "counter")),
    // The required NOT NULL witness is absent. D1/libsql must roll back all
    // three statements, including the counter write before the payload.
    after: () =>
      db.insert(fence).values({
        id: "failed-assertion",
        witness: sql<string>`(SELECT witness FROM test_write_fence WHERE id = 'missing')`,
      }),
    onError: (error) => {
      errors++;
      return new Error("rejected write assertion", { cause: error });
    },
  });
  const pending = guarded
    .insert(fence)
    .values({ id: "payload", witness: "present" });
  expect(await counter(db)).toBe(0);
  expect(errors).toBe(0);

  await expect(Promise.resolve(pending)).rejects.toThrow(
    "rejected write assertion",
  );
  expect(errors).toBe(1);
  expect(await counter(db)).toBe(0);
  expect(
    await db.select().from(fence).where(eq(fence.id, "payload")),
  ).toHaveLength(0);
  expect(
    await db.select().from(fence).where(eq(fence.id, "failed-assertion")),
  ).toHaveLength(0);
});

test("await, returning get/all, raw run/values, and no-row get keep their shapes", async () => {
  const { db, guarded } = await fixture();
  const inserted = await guarded
    .insert(fence)
    .values({ id: "row", witness: "first" })
    .returning({ id: fence.id, witness: fence.witness });
  expect(inserted).toEqual([{ id: "row", witness: "first" }]);

  const updated = await guarded
    .update(fence)
    .set({ witness: "second" })
    .where(eq(fence.id, "row"))
    .returning({ witness: fence.witness })
    .get();
  expect(updated).toEqual({ witness: "second" });

  const all = await guarded
    .update(fence)
    .set({ witness: "third" })
    .where(eq(fence.id, "row"))
    .returning({ id: fence.id, witness: fence.witness })
    .all();
  expect(all).toEqual([{ id: "row", witness: "third" }]);

  const rawRun = await guarded
    .insert(fence)
    .values({ id: "raw-run", witness: "present" })
    .returning({ id: fence.id })
    .run();
  const directRun = await db
    .insert(fence)
    .values({ id: "direct-run", witness: "present" })
    .returning({ id: fence.id })
    .run();
  expect(affectedRowCount(rawRun)).toBe(affectedRowCount(directRun));

  const rawValues = await guarded
    .update(fence)
    .set({ witness: "fourth" })
    .where(eq(fence.id, "row"))
    .returning({ id: fence.id, witness: fence.witness })
    .values();
  const directValues = await db
    .update(fence)
    .set({ witness: "fourth" })
    .where(eq(fence.id, "row"))
    .returning({ id: fence.id, witness: fence.witness })
    .values();
  expect(rawValues).toEqual(directValues);

  const absent = await guarded
    .delete(fence)
    .where(eq(fence.id, "missing"))
    .returning({ id: fence.id })
    .get();
  expect(absent).toBeUndefined();
  expect(await counter(db)).toBe(12);
});

test("upsert, builder chain, and a mixed batch retain one guard pair per execution", async () => {
  const { db, guarded } = await fixture();
  const upsert = guarded
    .insert(fence)
    .values({ id: "row", witness: "one" })
    .onConflictDoUpdate({ target: fence.id, set: { witness: "two" } })
    .returning({ witness: fence.witness });
  expect(await upsert).toEqual([{ witness: "one" }]);
  expect(await upsert).toEqual([{ witness: "two" }]);

  const batchDb = guarded as Database & {
    batch(
      statements: readonly [D1Statement, ...D1Statement[]],
    ): Promise<unknown[]>;
  };
  const results = await batchDb.batch([
    guarded.insert(fence).values({ id: "batch", witness: "first" }),
    guarded
      .update(fence)
      .set({ witness: "second" })
      .where(eq(fence.id, "batch"))
      .returning({ witness: fence.witness }),
    guarded
      .select({ id: fence.id, witness: fence.witness })
      .from(fence)
      .where(eq(fence.id, "batch")),
  ]);
  expect(affectedRowCount(results[0])).toBe(1);
  expect(results[1]).toEqual([{ witness: "second" }]);
  expect(results[2]).toEqual([{ id: "batch", witness: "second" }]);
  expect(await counter(db)).toBe(6);
});

test("guarded INSERT SELECT accepts its own read and keeps the write fenced", async () => {
  const { db, guarded } = await fixture();
  const candidate = guarded
    .select({
      id: sql<string>`'projected'`.as("id"),
      witness: fence.witness,
      counter: fence.counter,
    })
    .from(fence)
    .where(eq(fence.id, "counter"));
  expect(() => (candidate as unknown as { _: unknown })._).toThrow(
    "bypasses the write guard",
  );

  const write = guarded.insert(fence).select(candidate);
  expect(() =>
    (write as unknown as { _prepare(): unknown })._prepare(),
  ).toThrow("bypasses the write guard");
  expect(await counter(db)).toBe(0);
  await write;
  expect(
    await db.select().from(fence).where(eq(fence.id, "projected")),
  ).toEqual([{ id: "projected", witness: "valid", counter: 1 }]);
  expect(await counter(db)).toBe(2);

  const rejected = withGuardedWrites(db, {
    before: () =>
      db
        .update(fence)
        .set({ counter: sql`${fence.counter} + 1` })
        .where(eq(fence.id, "counter")),
    after: () =>
      db.insert(fence).values({
        id: "failed-select-assertion",
        witness: sql<string>`(SELECT witness FROM test_write_fence WHERE id = 'missing')`,
      }),
  });
  const rejectedCandidate = rejected
    .select({
      id: sql<string>`'rejected-projection'`.as("id"),
      witness: fence.witness,
      counter: fence.counter,
    })
    .from(fence)
    .where(eq(fence.id, "counter"));
  await expect(
    Promise.resolve(rejected.insert(fence).select(rejectedCandidate)),
  ).rejects.toThrow();
  expect(await counter(db)).toBe(2);
  expect(
    await db.select().from(fence).where(eq(fence.id, "rejected-projection")),
  ).toHaveLength(0);

  const otherGuard = createGuardedDatabase(db, () => ({
    before: db.select({ witness: fence.witness }).from(fence).limit(1),
    after: db.select({ witness: fence.witness }).from(fence).limit(1),
  }));
  const foreignCandidate = otherGuard
    .select({
      id: sql<string>`'foreign-projection'`.as("id"),
      witness: fence.witness,
      counter: fence.counter,
    })
    .from(fence)
    .where(eq(fence.id, "counter"));
  expect(() => guarded.insert(fence).select(foreignCandidate)).toThrow(
    "bypasses the write guard",
  );
  expect(await counter(db)).toBe(2);
});

test("nested request and target guards compose around RETURNING and roll back together", async () => {
  const { db, guarded: requestGuard } = await fixture();
  const targetGuard = createGuardedDatabase(requestGuard, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
  }));
  expect(
    await targetGuard
      .insert(fence)
      .values({ id: "nested", witness: "valid" })
      .returning({ id: fence.id }),
  ).toEqual([{ id: "nested" }]);
  expect(await counter(db)).toBe(4);

  const rejectedTarget = createGuardedDatabase(requestGuard, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db.insert(fence).values({
      id: "nested-failed-assertion",
      witness: sql<string>`(SELECT witness FROM test_write_fence WHERE id = 'missing')`,
    }),
  }));
  await expect(
    Promise.resolve(
      rejectedTarget
        .update(fence)
        .set({ witness: "changed" })
        .where(eq(fence.id, "nested"))
        .returning({ witness: fence.witness }),
    ),
  ).rejects.toThrow();
  expect(await counter(db)).toBe(4);
  expect(
    await db
      .select({ witness: fence.witness })
      .from(fence)
      .where(eq(fence.id, "nested")),
  ).toEqual([{ witness: "valid" }]);
  expect(
    await db
      .select()
      .from(fence)
      .where(eq(fence.id, "nested-failed-assertion")),
  ).toHaveLength(0);

  // The failed attempt leaves no fence row or stale transaction state. A new
  // attempt under the valid target assertion can still commit normally.
  expect(
    await targetGuard
      .update(fence)
      .set({ witness: "retried" })
      .where(eq(fence.id, "nested"))
      .returning({ witness: fence.witness }),
  ).toEqual([{ witness: "retried" }]);
  expect(await counter(db)).toBe(8);
});

test("more than 48 payloads are refused before either guard or payload executes", async () => {
  const { db } = await fixture();
  let factoryCalls = 0;
  const guarded = createGuardedDatabase(db, () => {
    factoryCalls++;
    return {
      before: db
        .update(fence)
        .set({ counter: sql`${fence.counter} + 1` })
        .where(eq(fence.id, "counter")),
      after: db
        .update(fence)
        .set({ counter: sql`${fence.counter} + 1` })
        .where(eq(fence.id, "counter")),
    };
  }) as Database & {
    batch(
      statements: readonly [D1Statement, ...D1Statement[]],
    ): Promise<unknown[]>;
  };
  const payloads = Array.from({ length: 49 }, (_, index) =>
    guarded
      .insert(fence)
      .values({ id: `overflow-${index}`, witness: "present" }),
  );
  await expect(
    guarded.batch(payloads as unknown as [D1Statement, ...D1Statement[]]),
  ).rejects.toBeInstanceOf(D1BatchTooLargeError);
  expect(factoryCalls).toBe(0);
  expect(await counter(db)).toBe(0);
  expect(await db.select().from(fence)).toHaveLength(1);
});

test("prepare and raw write/driver escape paths fail closed; raw SELECT stays readable", async () => {
  const { db, guarded } = await fixture();
  const mutation = guarded
    .insert(fence)
    .values({ id: "not-written", witness: "x" });
  expect(() => mutation.prepare()).toThrow("bypasses the write guard");
  expect(() =>
    (mutation as unknown as { _prepare(): unknown })._prepare(),
  ).toThrow("bypasses the write guard");
  expect(() =>
    guarded.run(sql.raw("INSERT INTO test_write_fence VALUES ('x', 'x', 0)")),
  ).toThrow("bypasses the write guard");
  expect(() => guarded.get(sql.raw("DELETE FROM test_write_fence"))).toThrow(
    "bypasses the write guard",
  );
  expect(() =>
    guarded.get(sql.raw("EXPLAIN UPDATE test_write_fence SET counter = 99")),
  ).toThrow("bypasses the write guard");
  expect(() => guarded.get(sql.raw("PRAGMA user_version = 10"))).toThrow(
    "bypasses the write guard",
  );
  expect(() => (guarded as unknown as { session: unknown }).session).toThrow(
    "bypasses the write guard",
  );
  expect(
    () => (guarded as unknown as { transaction: unknown }).transaction,
  ).toThrow("bypasses the write guard");
  expect(
    () =>
      (guarded.select().from(fence) as unknown as { session: unknown }).session,
  ).toThrow("bypasses the write guard");
  expect(
    () => (guarded.query.actors as unknown as { session: unknown }).session,
  ).toThrow("bypasses the write guard");
  const rawRow = (await guarded.get(
    sql.raw("SELECT witness FROM test_write_fence WHERE id = 'counter'"),
  )) as unknown as { witness: string };
  expect(rawRow).toEqual({ witness: "valid" });
  expect(
    await guarded
      .select({ total: guarded.$count(fence) })
      .from(fence)
      .limit(1),
  ).toEqual([{ total: 1 }]);
  expect(await counter(db)).toBe(0);
  expect(
    await db.select().from(fence).where(eq(fence.id, "not-written")),
  ).toHaveLength(0);
});

test("edge.sql sqlite-proxy preserves guarded RETURNING and raw action results", async () => {
  const { db, transactionSizes } = await edgeFixture();
  const guarded = createGuardedDatabase(db, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
  }));

  expect(
    await guarded
      .insert(fence)
      .values({ id: "edge-row", witness: "first" })
      .returning({ id: fence.id, witness: fence.witness }),
  ).toEqual([{ id: "edge-row", witness: "first" }]);
  expect(
    await guarded
      .update(fence)
      .set({ witness: "second" })
      .where(eq(fence.id, "edge-row"))
      .returning({ id: fence.id, witness: fence.witness })
      .get(),
  ).toEqual({ id: "edge-row", witness: "second" });
  expect(
    await guarded
      .update(fence)
      .set({ witness: "third" })
      .where(eq(fence.id, "edge-row"))
      .returning({ id: fence.id, witness: fence.witness })
      .all(),
  ).toEqual([{ id: "edge-row", witness: "third" }]);
  expect(
    await guarded
      .delete(fence)
      .where(eq(fence.id, "absent"))
      .returning({ id: fence.id })
      .get(),
  ).toBeUndefined();

  const directRun = await db
    .insert(fence)
    .values({ id: "edge-run", witness: "valid" })
    .returning({ id: fence.id })
    .run();
  const directRunRows = await db
    .select({ id: fence.id })
    .from(fence)
    .where(eq(fence.id, "edge-run"));
  await db.delete(fence).where(eq(fence.id, "edge-run"));
  const guardedRun = await guarded
    .insert(fence)
    .values({ id: "edge-run", witness: "valid" })
    .returning({ id: fence.id })
    .run();
  expect(guardedRun).toEqual(directRun);
  expect(affectedRowCount(guardedRun)).toBe(affectedRowCount(directRun));
  expect(
    await db
      .select({ id: fence.id })
      .from(fence)
      .where(eq(fence.id, "edge-run")),
  ).toEqual(directRunRows);

  const guardedValues = await guarded
    .update(fence)
    .set({ witness: "fourth" })
    .where(eq(fence.id, "edge-row"))
    .returning({ id: fence.id, witness: fence.witness })
    .values();
  const directValues = await db
    .update(fence)
    .set({ witness: "fourth" })
    .where(eq(fence.id, "edge-row"))
    .returning({ id: fence.id, witness: fence.witness })
    .values();
  expect(guardedValues).toEqual(directValues);
  expect(guardedValues).toEqual([["edge-row", "fourth"]]);

  // The lease claim path awaits UPDATE without RETURNING and checks changes.
  // Assert the owning proxy adapter and the guard both report a real write.
  const directUpdate = await db
    .update(fence)
    .set({ witness: "steady" })
    .where(eq(fence.id, "edge-row"));
  const guardedUpdate = await guarded
    .update(fence)
    .set({ witness: "steady" })
    .where(eq(fence.id, "edge-row"));
  expect(affectedRowCount(directUpdate)).toBe(1);
  expect(guardedUpdate).toEqual(directUpdate);
  expect(affectedRowCount(guardedUpdate)).toBe(1);

  const directExplicitRun = await db
    .update(fence)
    .set({ witness: "steady" })
    .where(eq(fence.id, "edge-row"))
    .run();
  const guardedExplicitRun = await guarded
    .update(fence)
    .set({ witness: "steady" })
    .where(eq(fence.id, "edge-row"))
    .run();
  expect(affectedRowCount(directExplicitRun)).toBe(1);
  expect(guardedExplicitRun).toEqual(directExplicitRun);
  expect(affectedRowCount(guardedExplicitRun)).toBe(1);
  expect(await counter(db)).toBe(16);
  expect(transactionSizes).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
});

test("edge.sql nested guards roll back both assertions and payload on failure", async () => {
  const { db, transactionSizes } = await edgeFixture();
  const requestGuard = createGuardedDatabase(db, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
  }));
  const targetGuard = createGuardedDatabase(requestGuard, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db.insert(fence).values({
      id: "edge-failed-assertion",
      witness: sql<string>`(SELECT witness FROM test_write_fence WHERE id = 'missing')`,
    }),
  }));

  await expect(
    Promise.resolve(
      targetGuard
        .insert(fence)
        .values({ id: "edge-payload", witness: "temporary" })
        .returning({ id: fence.id }),
    ),
  ).rejects.toThrow();
  expect(transactionSizes).toEqual([5]);
  expect(await counter(db)).toBe(0);
  expect(await db.select().from(fence)).toEqual([
    { id: "counter", witness: "valid", counter: 0 },
  ]);

  const validTarget = createGuardedDatabase(requestGuard, () => ({
    before: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
    after: db
      .update(fence)
      .set({ counter: sql`${fence.counter} + 1` })
      .where(eq(fence.id, "counter")),
  }));
  expect(
    await validTarget
      .insert(fence)
      .values({ id: "edge-payload", witness: "committed" })
      .returning({ id: fence.id, witness: fence.witness }),
  ).toEqual([{ id: "edge-payload", witness: "committed" }]);
  expect(await counter(db)).toBe(4);
  expect(transactionSizes).toEqual([5, 5]);
});
