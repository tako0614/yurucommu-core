/** ISO timestamp with space separator for SQLite default values. */
export function nowIso(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Canonical ISO-8601 UTC timestamp (`2026-…T…Z`) — the SAME shape produced by
 * every explicit `new Date().toISOString()` write and used as every range
 * comparison operand. Use this (NOT the space-separated `nowIso`) as the default
 * for any column that is range-COMPARED or SORTED lexically, e.g.
 * `inbox.created_at`: under SQLite BINARY collation a space-format value sorts
 * BELOW a same-instant `…Z` value (space 0x20 < `T` 0x54 at position 10), so a
 * column written in BOTH formats mis-orders / mis-paginates rows.
 */
export function nowIsoUtc(): string {
  return new Date().toISOString();
}
