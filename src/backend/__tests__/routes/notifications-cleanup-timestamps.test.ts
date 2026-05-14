import { assert, assertEquals } from "jsr:@std/assert";

import { __archivedCleanupInternals } from "../../routes/notifications.ts";

Deno.test("archivedCleanupTimestamps prune evicts stale entries", () => {
  __archivedCleanupInternals.clear();
  const interval = __archivedCleanupInternals.intervalMs;
  const now = Date.now();

  __archivedCleanupInternals.set("actor:fresh", now);
  __archivedCleanupInternals.set("actor:stale", now - interval - 1);
  __archivedCleanupInternals.set("actor:also-stale", now - interval * 10);

  assertEquals(__archivedCleanupInternals.size(), 3);
  __archivedCleanupInternals.prune(now);
  assertEquals(__archivedCleanupInternals.size(), 1);
});

Deno.test("archivedCleanupTimestamps prune clears at hard cap", () => {
  __archivedCleanupInternals.clear();
  const max = __archivedCleanupInternals.maxEntries;
  const now = Date.now();

  // All fresh entries, beyond the hard cap.
  for (let i = 0; i < max; i++) {
    __archivedCleanupInternals.set(`actor:${i}`, now);
  }
  assertEquals(__archivedCleanupInternals.size(), max);

  __archivedCleanupInternals.prune(now);
  // Fresh entries cannot be evicted by age; the safety-clear must fire.
  assertEquals(__archivedCleanupInternals.size(), 0);
});

Deno.test("archivedCleanupTimestamps size stays bounded under churn", () => {
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
  assert(
    __archivedCleanupInternals.size() <= max,
    "size must stay within cap",
  );
  assertEquals(__archivedCleanupInternals.size(), 100);
});
