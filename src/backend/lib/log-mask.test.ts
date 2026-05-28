import { assertEquals } from "jsr:@std/assert";

import { maskSensitiveData } from "./log-mask.ts";

Deno.test("maskSensitiveData coerces BigInt so JSON.stringify never throws", () => {
  const masked = maskSensitiveData({
    count: 42n,
    nested: { big: 9007199254740993n },
  });
  // The mask result must be JSON-serializable (BigInt would otherwise throw).
  const line = JSON.stringify(masked);
  assertEquals(line.includes("42n"), true);
  assertEquals(line.includes("9007199254740993n"), true);
});

Deno.test("maskSensitiveData preserves Date as ISO string instead of {}", () => {
  const d = new Date("2026-05-28T00:00:00.000Z");
  const masked = maskSensitiveData({ at: d }) as { at: unknown };
  assertEquals(masked.at, "2026-05-28T00:00:00.000Z");
});

Deno.test("maskSensitiveData represents Map / Set instead of flattening to {}", () => {
  const masked = maskSensitiveData({
    m: new Map([["a", 1], ["b", 2]]),
    s: new Set(["x", "y"]),
  }) as { m: Record<string, unknown>; s: unknown[] };
  assertEquals(masked.m, { a: 1, b: 2 });
  assertEquals(masked.s, ["x", "y"]);
});

Deno.test("maskSensitiveData redacts sensitive Map keys", () => {
  const masked = maskSensitiveData({
    m: new Map([["password", "hunter2"], ["ok", "v"]]),
  }) as { m: Record<string, unknown> };
  assertEquals(masked.m.password, "[redacted]");
  assertEquals(masked.m.ok, "v");
});

Deno.test("maskSensitiveData never throws on un-walkable values", () => {
  // A getter that throws would otherwise crash the whole log call.
  const hostile = {} as Record<string, unknown>;
  Object.defineProperty(hostile, "boom", {
    enumerable: true,
    get() {
      throw new Error("nope");
    },
  });
  const masked = maskSensitiveData({ hostile });
  // Must produce a JSON-serializable placeholder rather than throwing.
  JSON.stringify(masked);
  assertEquals(typeof masked, "object");
});

Deno.test("maskSensitiveData masks secrets inside bigint-bearing objects", () => {
  const masked = maskSensitiveData({
    token: "abc",
    id: 7n,
  }) as { token: unknown; id: unknown };
  assertEquals(masked.token, "[redacted]");
  assertEquals(masked.id, "7n");
});
