/**
 * `edge.sql@1.0.0` → Drizzle, through `drizzle-orm/sqlite-proxy`.
 *
 * Same seam as `managed-relational.ts`: one bounded prepared statement per
 * callback, `batch()` as one ordered-atomic Host call. What is different, and
 * what most of this file is about, is the ROW SHAPE.
 *
 * D1 hands Drizzle positional arrays (`stmt.raw()`), and `sqlite-proxy` maps
 * `rows[i][j]` positionally onto the fields it compiled. `edge.sql` returns
 * RECORDS keyed by result-column name. Turning a record back into a positional
 * array is only sound when the column names are DISTINCT and ORDERED, and
 * Drizzle's own SQL guarantees neither:
 *
 *     select "inbox"."actor_ap_id", ..., "activities"."actor_ap_id", ...
 *       from "inbox" inner join "activities" on ...
 *
 * SQLite names both result columns `actor_ap_id`, so the record keeps one of
 * them and every field after it shifts by one — a silent mis-read, not an
 * error. (`created_at` collides in the same query.) JavaScript's own key
 * ordering adds a second trap: an integer-like column name such as the `1` of
 * `select 1` sorts ahead of every other key regardless of insertion order.
 *
 * So this adapter rewrites the statement's projection list before sending it,
 * giving every unaliased item a unique, non-numeric name (`__c0`, `__c1`, ...).
 * Drizzle never looks at result-column names, so renaming them is invisible to
 * it. The rewrite is then BACKED BY A GUARD: the number of keys a row comes
 * back with must equal the number of projection items that were sent, and a
 * mismatch throws instead of returning a shifted row.
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

/** The statement, or a value in it, cannot be expressed over `edge.sql`. */
export class EdgeSqlShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeSqlShapeError";
  }
}

/** A row came back with a different column count than the statement projected. */
export class EdgeSqlColumnMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EdgeSqlColumnMismatchError";
  }
}

const PROJECTION_ALIAS_PREFIX = "__c";

const SELECT_LIST_TERMINATORS = new Set([
  "from",
  "where",
  "group",
  "having",
  "window",
  "order",
  "limit",
  "offset",
  "union",
  "except",
  "intersect",
]);

interface ScannedWord {
  readonly word: string;
  readonly start: number;
  readonly end: number;
}

interface Scan {
  readonly words: readonly ScannedWord[];
  readonly commas: readonly number[];
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Walk the statement recording the bare words and commas that sit at
 * parenthesis depth zero. Quoted identifiers, string literals, and comments are
 * skipped whole, so a `,` inside `'a,b'` or a `from` inside a subquery is never
 * mistaken for structure.
 */
function scanTopLevel(sql: string): Scan {
  const words: ScannedWord[] = [];
  const commas: number[] = [];
  let depth = 0;
  let index = 0;
  while (index < sql.length) {
    const ch = sql[index]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === ch) {
          if (sql[index + 1] === ch) index += 2;
          else {
            index += 1;
            break;
          }
        } else index += 1;
      }
      continue;
    }
    if (ch === "[") {
      const close = sql.indexOf("]", index + 1);
      index = close === -1 ? sql.length : close + 1;
      continue;
    }
    if (ch === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline + 1;
      continue;
    }
    if (ch === "/" && sql[index + 1] === "*") {
      const close = sql.indexOf("*/", index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }
    if (ch === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (ch === ")") {
      depth -= 1;
      index += 1;
      continue;
    }
    if (ch === ",") {
      if (depth === 0) commas.push(index);
      index += 1;
      continue;
    }
    if (isWordChar(ch) && !/[0-9]/.test(ch)) {
      const start = index;
      while (index < sql.length && isWordChar(sql[index]!)) index += 1;
      if (depth === 0) {
        words.push({
          word: sql.slice(start, index).toLowerCase(),
          start,
          end: index,
        });
      }
      continue;
    }
    if (/[0-9]/.test(ch)) {
      while (index < sql.length && isWordChar(sql[index]!)) index += 1;
      continue;
    }
    index += 1;
  }
  return { words, commas };
}

/** Does this projection item already carry its own `as "name"` alias? */
function hasOwnAlias(item: string): boolean {
  return scanTopLevel(item).words.some((word) => word.word === "as");
}

export interface RewrittenStatement {
  readonly sql: string;
  /**
   * How many result columns the statement projects, when that could be
   * determined. `undefined` means the guard cannot check this statement — a
   * `select *`, or a shape with no projection list at all.
   */
  readonly columns: number | undefined;
}

/**
 * Give every projected column a distinct, non-numeric name.
 *
 * Handles the two shapes Drizzle emits: a `select` list (including one that
 * follows a `with` clause, whose CTE bodies are parenthesized and therefore
 * invisible to a depth-zero scan) and a `returning` list on a write. For a
 * compound `select ... union select ...` only the first arm is rewritten, which
 * is sufficient: SQLite takes a compound select's result-column names from its
 * first arm.
 *
 * Anything else — a `pragma`, a `create table`, a `select *` — is returned
 * untouched with no column count, because there is nothing safe to rename.
 */
