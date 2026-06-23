import { expect, test } from "bun:test";

import { generateCacheKey } from "../../middleware/cache.ts";

/**
 * varyByActor must separate viewers via the QUERY STRING, not a URL fragment.
 * Cloudflare's Cache API strips the fragment during match()/put(), so a
 * `#actor:<viewer>` suffix collapsed every authenticated viewer onto ONE key and
 * served viewer A's private (per-viewer) response to viewer B for the TTL — a
 * production cross-user leak invisible to the in-memory test runtime (which keys
 * on the raw string incl. the fragment).
 */

type MockActor = { ap_id: string } | undefined;

function ctxFor(path: string, actor: MockActor) {
  return {
    req: { url: `https://yuru.test${path}` },
    get: (k: string) => (k === "actor" ? actor : undefined),
  } as never;
}

const cfg = { varyByActor: true } as never;

test("varyByActor folds the viewer into the query, with NO URL fragment", () => {
  const key = generateCacheKey(
    ctxFor("/api/recommendations/users", {
      ap_id: "https://yuru.test/ap/users/alice",
    }),
    cfg,
  );
  // The viewer must NOT be in a fragment (Cloudflare strips it).
  expect(key.includes("#")).toBe(false);
  // It must be a real, key-bearing query param.
  expect(key).toContain("__actor=");
  expect(key).toContain(encodeURIComponent("https://yuru.test/ap/users/alice"));
});

test("two different viewers produce DIFFERENT cache keys", () => {
  const a = generateCacheKey(
    ctxFor("/api/recommendations/users", {
      ap_id: "https://yuru.test/ap/users/alice",
    }),
    cfg,
  );
  const b = generateCacheKey(
    ctxFor("/api/recommendations/users", {
      ap_id: "https://yuru.test/ap/users/bob",
    }),
    cfg,
  );
  const anon = generateCacheKey(
    ctxFor("/api/recommendations/users", undefined),
    cfg,
  );
  expect(a).not.toBe(b);
  expect(a).not.toBe(anon);
  expect(b).not.toBe(anon);
});

test("the viewer param survives the Cloudflare Request-URL synthesis (still in the query, not the fragment)", () => {
  const key = generateCacheKey(
    ctxFor("/api/recommendations/users", { ap_id: "u" }),
    cfg,
  );
  // Mirror handleCloudflareCache: `${origin}/_cache${cacheKey}`. The Cache API
  // keys on URL.search (query), never URL.hash (fragment). Assert the viewer
  // dimension lands in .search so two viewers can't collide.
  const u = new URL(`https://yuru.test/_cache${key}`);
  expect(u.search).toContain("__actor=");
  expect(u.hash).toBe("");
});

test("varyByActor appends with the correct separator when a query already exists", () => {
  const key = generateCacheKey(
    ctxFor("/api/feed?limit=20", { ap_id: "u" }),
    cfg,
  );
  // limit is a real param then __actor — both present, single leading '?'.
  expect(key).toContain("limit=20");
  expect(key).toContain("__actor=u");
  expect(key.indexOf("?")).toBe(key.lastIndexOf("?")); // exactly one '?'
});
