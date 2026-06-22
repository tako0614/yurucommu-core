import { expect, test } from "bun:test";

import { chunkForInClause, D1_IN_CHUNK } from "../../lib/chunk.ts";

test("chunkForInClause: empty input → no chunks", () => {
  expect(chunkForInClause([])).toEqual([]);
});

test("chunkForInClause: fits in one chunk → returns the same array (no copy)", () => {
  const items = [1, 2, 3];
  const out = chunkForInClause(items);
  expect(out).toEqual([[1, 2, 3]]);
  expect(out[0]).toBe(items);
});

test("chunkForInClause: splits at the size boundary, lossless and ordered", () => {
  const items = Array.from({ length: 200 }, (_, i) => i);
  const out = chunkForInClause(items, 90);
  expect(out.length).toBe(3); // 90 + 90 + 20
  expect(out.map((c) => c.length)).toEqual([90, 90, 20]);
  expect(out.flat()).toEqual(items);
});

test("chunkForInClause: exactly `size` → single chunk", () => {
  const items = Array.from({ length: 90 }, (_, i) => i);
  expect(chunkForInClause(items, 90).length).toBe(1);
});

test("chunkForInClause: `size` + 1 → two chunks", () => {
  const items = Array.from({ length: 91 }, (_, i) => i);
  const out = chunkForInClause(items, 90);
  expect(out.length).toBe(2);
  expect(out[1].length).toBe(1);
});

// The whole point of the helper: stay under Cloudflare D1's hard limit of 100
// bound parameters per query. 90 leaves headroom for the other bound params in
// the same statement.
test("D1_IN_CHUNK leaves headroom under D1's 100-bound-parameter ceiling", () => {
  expect(D1_IN_CHUNK).toBeLessThanOrEqual(90);
  expect(D1_IN_CHUNK).toBeGreaterThan(0);
});
