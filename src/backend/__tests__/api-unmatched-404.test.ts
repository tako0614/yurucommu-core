import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../index.ts";
import { isBackendPath, NON_SPA_PREFIXES } from "../lib/backend-paths.ts";

const ENV = { APP_URL: "https://test.local", DB_INSTANCE: {} } as never;

// An unmatched backend route must NOT fall through to the SPA HTML shell — an
// API/AP/media client expects a JSON 404, not a 200 text/html app shell. The
// Cloudflare worker previously forwarded everything to the ASSETS binding
// (single-page-application mode), so /api/<typo> returned the app shell with a
// 200 on the production worker.
test("unmatched /api route returns a JSON 404, not the SPA shell", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/api/nonexistent-xyz"),
    ENV,
  );

  expect(res.status).toEqual(404);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = (await res.json()) as { code?: string };
  expect(body.code).toEqual("NOT_FOUND");
});

test("unmatched /ap route also returns a JSON 404 (not HTML)", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/ap/unknown-thing"),
    ENV,
  );
  expect(res.status).toEqual(404);
  expect(res.headers.get("content-type")).toContain("application/json");
});

// A genuine client-side route must NOT be captured by the backend-path guard:
// without configured assets it falls through to the 503 "API-only mode"
// response, proving the guard is selective (it returns 404 ONLY for backend
// prefixes, leaving SPA routes for the asset/HTML fallback).
test("a client-side SPA route is not swallowed by the backend 404 guard", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/profile/someone"),
    ENV,
  );
  expect(res.status).not.toEqual(404);
});

test("isBackendPath matches prefixes and their children, not lookalikes", () => {
  for (const p of NON_SPA_PREFIXES) {
    expect(isBackendPath(p)).toBe(true); // exact
    expect(isBackendPath(`${p}/child`)).toBe(true); // child
  }
  // A SPA route and a prefix-lookalike must NOT match.
  expect(isBackendPath("/profile/x")).toBe(false);
  expect(isBackendPath("/")).toBe(false);
  expect(isBackendPath("/apixyz")).toBe(false); // not "/api" nor "/api/..."
  expect(isBackendPath("/application")).toBe(false);
});
