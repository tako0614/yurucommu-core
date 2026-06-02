import { expect, test } from "bun:test";

import { Hono } from "hono";

import {
  bodyLimit,
  DEFAULT_BODY_LIMIT_BYTES,
  evaluateBodyLimit,
} from "../../middleware/body-limit.ts";

function chunkedRequest(url: string, chunks: Uint8Array[]): Request {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request(url, {
    method: "POST",
    body: stream,
    // @ts-expect-error duplex required for stream bodies, not in lib typings
    duplex: "half",
  });
}

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
  const json = (await res.json()) as { error: string; limit: number };
  expect(json.error).toEqual("body_too_large");
  expect(json.limit).toEqual(16);
});

test("inbox-style strict mode rejects a chunked body with no Content-Length (411)", async () => {
  const app = new Hono();
  // Mirrors the unauthenticated /ap/*/inbox registration.
  app.use(
    "/ap/*/inbox",
    bodyLimit({ maxBytes: 512 * 1024, requireContentLength: true }),
  );
  app.post("/ap/u/inbox", (c) => c.json({ ok: true }));

  const res = await app.fetch(
    chunkedRequest("https://t.local/ap/u/inbox", [new Uint8Array(1024 * 1024)]),
  );
  expect(res.status).toEqual(411);
  const json = (await res.json()) as { error: string };
  expect(json.error).toEqual("body_length_required");
});

test("strict mode accepts a request that declares Content-Length", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/ap/u/inbox", {
      method: "POST",
      headers: { "content-length": "32" },
      body: "x".repeat(32),
    }),
    { maxBytes: 512 * 1024, requireContentLength: true },
  );
  expect(decision.ok).toEqual(true);
});

test("default (non-strict) middleware caps a chunked oversize body via stream counter", async () => {
  const app = new Hono();
  app.use("*", bodyLimit({ maxBytes: 8 }));
  app.post("/api/x", async (c) => {
    await c.req.raw.arrayBuffer();
    return c.json({ ok: true });
  });

  const res = await app.fetch(
    chunkedRequest("https://t.local/api/x", [new Uint8Array(64)]),
  );
  // The capped stream errors while being consumed; the handler's success body
  // must NOT be returned.
  const text = await res.text();
  expect(text.includes('"ok":true')).toEqual(false);
});

test("default middleware lets a chunked under-cap body through", async () => {
  const app = new Hono();
  app.use("*", bodyLimit({ maxBytes: 64 }));
  app.post("/api/x", async (c) => {
    const buf = await c.req.raw.arrayBuffer();
    return c.json({ size: buf.byteLength });
  });

  const res = await app.fetch(
    chunkedRequest("https://t.local/api/x", [new Uint8Array(8)]),
  );
  expect(res.status).toEqual(200);
  const json = (await res.json()) as { size: number };
  expect(json.size).toEqual(8);
});
