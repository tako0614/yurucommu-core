// Bun migration shim: @std/assert -> node:assert/strict based implementation.
// Lets Deno test files keep `import { assertEquals } from "@std/assert"` while
// running under `bun test`, wired via tsconfig.json "paths". Covers every
// @std/assert symbol used across the ecosystem (full-tree census).
import nodeAssert from "node:assert/strict";

export class AssertionError extends Error {
  override name = "AssertionError";
}

export function assert(expr: unknown, msg = "Assertion failed."): asserts expr {
  if (!expr) throw new AssertionError(msg);
}

export function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  try {
    nodeAssert.deepStrictEqual(actual, expected);
  } catch {
    throw new AssertionError(msg ?? `Values are not equal.\n  actual:   ${stringify(actual)}\n  expected: ${stringify(expected)}`);
  }
}

export function assertNotEquals<T>(actual: T, expected: T, msg?: string): void {
  let equal = true;
  try {
    nodeAssert.deepStrictEqual(actual, expected);
  } catch {
    equal = false;
  }
  if (equal) throw new AssertionError(msg ?? `Values should not be equal: ${stringify(actual)}`);
}

export function assertStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(msg ?? `Values are not strictly equal.\n  actual:   ${stringify(actual)}\n  expected: ${stringify(expected)}`);
  }
}

export function assertNotStrictEquals<T>(actual: T, expected: T, msg?: string): void {
  if (Object.is(actual, expected)) throw new AssertionError(msg ?? `Values should not be strictly equal: ${stringify(actual)}`);
}

export function assertExists<T>(actual: T, msg?: string): asserts actual is NonNullable<T> {
  if (actual === undefined || actual === null) throw new AssertionError(msg ?? `Expected actual to exist but got ${actual}`);
}

export function assertFalse(expr: unknown, msg = "Expected value to be falsy."): void {
  if (expr) throw new AssertionError(msg);
}

export function assertStringIncludes(actual: string, expected: string, msg?: string): void {
  if (!actual.includes(expected)) throw new AssertionError(msg ?? `Expected string to include ${JSON.stringify(expected)}\n  actual: ${JSON.stringify(actual)}`);
}

export function assertArrayIncludes<T>(actual: ArrayLike<T>, expected: ArrayLike<T>, msg?: string): void {
  const a = Array.from(actual);
  for (const item of Array.from(expected)) {
    if (!a.some((x) => equalish(x, item))) throw new AssertionError(msg ?? `Expected array to include ${stringify(item)}`);
  }
}

export function assertMatch(actual: string, expected: RegExp, msg?: string): void {
  if (!expected.test(actual)) throw new AssertionError(msg ?? `Expected ${JSON.stringify(actual)} to match ${expected}`);
}

export function assertNotMatch(actual: string, expected: RegExp, msg?: string): void {
  if (expected.test(actual)) throw new AssertionError(msg ?? `Expected ${JSON.stringify(actual)} to not match ${expected}`);
}

export function assertObjectMatch(
  actual: Record<PropertyKey, unknown>,
  expected: Record<PropertyKey, unknown>,
  msg?: string,
): void {
  for (const key of Reflect.ownKeys(expected)) {
    const ev = (expected as Record<PropertyKey, unknown>)[key];
    const av = (actual as Record<PropertyKey, unknown>)?.[key];
    if (ev && typeof ev === "object" && !Array.isArray(ev)) {
      assertObjectMatch(av as Record<PropertyKey, unknown>, ev as Record<PropertyKey, unknown>, msg);
    } else {
      try {
        nodeAssert.deepStrictEqual(av, ev);
      } catch {
        throw new AssertionError(msg ?? `Object does not match at key ${String(key)}.\n  actual:   ${stringify(av)}\n  expected: ${stringify(ev)}`);
      }
    }
  }
}

export function assertAlmostEquals(actual: number, expected: number, tolerance = 1e-7, msg?: string): void {
  if (Math.abs(actual - expected) > tolerance) throw new AssertionError(msg ?? `Expected ${actual} to be almost equal to ${expected} (±${tolerance})`);
}

export function assertInstanceOf<T extends abstract new (...args: never) => unknown>(
  actual: unknown,
  expectedType: T,
  msg?: string,
): asserts actual is InstanceType<T> {
  if (!(actual instanceof expectedType)) throw new AssertionError(msg ?? `Expected object to be an instance of ${expectedType.name}`);
}

export function assertIsError(error: unknown, ErrorClass?: new (...a: never) => Error, msgIncludes?: string, msg?: string): void {
  if (!(error instanceof Error)) throw new AssertionError(msg ?? `Expected an Error object, got ${stringify(error)}`);
  if (ErrorClass && !(error instanceof ErrorClass)) throw new AssertionError(msg ?? `Expected error to be instance of ${ErrorClass.name}`);
  if (typeof msgIncludes === "string" && !error.message.includes(msgIncludes)) {
    throw new AssertionError(msg ?? `Expected error message to include ${JSON.stringify(msgIncludes)}`);
  }
}

export function assertThrows(fn: () => unknown, msgOrClass?: unknown, msgIncludes?: unknown, _msg?: unknown): unknown {
  let thrown: unknown;
  let didThrow = false;
  try {
    fn();
  } catch (e) {
    didThrow = true;
    thrown = e;
  }
  if (!didThrow) throw new AssertionError(typeof msgOrClass === "string" ? msgOrClass : "Expected function to throw.");
  if (typeof msgOrClass === "function" && !(thrown instanceof (msgOrClass as new (...x: never) => Error))) {
    throw new AssertionError(`Expected error to be instance of ${(msgOrClass as { name?: string }).name}`);
  }
  if (typeof msgIncludes === "string" && !(thrown as Error)?.message?.includes(msgIncludes)) {
    throw new AssertionError(`Expected error message to include ${JSON.stringify(msgIncludes)}`);
  }
  return thrown;
}

export async function assertRejects(fn: () => Promise<unknown>, msgOrClass?: unknown, msgIncludes?: unknown, _msg?: unknown): Promise<unknown> {
  let thrown: unknown;
  let didThrow = false;
  try {
    await fn();
  } catch (e) {
    didThrow = true;
    thrown = e;
  }
  if (!didThrow) throw new AssertionError(typeof msgOrClass === "string" ? msgOrClass : "Expected promise to reject.");
  if (typeof msgOrClass === "function" && !(thrown instanceof (msgOrClass as new (...x: never) => Error))) {
    throw new AssertionError(`Expected error to be instance of ${(msgOrClass as { name?: string }).name}`);
  }
  if (typeof msgIncludes === "string" && !(thrown as Error)?.message?.includes(msgIncludes)) {
    throw new AssertionError(`Expected error message to include ${JSON.stringify(msgIncludes)}`);
  }
  return thrown;
}

export function fail(msg?: string): never {
  throw new AssertionError(msg ? `Failed assertion: ${msg}` : "Failed assertion.");
}

export function unreachable(msg = "unreachable"): never {
  throw new AssertionError(msg);
}

export function equal(a: unknown, b: unknown): boolean {
  return equalish(a, b);
}

function equalish(a: unknown, b: unknown): boolean {
  try {
    nodeAssert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

function stringify(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return String(v);
  }
}
