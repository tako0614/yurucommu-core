import { expect, test } from "bun:test";

import {
  bodyLimit,
  DEFAULT_BODY_LIMIT_BYTES,
  evaluateBodyLimit,
} from "../../middleware/body-limit.ts";

test("evaluateBodyLimit allows GET / HEAD without Content-Length", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "DELETE"]) {
    const decision = evaluateBodyLimit(
      new Request("https://t.local/x", { method }),
      { maxBytes: 1024 },
    );
    expect(decision.ok).toEqual(true);
  }
});

test("evaluateBodyLimit allows POST without Content-Length by default", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", { method: "POST" }),
    { maxBytes: 1024 },
  );
  expect(decision.ok).toEqual(true);
});

test("evaluateBodyLimit rejects missing Content-Length in strict mode", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", { method: "POST" }),
    { maxBytes: 1024, requireContentLength: true },
  );
  expect(decision.ok).toEqual(false);
  if (!decision.ok) {
    expect(decision.reason).toEqual("body_length_required");
  }
});

test("evaluateBodyLimit rejects oversize body", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "x".repeat(2048),
    }),
    { maxBytes: 1024 },
  );
  expect(decision.ok).toEqual(false);
  if (!decision.ok) {
    expect(decision.reason).toEqual("body_too_large");
    expect(decision.limit).toEqual(1024);
    expect(decision.declared).toEqual(2048);
  }
});

test("evaluateBodyLimit accepts body at the cap", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: "x".repeat(1024),
    }),
    { maxBytes: 1024 },
  );
  expect(decision.ok).toEqual(true);
});

test("evaluateBodyLimit treats malformed Content-Length as missing in strict mode", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
    }),
    { maxBytes: 1024, requireContentLength: true },
  );
  expect(decision.ok).toEqual(false);
  if (!decision.ok) {
    expect(decision.reason).toEqual("body_length_required");
  }
});

test("DEFAULT_BODY_LIMIT_BYTES is 1 MiB", () => {
  expect(DEFAULT_BODY_LIMIT_BYTES).toEqual(1 * 1024 * 1024);
});

test("bodyLimit middleware returns the 413 envelope shape", async () => {
  const { Hono } = await import("hono");
  const app = new Hono();
  app.use("*", bodyLimit({ maxBytes: 16 }));
  app.post("/x", (c) => c.json({ ok: true }));
  const res = await app.fetch(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "32" },
      body: "x".repeat(32),
    }),
    {} as never,
  );
  expect(res.status).toEqual(413);
  const json = await res.json() as { error: string; limit: number };
  expect(json.error).toEqual("body_too_large");
  expect(json.limit).toEqual(16);
});