export function rewriteProjection(sql: string): RewrittenStatement {
  const scan = scanTopLevel(sql);
  const first = scan.words[0];
  if (!first) return { sql, columns: undefined };

  let listStart: number;
  let listEnd: number;

  if (first.word === "select" || first.word === "with") {
    const selectAt = scan.words.findIndex((word) => word.word === "select");
    if (selectAt === -1) return { sql, columns: undefined };
    const select = scan.words[selectAt]!;
    // The list begins right after the keyword, NOT at the next bare word: an
    // item usually opens with a quoted identifier, which the scanner skips.
    listStart = select.end;
    let cursor = selectAt + 1;
    const next = scan.words[cursor];
    if (
      next &&
      (next.word === "distinct" || next.word === "all") &&
      sql.slice(select.end, next.start).trim() === ""
    ) {
      listStart = next.end;
      cursor += 1;
    }
    const terminator = scan.words
      .slice(cursor)
      .find((word) => SELECT_LIST_TERMINATORS.has(word.word));
    listEnd = terminator ? terminator.start : sql.length;
  } else {
    // insert / update / delete: only a `returning` list is projected.
    const returning = [...scan.words]
      .reverse()
      .find((word) => word.word === "returning");
    if (!returning) return { sql, columns: undefined };
    listStart = returning.end;
    listEnd = sql.length;
  }

  if (listEnd <= listStart) return { sql, columns: undefined };

  const boundaries = [
    listStart,
    ...scan.commas.filter((at) => at > listStart && at < listEnd),
    listEnd,
  ];
  const items: { text: string; start: number; end: number }[] = [];
  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = index === 0 ? boundaries[0]! : boundaries[index]! + 1;
    const end = boundaries[index + 1]!;
    items.push({ text: sql.slice(start, end), start, end });
  }
  if (items.length === 0) return { sql, columns: undefined };

  // `select *` and `"t".*` cannot take an alias, and their column count is not
  // knowable from the text. Leave the whole statement alone.
  if (items.some((item) => /(^|\.)\s*\*\s*$/.test(item.text.trim()))) {
    return { sql, columns: undefined };
  }

  let out = "";
  let cursor = 0;
  items.forEach((item, position) => {
    out += sql.slice(cursor, item.end);
    if (!hasOwnAlias(item.text)) {
      const trailing = item.text.length - item.text.trimEnd().length;
      // Insert before the item's own trailing whitespace so the statement keeps
      // its shape.
      out =
        out.slice(0, out.length - trailing) +
        ` as "${PROJECTION_ALIAS_PREFIX}${position}"` +
        out.slice(out.length - trailing);
    }
    cursor = item.end;
  });
  out += sql.slice(cursor);
  return { sql: out, columns: items.length };
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

/** Array indices and `length` are the only names an array cannot also carry. */
function canCarryName(key: string): boolean {
  return key !== "length" && String(Number(key)) !== key;
}

/**
 * Build a row that answers to BOTH access styles.
 *
 * Drizzle reads a row positionally, so the array part is what it needs. But
 * `db.get(sql\`... AS matched\`)` — a raw statement with no compiled fields —
 * is handed the driver's row untouched, and on D1 that is a record: call sites
 * read `row.matched`. `sqlite-proxy` gives them the bare array instead, so on
 * this lane those reads would come back `undefined` — and several of them gate
 * block/mute enforcement, where `undefined` reads as "not blocked".
 *
 * Attaching the column names to the array satisfies both without asking the
 * callback to know which one Drizzle compiled.
 */
function makeRow(
  keys: readonly string[],
  values: readonly unknown[],
): unknown[] {
  const row = [...values];
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index]!;
    if (canCarryName(key)) {
      Object.defineProperty(row, key, {
        value: values[index],
        enumerable: false,
        configurable: true,
        writable: true,
      });
    }
  }
  return row;
}

function projectRows(
  result: EdgeSqlResult,
  columns: number | undefined,
  sql: string,
): unknown[][] {
  return result.rows.map((row) => {
    const keys = Object.keys(row);
    if (columns !== undefined && keys.length !== columns) {
      throw new EdgeSqlColumnMismatchError(
        `edge.sql returned ${keys.length} columns for a statement projecting ` +
          `${columns}; the row cannot be mapped positionally. Statement: ${sql}`,
      );
    }
    return makeRow(
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
  readonly columns: number | undefined;
  readonly original: string;
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
    columns: rewritten.columns,
    original: sql,
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
      throw new EdgeSqlColumnMismatchError(
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
  const rows = projectRows(result, statement.columns, statement.original);
  return {
    rows: (method === "get" ? rows[0] : rows) as unknown[],
    meta: { changes: result.rowsWritten },
  };
}

export type EdgeSqlDatabase = ReturnType<typeof createEdgeSqlDatabase>;
