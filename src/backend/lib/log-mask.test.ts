import { expect, test } from "bun:test";

import { maskSensitiveData } from "./log-mask.ts";

test("maskSensitiveData coerces BigInt so JSON.stringify never throws", () => {
  const masked = maskSensitiveData({
    count: 42n,
    nested: { big: 9007199254740993n },
  });
  // The mask result must be JSON-serializable (BigInt would otherwise throw).
  const line = JSON.stringify(masked);
  expect(line.includes("42n")).toEqual(true);
  expect(line.includes("9007199254740993n")).toEqual(true);
});

test("maskSensitiveData preserves Date as ISO string instead of {}", () => {
  const d = new Date("2026-05-28T00:00:00.000Z");
  const masked = maskSensitiveData({ at: d }) as { at: unknown };
  expect(masked.at).toEqual("2026-05-28T00:00:00.000Z");
});

test("maskSensitiveData represents Map / Set instead of flattening to {}", () => {
  const masked = maskSensitiveData({
    m: new Map([["a", 1], ["b", 2]]),
    s: new Set(["x", "y"]),
  }) as { m: Record<string, unknown>; s: unknown[] };
  expect(masked.m).toEqual({ a: 1, b: 2 });
  expect(masked.s).toEqual(["x", "y"]);
});

test("maskSensitiveData redacts sensitive Map keys", () => {
  const masked = maskSensitiveData({
    m: new Map([["password", "hunter2"], ["ok", "v"]]),
  }) as { m: Record<string, unknown> };
  expect(masked.m.password).toEqual("[redacted]");
  expect(masked.m.ok).toEqual("v");
});

test("maskSensitiveData never throws on un-walkable values", () => {
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
  expect(typeof masked).toEqual("object");
});

test("maskSensitiveData masks secrets inside bigint-bearing objects", () => {
  const masked = maskSensitiveData({
    token: "abc",
    id: 7n,
  }) as { token: unknown; id: unknown };
  expect(masked.token).toEqual("[redacted]");
  expect(masked.id).toEqual("7n");
});
