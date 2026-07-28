/**
 * D1-safe write primitives (yurucommu-core owner module).
 *
 * Cloudflare D1 rejects any statement that binds more than 100 parameters and
 * has no interactive transactions (`BEGIN`/`COMMIT` cannot be composed across
 * its stateless prepared-statement round-trips). Neither limit exists on the
 * libsql / bun:sqlite engines the test suite runs on (~32k parameters, real
 * transactions), so an unbounded multi-row INSERT is green in CI and throws
 * "too many SQL variables" in production.
 *
 * The dangerous shape is not the throw itself: it is `DELETE` followed by a
 * separate `INSERT`. The DELETE has already committed when the INSERT is
 * rejected, so exceeding the ceiling is DATA LOSS rather than a 500.
 *
 * This module makes that shape unrepresentable:
 *   - {@link insertMany} chunks by the real parameter budget and RETURNS
 *     statements instead of executing them, so a caller cannot accidentally
 *     issue a partial write;
 *   - {@link replaceSet} is the only supported delete-then-insert and emits a
 *     single `db.batch([...])`, which both drivers commit atomically — the
 *     DELETE cannot survive a failed INSERT because there is no way to hand it
 *     to the driver on its own.
 *
 * The same export surface exists in the other owner repos (takos, takosumi,
 * takos-git, road-to-me); a root gate asserts the names and constants match.
 * See `docs/quality/d1-write.md`.
 */

import { getTableColumns, sql, type SQL } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { Database } from "./index.ts";

/**
 * Bound-parameter budget for a single statement. D1's hard ceiling is 100; the
 * remaining 10 are headroom for the WHERE / conflict-target parameters that
 * share the statement with the row values.
 */
export const D1_SAFE_PARAM_BUDGET = 90;

/**
 * Statements per `db.batch([...])`. D1 accepts larger batches but degrades, and
 * a batch this size already means the caller is writing an unbounded set in one
 * shot — which is the pattern this module exists to stop.
 */
export const D1_MAX_BATCH_STATEMENTS = 50;

/** A driver-executable statement, as accepted by `db.batch([...])`. */
export type D1Statement = BatchItem<"sqlite">;

/** The row shape or the caller's usage cannot be expressed within D1's limits. */
export class D1WriteShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D1WriteShapeError";
  }
}

/** The driver in use does not expose the atomic `batch()` surface. */
export class D1BatchUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D1BatchUnsupportedError";
  }
}

/** The write needs more statements than one batch may carry. */
export class D1BatchTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "D1BatchTooLargeError";
  }
}

interface BatchableDb {
  batch(statements: readonly [D1Statement, ...D1Statement[]]): Promise<unknown>;
}

function requireBatchable(db: Database, context: string): BatchableDb {
  const candidate = db as unknown as Partial<BatchableDb>;
  if (typeof candidate.batch !== "function") {
    throw new D1BatchUnsupportedError(
      `${context}: the active driver exposes no batch(); a delete-then-insert ` +
        `cannot be made atomic without it. Both the D1 and libsql drivers do — ` +
        `a driver that does not is a test double that must gain one.`,
    );
  }
  return candidate as BatchableDb;
}

/**
 * Bound parameters Drizzle emits for one row of `rows`.
 *
 * Drizzle builds ONE column list for the whole `values([...])` call (the union
 * of the keys present across the rows) and binds a parameter per column per
 * row, so the budget must be divided by that union — not by the keys of the
 * first row.
 */
function paramsPerRow(
  table: SQLiteTable,
  rows: readonly Record<string, unknown>[],
): number {
  const keys = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) keys.add(key);
  }
  const known = new Set(Object.keys(getTableColumns(table)));
  for (const key of keys) {
    if (!known.has(key)) {
      throw new D1WriteShapeError(
        `insertMany: row key "${key}" is not a column of the target table`,
      );
    }
  }
  return keys.size;
}

/**
 * Build the INSERT statements for `rows`, chunked so no statement exceeds
 * {@link D1_SAFE_PARAM_BUDGET} bound parameters.
 *
 * Returns statements; it deliberately does NOT execute them. Executing a
 * multi-statement write is only safe inside one `db.batch([...])`, and making
 * the caller pass the statements to a batch is what keeps a half-applied write
 * from being expressible.
 */
