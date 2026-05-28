import { assertEquals } from "jsr:@std/assert";
import {
  bodyLimit,
  DEFAULT_BODY_LIMIT_BYTES,
  evaluateBodyLimit,
} from "../../middleware/body-limit.ts";

Deno.test("evaluateBodyLimit allows GET / HEAD without Content-Length", () => {
  for (const method of ["GET", "HEAD", "OPTIONS", "DELETE"]) {
    const decision = evaluateBodyLimit(
      new Request("https://t.local/x", { method }),
      { maxBytes: 1024 },
    );
    assertEquals(decision.ok, true);
  }
});

Deno.test("evaluateBodyLimit allows POST without Content-Length by default", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", { method: "POST" }),
    { maxBytes: 1024 },
  );
  assertEquals(decision.ok, true);
});

Deno.test("evaluateBodyLimit rejects missing Content-Length in strict mode", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", { method: "POST" }),
    { maxBytes: 1024, requireContentLength: true },
  );
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.reason, "body_length_required");
  }
});

Deno.test("evaluateBodyLimit rejects oversize body", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "2048" },
      body: "x".repeat(2048),
    }),
    { maxBytes: 1024 },
  );
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.reason, "body_too_large");
    assertEquals(decision.limit, 1024);
    assertEquals(decision.declared, 2048);
  }
});

Deno.test("evaluateBodyLimit accepts body at the cap", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: "x".repeat(1024),
    }),
    { maxBytes: 1024 },
  );
  assertEquals(decision.ok, true);
});

Deno.test("evaluateBodyLimit treats malformed Content-Length as missing in strict mode", () => {
  const decision = evaluateBodyLimit(
    new Request("https://t.local/x", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
    }),
    { maxBytes: 1024, requireContentLength: true },
  );
  assertEquals(decision.ok, false);
  if (!decision.ok) {
    assertEquals(decision.reason, "body_length_required");
  }
});

Deno.test("DEFAULT_BODY_LIMIT_BYTES is 1 MiB", () => {
  assertEquals(DEFAULT_BODY_LIMIT_BYTES, 1 * 1024 * 1024);
});

Deno.test("bodyLimit middleware returns the 413 envelope shape", async () => {
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
  assertEquals(res.status, 413);
  const json = await res.json() as { error: string; limit: number };
  assertEquals(json.error, "body_too_large");
  assertEquals(json.limit, 16);
});
