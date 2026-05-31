import { expect, test } from "bun:test";

import { Hono } from "hono";

import type { Env, Variables } from "../types.ts";
import {
  bodyLimit,
  DEFAULT_BODY_LIMIT_BYTES,
  evaluateBodyLimit,
} from "./body-limit.ts";

type App = Hono<{ Bindings: Env; Variables: Variables }>;

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

test("inbox-style strict mode rejects a chunked body with no Content-Length (411)", async () => {
  const app: App = new Hono();
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
  const json = await res.json() as { error: string };
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
  const app: App = new Hono();
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
  const app: App = new Hono();
  app.use("*", bodyLimit({ maxBytes: 64 }));
  app.post("/api/x", async (c) => {
    const buf = await c.req.raw.arrayBuffer();
    return c.json({ size: buf.byteLength });
  });

  const res = await app.fetch(
    chunkedRequest("https://t.local/api/x", [new Uint8Array(8)]),
  );
  expect(res.status).toEqual(200);
  const json = await res.json() as { size: number };
  expect(json.size).toEqual(8);
});

test("default cap stays at 1 MiB", () => {
  expect(DEFAULT_BODY_LIMIT_BYTES).toEqual(1 * 1024 * 1024);
});
