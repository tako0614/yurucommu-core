import { expect, test } from "bun:test";

import { __archivedCleanupInternals } from "../../routes/notifications.ts";

test("archivedCleanupTimestamps prune evicts stale entries", () => {
  __archivedCleanupInternals.clear();
  const interval = __archivedCleanupInternals.intervalMs;
  const now = Date.now();

  __archivedCleanupInternals.set("actor:fresh", now);
  __archivedCleanupInternals.set("actor:stale", now - interval - 1);
  __archivedCleanupInternals.set("actor:also-stale", now - interval * 10);

  expect(__archivedCleanupInternals.size()).toEqual(3);
  __archivedCleanupInternals.prune(now);
  expect(__archivedCleanupInternals.size()).toEqual(1);
});

test("archivedCleanupTimestamps prune clears at hard cap", () => {
  __archivedCleanupInternals.clear();
  const max = __archivedCleanupInternals.maxEntries;
  const now = Date.now();

  // All fresh entries, beyond the hard cap.
  for (let i = 0; i < max; i++) {
    __archivedCleanupInternals.set(`actor:${i}`, now);
  }
  expect(__archivedCleanupInternals.size()).toEqual(max);

  __archivedCleanupInternals.prune(now);
  // Fresh entries cannot be evicted by age; the safety-clear must fire.
  expect(__archivedCleanupInternals.size()).toEqual(0);
});

test("archivedCleanupTimestamps size stays bounded under churn", () => {
  __archivedCleanupInternals.clear();
  const max = __archivedCleanupInternals.maxEntries;
  const interval = __archivedCleanupInternals.intervalMs;
  const now = Date.now();

  // Mix of fresh and stale entries, total below cap.
  for (let i = 0; i < 100; i++) {
    __archivedCleanupInternals.set(`fresh:${i}`, now);
    __archivedCleanupInternals.set(`stale:${i}`, now - interval - i);
  }
  __archivedCleanupInternals.prune(now);
  expect(__archivedCleanupInternals.size() <= max).toBeTruthy();
  expect(__archivedCleanupInternals.size()).toEqual(100);
});
