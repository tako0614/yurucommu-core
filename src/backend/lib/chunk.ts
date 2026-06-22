/**
 * Cloudflare D1 allows at most 100 bound parameters per query. A Drizzle
 * `inArray(col, ids)` / `notInArray(col, ids)` binds ONE parameter per id, so
 * any id list re-queried via IN(...) must be split into chunks of <=90 (leaving
 * headroom for the other bound params in the same statement) and the per-chunk
 * results merged.
 *
 * This is invisible in CI: the tests run on libsql / better-sqlite3, whose
 * ~32k-parameter ceiling never trips, so an over-large IN(...) passes locally
 * but throws "too many SQL variables" on production D1. Prefer a `db.select`
 * subquery (`col IN (SELECT ...)`, zero per-element params) when the id set is
 * itself a query result; use this chunker when the ids only exist as an
 * in-memory JS array.
 */
export const D1_IN_CHUNK = 90;

/**
 * Split `items` into consecutive chunks of at most `size` (default
 * {@link D1_IN_CHUNK}). Returns `[]` for an empty input and `[items]` when it
 * already fits in a single chunk (no copy).
 */
export function chunkForInClause<T>(
  items: T[],
  size: number = D1_IN_CHUNK,
): T[][] {
  if (items.length === 0) return [];
  if (items.length <= size) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