export function insertMany<TTable extends SQLiteTable>(
  db: Database,
  table: TTable,
  rows: readonly TTable["$inferInsert"][],
  opts?: { readonly conflict?: "error" | "ignore" },
): readonly D1Statement[] {
  if (rows.length === 0) return [];

  const perRow = paramsPerRow(
    table,
    rows as readonly Record<string, unknown>[],
  );
  if (perRow === 0) {
    throw new D1WriteShapeError("insertMany: rows bind no columns");
  }
  if (perRow > D1_SAFE_PARAM_BUDGET) {
    throw new D1WriteShapeError(
      `insertMany: a single row binds ${perRow} parameters, over the D1 ` +
        `budget of ${D1_SAFE_PARAM_BUDGET}; no chunking can make this fit`,
    );
  }

  const chunkSize = Math.floor(D1_SAFE_PARAM_BUDGET / perRow);
  const statements: D1Statement[] = [];
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    // Drizzle's insert builder is generic over the table; the concrete row type
    // is already checked by the public signature, so the builder-local widening
    // here is the narrowest cast that keeps the call site typed.
    const builder = db
      .insert(table)
      .values(chunk as TTable["$inferInsert"][]) as unknown as D1Statement & {
      onConflictDoNothing(): D1Statement;
    };
    statements.push(
      opts?.conflict === "ignore" ? builder.onConflictDoNothing() : builder,
    );
  }

  if (statements.length > D1_MAX_BATCH_STATEMENTS) {
    throw new D1BatchTooLargeError(
      `insertMany: ${rows.length} rows need ${statements.length} statements, ` +
        `over the batch cap of ${D1_MAX_BATCH_STATEMENTS}. Do not split the ` +
        `batch — that reintroduces the partial-write window this module ` +
        `exists to remove. Page the source set instead, or apply the ` +
        `generational-replace pattern in docs/quality/d1-write.md §3.`,
    );
  }
  return statements;
}

/**
 * Atomically replace the rows matching `where` with `rows`.
 *
 * The DELETE and every chunked INSERT go to the driver as ONE batch, so a
 * rejected INSERT rolls the DELETE back. There is no overload that returns the
 * DELETE on its own.
 */
export async function replaceSet<TTable extends SQLiteTable>(args: {
  readonly db: Database;
  readonly table: TTable;
  readonly where: SQL;
  readonly rows: readonly TTable["$inferInsert"][];
  readonly conflict?: "error" | "ignore";
}): Promise<void> {
  const { db, table, where, rows, conflict } = args;
  const batch = requireBatchable(db, "replaceSet");
  const inserts = insertMany(db, table, rows, { conflict });

  if (inserts.length + 1 > D1_MAX_BATCH_STATEMENTS) {
    throw new D1BatchTooLargeError(
      `replaceSet: ${rows.length} rows need ${inserts.length + 1} statements, ` +
        `over the batch cap of ${D1_MAX_BATCH_STATEMENTS}. See ` +
        `docs/quality/d1-write.md §3.`,
    );
  }

  const del = db.delete(table).where(where) as unknown as D1Statement;
  await batch.batch([del, ...inserts] as [D1Statement, ...D1Statement[]]);
}

/**
 * Execute `statements` as ONE atomic batch. Both the D1 and libsql drivers
 * commit a batch all-or-nothing; this is the only atomicity primitive D1 has,
 * since `BEGIN`/`COMMIT` cannot be composed across its stateless
 * prepared-statement round-trips.
 */
export async function runBatch(
  db: Database,
  statements: readonly [D1Statement, ...D1Statement[]],
): Promise<void> {
  await requireBatchable(db, "runBatch").batch(statements);
}

/**
 * Run `run` once per chunk of at most {@link D1_SAFE_PARAM_BUDGET} ids and
 * concatenate the results. Use for an `inArray(col, ids)` whose ids only exist
 * as an in-memory array; prefer {@link notInSubquery} / a `db.select()`
 * subquery when the ids are themselves a query result (zero bound parameters).
 */
export async function inChunks<T, R>(
  ids: readonly T[],
  run: (chunk: readonly T[]) => Promise<R[]>,
): Promise<R[]> {
  if (ids.length === 0) return [];
  if (ids.length <= D1_SAFE_PARAM_BUDGET) return await run(ids);
  const out: R[] = [];
  for (let i = 0; i < ids.length; i += D1_SAFE_PARAM_BUDGET) {
    out.push(...(await run(ids.slice(i, i + D1_SAFE_PARAM_BUDGET))));
  }
  return out;
}

/**
 * `col NOT IN (<subquery>)` with zero per-element bound parameters.
 *
 * There is deliberately no `notInChunks`: NOT IN does not decompose over
 * chunks (the per-chunk results must be INTERSECTED, not concatenated), and
 * every attempt to write one has been wrong. Express the excluded set as a
 * subquery instead.
 */
export function notInSubquery(col: SQLiteColumn, subquery: SQL | unknown): SQL {
  return sql`${col} NOT IN ${subquery}`;
}

/**
 * Escape hatch for a statement whose parameter count is bounded by something
 * the type system cannot see (a fixed-arity literal list, a `LIMIT`ed page).
 *
 * `reason.boundedBy` must name the concrete bound, and this call is what a
 * reviewer greps for. It performs no work at runtime; its whole value is that
 * an unchunked statement cannot be written without saying why.
 */
export function unsafeUnchunkedStatement(
  stmt: D1Statement,
  reason: { readonly why: string; readonly boundedBy: string },
): D1Statement {
  if (!reason.why.trim() || !reason.boundedBy.trim()) {
    throw new D1WriteShapeError(
      "unsafeUnchunkedStatement: both `why` and `boundedBy` must be stated",
    );
  }
  return stmt;
}
