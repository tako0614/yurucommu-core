import { expect, test } from "bun:test";

import { assertD1Statement, D1_MAX_LIKE_COMPLEXITY } from "./d1-semantics.ts";

test("LIKE/GLOB patterns use D1's 50-byte UTF-8 ceiling", () => {
  expect(() =>
    assertD1Statement("SELECT 1 FROM t WHERE c LIKE ?", [
      "x".repeat(D1_MAX_LIKE_COMPLEXITY),
    ]),
  ).not.toThrow();
  expect(() =>
    assertD1Statement("SELECT 1 FROM t WHERE c LIKE ?", [
      "x".repeat(D1_MAX_LIKE_COMPLEXITY + 1),
    ]),
  ).toThrow(/pattern too complex/);
  expect(() =>
    assertD1Statement("SELECT 1 FROM t WHERE c GLOB ?", ["あ".repeat(17)]),
  ).toThrow(/pattern too complex/);
});

test("only actual pattern operands are subject to the pattern ceiling", () => {
  expect(() =>
    assertD1Statement('SELECT ? AS "LIKE", ? AS [GLOB]', [
      "x".repeat(500),
      "y".repeat(500),
    ]),
  ).not.toThrow();
  expect(() =>
    assertD1Statement("SELECT ? AS body, 'x' LIKE ?", ["x".repeat(500), "x"]),
  ).not.toThrow();
  expect(() =>
    assertD1Statement("SELECT 1 FROM t WHERE c LIKE '%' || ? || '%'", [
      "x".repeat(D1_MAX_LIKE_COMPLEXITY),
    ]),
  ).toThrow(/pattern too complex/);
});

test("undefined bindings are rejected instead of becoming NULL", () => {
  expect(() => assertD1Statement("SELECT ?", [undefined])).toThrow(
    /D1_TYPE_ERROR/,
  );
  expect(() => assertD1Statement("SELECT ?", [null])).not.toThrow();
});
