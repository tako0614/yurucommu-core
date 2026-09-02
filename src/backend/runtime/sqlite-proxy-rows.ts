/**
 * Row shape for every `drizzle-orm/sqlite-proxy` lane.
 *
 * `sqlite-proxy` maps `rows[i][j]` POSITIONALLY onto the fields Drizzle
 * compiled, so a lane is only correct while the j-th cell it hands back is the
 * j-th item of the projection list that went out. Two things break that, and
 * both break it SILENTLY:
 *
 * 1. Duplicate result-column names. Drizzle's join SQL is
 *
 *        select "inbox"."actor_ap_id", ..., "activities"."actor_ap_id", ...
 *          from "inbox" inner join "activities" on ...
 *
 *    and SQLite names both result columns `actor_ap_id`. Any driver, facade, or
 *    Host hop that materializes a row as a RECORD keeps one of them and every
 *    later field shifts by one. (`created_at` collides in the same query, and
 *    JavaScript's key ordering adds a second trap: an integer-like name such as
 *    the `1` of `select 1` sorts ahead of every other key.) So this module
 *    rewrites the projection list before it is sent, giving every unaliased
 *    item a unique, non-numeric name (`__c0`, `__c1`, ...). Drizzle never looks
 *    at result-column names, so the rename is invisible to it. The rewrite is
 *    then BACKED BY A GUARD: a row that comes back with a different number of
 *    columns than the statement projected throws instead of being mapped.
 *
 * 2. Rows with no names at all. Drizzle reads a row positionally, but
 *    `db.get(sql`... AS matched`)` — a raw statement with no compiled fields —
 *    is handed the driver's row untouched, and on D1 that is a record: call
 *    sites read `row.matched`. A bare array answers `undefined` to those reads,
 *    and several of them gate block/mute enforcement, where `undefined` reads
 *    as "not blocked". So the row this module builds answers to BOTH access
 *    styles: an array Drizzle can index, carrying its column names as
 *    non-enumerable properties.
 *
 * Lanes differ only in how they obtain the (names, values) pair — `edge.sql`
 * from a record per row, the managed relational runtime from a `columns` list
 * beside positional rows — so both share everything below.
 */

/** A row came back with a different column count than the statement projected. */
export class ProxyColumnMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProxyColumnMismatchError";
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

/** What a lane must remember about a statement to shape its rows back. */
export interface ProjectedStatement {
  /** Which lane is speaking, so a refusal names the surface that refused. */
  readonly lane: string;
  /** The statement as the caller wrote it, for the refusal message. */
  readonly sql: string;
  /** `rewriteProjection`'s column count, or `undefined` when unknowable. */
  readonly columns: number | undefined;
}

/** Array indices and `length` are the only names an array cannot also carry. */
function canCarryName(key: string): boolean {
  return key !== "length" && String(Number(key)) !== key;
}

/**
 * Build the row `sqlite-proxy` indexes positionally, carrying its column names.
 *
 * Fails closed first: if the lane came back with a different number of columns
 * than the statement projected, the cells no longer line up with the fields
 * Drizzle compiled, and returning them would be a silent mis-read.
 */
export function positionalRow(
  statement: ProjectedStatement,
  columns: readonly string[],
  values: readonly unknown[],
): unknown[] {
  if (statement.columns !== undefined && columns.length !== statement.columns) {
    throw new ProxyColumnMismatchError(
      `${statement.lane} returned ${columns.length} columns for a statement ` +
        `projecting ${statement.columns}; the row cannot be mapped ` +
        `positionally. Statement: ${statement.sql}`,
    );
  }
  const row = [...values];
  for (let index = 0; index < columns.length; index += 1) {
    const key = columns[index]!;
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
