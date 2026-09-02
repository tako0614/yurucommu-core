/**
 * `edge.sql@1.0.0` → Drizzle, through `drizzle-orm/sqlite-proxy`.
 *
 * Same seam as `managed-relational.ts`: one bounded prepared statement per
 * callback, `batch()` as one ordered-atomic Host call. What is different is the
 * ROW SHAPE. D1 hands Drizzle positional arrays (`stmt.raw()`) and
 * `sqlite-proxy` maps `rows[i][j]` positionally onto the fields it compiled;
 * `edge.sql` returns RECORDS keyed by result-column name, and a record cannot
 * represent the duplicate names Drizzle's join SQL produces.
 *
 * The projection rewrite that makes those names distinct, the guard that
 * refuses a row whose column count disagrees with the statement, and the row
 * that answers to both positional and named reads all live in
 * `sqlite-proxy-rows.ts`, shared with the managed relational lane. What is left
 * here is the `edge.sql` value vocabulary and its request limits.
 */

import {
  drizzle as drizzleProxy,
  type AsyncBatchRemoteCallback,
  type AsyncRemoteCallback,
} from "drizzle-orm/sqlite-proxy";

import * as schema from "../../db/schema.ts";
import {
  EDGE_SQL_MAX_PARAMETERS,
  EDGE_SQL_MAX_STATEMENTS,
  decodeEdgeBytes,
  encodeEdgeBytes,
  isEdgeEncodedBytes,
  type EdgeSqlBinding,
  type EdgeSqlResult,
  type EdgeSqlValue,
} from "./edge-facades.ts";
import {
  ProxyColumnMismatchError,
  positionalRow,
  rewriteProjection,
  type ProjectedStatement,
} from "./sqlite-proxy-rows.ts";

/** The lane name a row-shape refusal reports. */
const LANE = "edge.sql";

/** The statement, or a value in it, cannot be expressed over `edge.sql`. */
export class EdgeSqlShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeSqlShapeError";
  }
}

/** Project one bound parameter into the facade's closed value vocabulary. */
export function toEdgeSqlValue(value: unknown): EdgeSqlValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new EdgeSqlShapeError(
        `edge.sql: ${value} is outside the range the facade carries`,
      );
    }
    return value;
  }
  if (typeof value === "bigint") {
    if (
      value > BigInt(Number.MAX_SAFE_INTEGER) ||
      value < BigInt(Number.MIN_SAFE_INTEGER)
    ) {
      throw new EdgeSqlShapeError(
        `edge.sql: bigint ${value} is outside the safe-integer range`,
      );
    }
    return Number(value);
  }
  if (value instanceof ArrayBuffer)
    return encodeEdgeBytes(new Uint8Array(value));
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    return encodeEdgeBytes(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }
  throw new EdgeSqlShapeError(
    `edge.sql: a ${typeof value} parameter has no portable encoding`,
  );
}

/** Turn a returned value back into what the D1 driver would have produced. */
function fromEdgeSqlValue(value: EdgeSqlValue): unknown {
  return isEdgeEncodedBytes(value) ? decodeEdgeBytes(value) : value;
}

function projectRows(
  result: EdgeSqlResult,
  projection: ProjectedStatement,
): unknown[][] {
  return result.rows.map((row) => {
    const keys = Object.keys(row);
    return positionalRow(
      projection,
      keys,
      keys.map((key) => fromEdgeSqlValue(row[key]!)),
    );
  });
}

const TRANSACTION_CONTROL =
  /^\s*(begin|commit|end|rollback|savepoint|release)\b/i;

interface PreparedStatement {
  readonly sql: string;
  readonly params: readonly EdgeSqlValue[];
  readonly projection: ProjectedStatement;
}

function prepare(sql: string, params: readonly unknown[]): PreparedStatement {
  if (TRANSACTION_CONTROL.test(sql)) {
    throw new EdgeSqlShapeError(
      `edge.sql: transaction control ("${sql.trim()}") is not on this request ` +
        `path. Use db.batch([...]) — the facade's transaction() commits it ` +
        `all-or-none in one Host call.`,
    );
  }
  if (params.length > EDGE_SQL_MAX_PARAMETERS) {
    throw new EdgeSqlShapeError(
      `edge.sql: ${params.length} bound parameters exceed the facade limit of ` +
        `${EDGE_SQL_MAX_PARAMETERS}; chunk the write (see src/db/d1-write.ts)`,
    );
  }
  const rewritten = rewriteProjection(sql);
  return {
    sql: rewritten.sql,
    params: params.map(toEdgeSqlValue),
    projection: { lane: LANE, sql, columns: rewritten.columns },
  };
}

/**
 * Every statement goes through `execute`, never `query`.
 *
 * `query` is `execute` with an added refusal when the statement wrote anything,
 * and Drizzle's read methods do not mean "reads nothing": an
 * `insert ... returning` is compiled with method `all`. Choosing the method
 * from Drizzle's would reject a legitimate write.
 */
export function createEdgeSqlDatabase(binding: EdgeSqlBinding) {
  const one = async (
    statement: PreparedStatement,
    method: "run" | "all" | "values" | "get",
  ) => {
    const result = await binding.execute(statement.sql, statement.params);
    return shape(result, statement, method);
  };

  const callback: AsyncRemoteCallback = async (sql, params, method) =>
    await one(prepare(sql, params), method);

  const batchCallback: AsyncBatchRemoteCallback = async (batch) => {
    if (batch.length > EDGE_SQL_MAX_STATEMENTS) {
      throw new EdgeSqlShapeError(
        `edge.sql: a batch of ${batch.length} statements exceeds the facade ` +
          `limit of ${EDGE_SQL_MAX_STATEMENTS}`,
      );
    }
    const prepared = batch.map((entry) => prepare(entry.sql, entry.params));
    const results = await binding.transaction(
      prepared.map((entry) => ({ sql: entry.sql, params: entry.params })),
    );
    if (results.length !== prepared.length) {
      throw new ProxyColumnMismatchError(
        `edge.sql: transaction returned ${results.length} results for ` +
          `${prepared.length} statements`,
      );
    }
    return results.map((result, index) =>
      shape(result, prepared[index]!, batch[index]!.method),
    );
  };

  return drizzleProxy(callback, batchCallback, { schema });
}

/**
 * `sqlite-proxy` wants a flat row for `get` and an array of rows otherwise, and
 * reads `run`'s result straight back to the caller — which is where
 * `affectedRowCount` looks for `meta.changes`.
 *
 * A `get` that matched nothing must yield `undefined`, not an empty array:
 * Drizzle's `mapGetResult` short-circuits on a falsy row, and an empty array is
 * truthy, so `[]` would be mapped into an object whose every field is
 * `undefined` — a "row" for a query that found none.
 */
function shape(
  result: EdgeSqlResult,
  statement: PreparedStatement,
  method: "run" | "all" | "values" | "get",
): { rows: unknown[]; meta: { changes: number } } {
  const rows = projectRows(result, statement.projection);
  return {
    rows: (method === "get" ? rows[0] : rows) as unknown[],
    meta: { changes: result.rowsWritten },
  };
}

export type EdgeSqlDatabase = ReturnType<typeof createEdgeSqlDatabase>;
