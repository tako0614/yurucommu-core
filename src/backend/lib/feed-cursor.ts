// Shared keyset cursor for `(published, apId)`-ordered feeds.
//
// Several list endpoints (replies, bookmarks, profile posts, DM + community
// chat, the MCP timeline) page back through rows ordered `desc(published),
// desc(apId)`. `published`/`created_at` is NOT unique (many rows can share a
// millisecond — local writes collide, and federated inbound timestamps are
// remote-controlled), so a cursor on the timestamp alone would skip the rows on
// either side of a page boundary that share the boundary's millisecond. The
// unique `apId` is the tiebreaker that makes the ordering total.
//
// The cursor is encoded as "<published> <apId>". A SPACE separator is used (NOT
// a raw NUL — typing a single-char separator in a string literal has repeatedly
// landed as a raw 0x00 byte, which corrupts the source file): a space sorts
// strictly below every character that can appear in an ISO-8601 timestamp or an
// https:// ap_id, so the concatenated lexical order matches the (published,
// apId) tuple order, and neither field can contain a space to break the split.
// The actual SQL comparison is a real column tuple predicate, so even a
// variable-width `published` is compared correctly.

import { and, eq, lt, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";

export const FEED_CURSOR_SEP = " ";

/**
 * Encode a row's `(sortKey, tiebreaker)` into an opaque `before` cursor string.
 * `sortKey` is the published/created timestamp; `tiebreaker` is the unique id
 * (apId / objectApId) that makes the ordering total.
 */
export function encodeFeedCursor(sortKey: string, tiebreaker: string): string {
  return `${sortKey}${FEED_CURSOR_SEP}${tiebreaker}`;
}

/**
 * Build the WHERE predicate for "rows strictly older than `before`" against the
 * given published/apId columns. A composite `before` ("<published> <apId>")
 * yields the tuple predicate `published < p OR (published = p AND apId < a)`; a
 * legacy bare-published `before` (no separator) falls back to `published < before`
 * so older clients/cursors keep working. Returns `undefined` when `before` is
 * absent (no cursor → no predicate).
 */
export function feedCursorWhere(
  publishedCol: AnyColumn,
  apIdCol: AnyColumn,
  before: string | undefined | null,
): SQL | undefined {
  if (!before) return undefined;
  const sepIdx = before.indexOf(FEED_CURSOR_SEP);
  if (sepIdx < 0) return lt(publishedCol, before);
  const cPublished = before.slice(0, sepIdx);
  const cApId = before.slice(sepIdx + FEED_CURSOR_SEP.length);
  return or(
    lt(publishedCol, cPublished),
    and(eq(publishedCol, cPublished), lt(apIdCol, cApId)),
  );
}
