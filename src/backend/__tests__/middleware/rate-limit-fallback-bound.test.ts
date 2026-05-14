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

Deno.test("fallbackRateLimitStore clears at hard cap when all fresh", () => {
  __fallbackRateLimitInternals.clear();
  const max = __fallbackRateLimitInternals.maxEntries;
  const now = Date.now();

  for (let i = 0; i < max; i++) {
    __fallbackRateLimitInternals.set(`key:${i}`, {
      count: 1,
      resetAt: now + 60_000,
    });
  }
  assertEquals(__fallbackRateLimitInternals.size(), max);

  __fallbackRateLimitInternals.evict(now);
  assertEquals(__fallbackRateLimitInternals.size(), 0);
});

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
