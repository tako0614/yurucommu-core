// Bun migration: register a `Deno.test`-compatible global backed by bun:test.
//
// Preloaded (via bunfig.toml [test].preload) BEFORE any test file evaluates, so
// existing `Deno.test(...)` call sites register as bun tests with NO file edits.
// Handles every Deno.test signature used in the tree:
//   Deno.test(name, fn)
//   Deno.test(fn)                       // named from fn.name
//   Deno.test(name, options, fn)
//   Deno.test({ name, fn, ignore, only, ... })
// The test fn receives a TestContext whose `t.step(name, fn)` runs sequentially
// in-place (preserves shared mutable state across steps, unlike describe/it).
import { test as bunTest } from "bun:test";

type TestFn = (t: TestContext) => unknown | Promise<unknown>;
interface TestDef {
  name?: string;
  fn?: TestFn;
  ignore?: boolean;
  only?: boolean;
}
interface TestContext {
  name: string;
  step(name: string, fn: (t: TestContext) => unknown | Promise<unknown>): Promise<boolean>;
  step(def: { name: string; fn: (t: TestContext) => unknown | Promise<unknown> }): Promise<boolean>;
}

function makeContext(name: string): TestContext {
  const ctx: TestContext = {
    name,
    async step(a: unknown, b?: unknown): Promise<boolean> {
      const stepName = typeof a === "string" ? a : (a as { name: string }).name;
      const stepFn = (typeof a === "string" ? b : (a as { fn: TestTopFn }).fn) as TestFn;
      try {
        await stepFn(makeContext(`${name} > ${stepName}`));
        return true;
      } catch (err) {
        // Surface the step name on failure so the bun report is legible.
        if (err instanceof Error) err.message = `[step: ${stepName}] ${err.message}`;
        throw err;
      }
    },
  };
  return ctx;
}

type TestTopFn = TestFn;

function register(a: unknown, b?: unknown, c?: unknown): void {
  let name: string;
  let fn: TestFn;
  let ignore = false;
  let only = false;

  if (typeof a === "object" && a !== null) {
    const def = a as TestDef;
    name = def.name ?? def.fn?.name ?? "(anonymous)";
    fn = def.fn ?? (() => {});
    ignore = !!def.ignore;
    only = !!def.only;
  } else if (typeof a === "function") {
    fn = a as TestFn;
    name = (a as { name?: string }).name || "(anonymous)";
  } else {
    name = String(a);
    if (typeof b === "function") {
      fn = b as TestFn;
    } else if (typeof b === "object" && b !== null) {
      const opts = b as TestDef;
      ignore = !!opts.ignore;
      only = !!opts.only;
      fn = c as TestFn;
    } else {
      fn = c as TestFn;
    }
  }

  const wrapped = () => fn(makeContext(name));
  if (ignore) bunTest.skip(name, wrapped);
  else if (only) bunTest.only(name, wrapped);
  else bunTest(name, wrapped);
}

const g = globalThis as unknown as { Deno?: Record<string, unknown> };
g.Deno = Object.assign({}, g.Deno ?? {}, { test: register });

export {};
