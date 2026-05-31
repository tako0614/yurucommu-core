// Bun migration shim: @std/testing/mock -> standalone implementation.
// Subset used across the tree: spy, stub, returnsNext, returnsThis,
// assertSpyCalls, assertSpyCall(Args). Standalone (not built on bun:test mock)
// so @std call-record semantics (.calls[].args / .returned / .restore()) match.
export interface SpyCall<Args extends unknown[] = unknown[], Return = unknown> {
  args: Args;
  returned?: Return;
  error?: unknown;
  self?: unknown;
}
export interface Spy<Args extends unknown[] = unknown[], Return = unknown> {
  (...args: Args): Return;
  calls: SpyCall<Args, Return>[];
  restored: boolean;
  restore(): void;
  original?: (...args: Args) => Return;
  [Symbol.dispose](): void;
}

function makeSpy<Args extends unknown[], Return>(
  impl: (...args: Args) => Return,
  restore: () => void,
  original?: (...args: Args) => Return,
): Spy<Args, Return> {
  const calls: SpyCall<Args, Return>[] = [];
  const spyFn = function (this: unknown, ...args: Args): Return {
    const record: SpyCall<Args, Return> = { args, self: this };
    try {
      const returned = impl.apply(this, args);
      record.returned = returned;
      calls.push(record);
      return returned;
    } catch (error) {
      record.error = error;
      calls.push(record);
      throw error;
    }
  } as Spy<Args, Return>;
  spyFn.calls = calls;
  spyFn.restored = false;
  spyFn.original = original;
  spyFn.restore = () => {
    if (spyFn.restored) return;
    restore();
    spyFn.restored = true;
  };
  spyFn[Symbol.dispose] = () => spyFn.restore();
  return spyFn;
}

export function spy<Args extends unknown[] = unknown[], Return = unknown>(
  fnOrObj?: ((...args: Args) => Return) | Record<PropertyKey, unknown>,
  method?: PropertyKey,
): Spy<Args, Return> {
  if (fnOrObj && method !== undefined) {
    const obj = fnOrObj as Record<PropertyKey, unknown>;
    const original = obj[method] as (...args: Args) => Return;
    const s = makeSpy<Args, Return>((...args: Args) => original.apply(obj, args), () => {
      obj[method] = original;
    }, original);
    obj[method] = s as unknown;
    return s;
  }
  const impl = (typeof fnOrObj === "function" ? fnOrObj : (() => undefined)) as (...args: Args) => Return;
  return makeSpy<Args, Return>(impl, () => {}, impl);
}

export function stub<Args extends unknown[] = unknown[], Return = unknown>(
  obj: Record<PropertyKey, unknown>,
  method: PropertyKey,
  impl?: (...args: Args) => Return,
): Spy<Args, Return> {
  const original = obj[method] as ((...args: Args) => Return) | undefined;
  const fn = impl ?? (((..._a: Args) => undefined) as unknown as (...args: Args) => Return);
  const s = makeSpy<Args, Return>(fn, () => {
    obj[method] = original as unknown;
  }, original);
  obj[method] = s as unknown;
  return s;
}

export function returnsNext<T>(values: Iterable<T>): (...args: unknown[]) => T {
  const iter = values[Symbol.iterator]();
  return () => {
    const next = iter.next();
    if (next.done) throw new Error("returnsNext: ran out of values");
    return next.value;
  };
}

export function returnsThis<Self>(): (this: Self, ...args: unknown[]) => Self {
  return function (this: Self) {
    return this;
  };
}

export function assertSpyCalls(spyFn: { calls: unknown[] }, expected: number): void {
  if (spyFn.calls.length !== expected) {
    throw new Error(`Expected spy to be called ${expected} time(s) but was called ${spyFn.calls.length} time(s).`);
  }
}

export function assertSpyCall(
  spyFn: { calls: SpyCall[] },
  callIndex: number,
  expected?: { args?: unknown[]; returned?: unknown; self?: unknown },
): void {
  const call = spyFn.calls[callIndex];
  if (!call) throw new Error(`Spy not called ${callIndex + 1} time(s).`);
  if (expected?.args) {
    const a = JSON.stringify(call.args);
    const b = JSON.stringify(expected.args);
    if (a !== b) throw new Error(`Spy call ${callIndex} args mismatch.\n  actual:   ${a}\n  expected: ${b}`);
  }
}

export function assertSpyCallArgs<T extends unknown[]>(
  spyFn: { calls: SpyCall[] },
  callIndex: number,
  expectedArgs: T,
): void {
  const call = spyFn.calls[callIndex];
  if (!call) throw new Error(`Spy not called ${callIndex + 1} time(s).`);
  const a = JSON.stringify(call.args);
  const b = JSON.stringify(expectedArgs);
  if (a !== b) throw new Error(`Spy call ${callIndex} args mismatch.\n  actual:   ${a}\n  expected: ${b}`);
}
