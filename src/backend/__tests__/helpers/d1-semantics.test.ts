import { expect, test } from "bun:test";

import {
  assertD1Statement,
  D1_MAX_COMPOUND_SELECT_TERMS,
  D1_MAX_LIKE_COMPLEXITY,
} from "./d1-semantics.ts";

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

test("compound SELECT chains use D1's five-term ceiling", () => {
  const chain = (terms: number) =>
    Array.from({ length: terms }, (_, index) => `SELECT ${index + 1}`).join(
      " UNION ",
    );

  expect(() =>
    assertD1Statement(chain(D1_MAX_COMPOUND_SELECT_TERMS), []),
  ).not.toThrow();
  expect(() =>
    assertD1Statement(chain(D1_MAX_COMPOUND_SELECT_TERMS + 1), []),
  ).toThrow(/too many terms in compound SELECT/);
  expect(() =>
    assertD1Statement(
      `SELECT * FROM (${chain(5)}) AS left_chain ` +
        `JOIN (${chain(5)}) AS right_chain ON 1 = 1`,
      [],
    ),
  ).not.toThrow();
  expect(() =>
    assertD1Statement("SELECT 'UNION SELECT UNION SELECT'", []),
  ).not.toThrow();
});
