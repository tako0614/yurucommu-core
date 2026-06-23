import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../index.ts";

// Regression: Hono's single `*` matches EXACTLY ONE path segment, so the
// `/ap/*/inbox` mounts (strict 512 KiB+requireContentLength body cap AND the
// per-IP 1k/min `inbox` rate limit) cover the one-segment `/ap/actor/inbox` but
// NOT the two-segment per-recipient inboxes `/ap/users/:username/inbox` and
// `/ap/groups/:name/inbox`. Without explicit two-segment mounts:
//   - the GROUP inbox got NO per-IP rate limit at all (unauthenticated per-IP
//     DoS forcing an unthrottled DB lookup + HTTP-sig verify per request), and
//   - the USER inbox was throttled only by the much tighter 60/min `/ap/users/*`
//     discovery limiter (legitimate inbound federation wrongly 429'd), and
//   - both two-segment inboxes fell through to the lax 1 MiB default body cap
//     (no requireContentLength), losing the strict pre-auth inbox cap.
// index.ts now drives every inbox route off the shared INBOX_PATH_PATTERNS list
// and skips the discovery limiter on the user-inbox subpath.

const TEST_ENV = { ENVIRONMENT: "test" } as never;

function inboxPost(url: string, withContentLength: boolean): Request {
  const headers: Record<string, string> = {
    "content-type": "application/activity+json",
  };
  if (withContentLength) headers["content-length"] = "2";
  return new Request(url, {
    method: "POST",
    headers,
    body: withContentLength ? "{}" : undefined,
    // @ts-expect-error duplex is required for a body in some runtimes
    duplex: "half",
  });
}

test("the strict inbox body cap (requireContentLength) covers the two-segment inboxes", async () => {
  const app = createYurucommuBackendApp();
  // A chunked-only request (no Content-Length) to either two-segment inbox must
  // be refused with 411 by the strict inbox cap. Before the fix these fell to
  // the default cap (no requireContentLength) and would NOT 411 here.
  for (const path of ["/ap/groups/x/inbox", "/ap/users/x/inbox"]) {
    const res = await app.fetch(
      inboxPost(`https://t.local${path}`, false),
      TEST_ENV,
    );
    expect(res.status).toBe(411);
  }
});

test("the per-IP inbox limiter (1k/min) — not the 60/min discovery limiter — fires on both two-segment inboxes", async () => {
  const app = createYurucommuBackendApp();
  for (const path of ["/ap/groups/x/inbox", "/ap/users/x/inbox"]) {
    const res = await app.fetch(
      inboxPost(`https://t.local${path}`, true),
      TEST_ENV,
    );
    // The handler 500s with no DB binding in this harness, but the rate-limit
    // middleware ran first and stamped its budget on the response.
    expect(res.headers.get("X-RateLimit-Limit")).toBe("1000");
  }
});

test("the discovery limiter (60/min) still governs non-inbox /ap/users/* paths", async () => {
  const app = createYurucommuBackendApp();
  // The inbox skip is scoped to the `/inbox` subpath only: the actor document
  // (and other discovery reads) keep the tight 60/min discovery budget.
  const res = await app.fetch(
    new Request("https://t.local/ap/users/x", { method: "GET" }),
    TEST_ENV,
  );
  expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
});
