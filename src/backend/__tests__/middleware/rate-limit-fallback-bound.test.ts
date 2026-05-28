import { assert, assertEquals } from "jsr:@std/assert";

import { __fallbackRateLimitInternals } from "../../middleware/rate-limit.ts";

Deno.test("fallbackRateLimitStore evicts expired entries on sweep", () => {
  __fallbackRateLimitInternals.clear();
  const now = Date.now();

  __fallbackRateLimitInternals.set("fresh", {
    count: 3,
    resetAt: now + 60_000,
  });
  __fallbackRateLimitInternals.set("expired-a", { count: 9, resetAt: now });
  __fallbackRateLimitInternals.set("expired-b", {
    count: 1,
    resetAt: now - 1000,
  });

  assertEquals(__fallbackRateLimitInternals.size(), 3);
  __fallbackRateLimitInternals.evict(now);
  assertEquals(__fallbackRateLimitInternals.size(), 1);
});

Deno.test(
  "fallbackRateLimitStore evicts oldest entries via LRU when over cap",
  () => {
    __fallbackRateLimitInternals.clear();
    const max = __fallbackRateLimitInternals.maxEntries;
    const now = Date.now();

    // Fill to the cap with fresh entries (none expired).
    for (let i = 0; i < max; i++) {
      __fallbackRateLimitInternals.set(`key:${i}`, {
        count: 1,
        resetAt: now + 60_000,
      });
    }
    assertEquals(__fallbackRateLimitInternals.size(), max);

    // Push one more entry through the touch helper to move it to the
    // most-recent end. LRU eviction must then drop "key:0" rather than
    // wiping every counter (`.clear()` was the previous, worse behaviour).
    __fallbackRateLimitInternals.touch("key:new", {
      count: 1,
      resetAt: now + 60_000,
    });
    __fallbackRateLimitInternals.enforceCap();

    assertEquals(__fallbackRateLimitInternals.size(), max);
  },
);

Deno.test(
  "fallbackRateLimitStore.touch promotes a key to most-recently-used",
  () => {
    __fallbackRateLimitInternals.clear();
    const max = __fallbackRateLimitInternals.maxEntries;
    const now = Date.now();

    for (let i = 0; i < max; i++) {
      __fallbackRateLimitInternals.set(`key:${i}`, {
        count: 1,
        resetAt: now + 60_000,
      });
    }

    // Touch "key:0" so it is now the freshest entry.
    __fallbackRateLimitInternals.touch("key:0", {
      count: 2,
      resetAt: now + 60_000,
    });

    // Push two more new keys past the cap; eviction must drop key:1 and
    // key:2 (the LRU entries after touching key:0), keeping key:0.
    __fallbackRateLimitInternals.touch("key:new-1", {
      count: 1,
      resetAt: now + 60_000,
    });
    __fallbackRateLimitInternals.touch("key:new-2", {
      count: 1,
      resetAt: now + 60_000,
    });
    __fallbackRateLimitInternals.enforceCap();

    assert(
      __fallbackRateLimitInternals.size() === max,
      "LRU cap must hold size at max",
    );
  },
);

Deno.test("fallbackRateLimitStore stays bounded under mixed churn", () => {
  __fallbackRateLimitInternals.clear();
  const max = __fallbackRateLimitInternals.maxEntries;
  const now = Date.now();

  for (let i = 0; i < 500; i++) {
    __fallbackRateLimitInternals.set(`fresh:${i}`, {
      count: 1,
      resetAt: now + 60_000,
    });
    __fallbackRateLimitInternals.set(`old:${i}`, {
      count: 1,
      resetAt: now - 1,
    });
  }
  __fallbackRateLimitInternals.evict(now);
  assert(
    __fallbackRateLimitInternals.size() <= max,
    "fallback store must stay within max",
  );
  assertEquals(__fallbackRateLimitInternals.size(), 500);
});
