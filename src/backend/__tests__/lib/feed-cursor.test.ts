import { expect, test } from "bun:test";
import {
  encodeFeedCursor,
  FEED_CURSOR_SEP,
  feedCursorWhere,
} from "../../lib/feed-cursor.ts";

const SORT = "2026-01-01T00:00:00.000Z";
const ID = "https://yuru.test/ap/objects/abc";

// The separator MUST be a real space (0x20), never a raw NUL byte (0x00).
// Typing a single-char separator in a string literal has repeatedly landed as a
// raw NUL (which corrupts the source file); this pins it so a regression is loud.
test("FEED_CURSOR_SEP is a single ASCII space (not a NUL byte)", () => {
  expect(FEED_CURSOR_SEP.length).toBe(1);
  expect(FEED_CURSOR_SEP.charCodeAt(0)).toBe(0x20);
});

test("encodeFeedCursor joins sortKey + tiebreaker with the separator and round-trips", () => {
  const cursor = encodeFeedCursor(SORT, ID);
  expect(cursor).toBe(SORT + FEED_CURSOR_SEP + ID);
  // No NUL byte may appear in the encoded cursor.
  expect(cursor.includes("\u0000")).toBe(false);
  // Splitting on the FIRST separator recovers both parts (the timestamp never
  // contains a space, so the first separator is the split point).
  const idx = cursor.indexOf(FEED_CURSOR_SEP);
  expect(cursor.slice(0, idx)).toBe(SORT);
  expect(cursor.slice(idx + FEED_CURSOR_SEP.length)).toBe(ID);
});

test("feedCursorWhere returns undefined when there is no cursor", () => {
  // The column args are irrelevant for the no-cursor case; cast a stub.
  const col = {} as never;
  expect(feedCursorWhere(col, col, undefined)).toBeUndefined();
  expect(feedCursorWhere(col, col, null)).toBeUndefined();
  expect(feedCursorWhere(col, col, "")).toBeUndefined();
});
