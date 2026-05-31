// Bun migration shim: @std/testing/time -> self-contained FakeTime.
//
// Deno std's FakeTime installs a controllable virtual clock: it freezes
// Date.now()/new Date(), and queues timers so the test can advance time
// deterministically via tick()/tickAsync(). bun:test does not expose an
// @std-compatible FakeTime, so this provides the subset used by yurucommu
// tests: `new FakeTime(now?)`, `.now`, `.tick(ms)`, `.tickAsync(ms)`,
// `.restore()`. Wired via tsconfig.json "paths".

type TimerCallback = (...args: unknown[]) => void;

interface QueuedTimer {
  id: number;
  due: number;
  interval: number | null;
  callback: TimerCallback;
  args: unknown[];
}

export class FakeTime {
  #now: number;
  #timers: QueuedTimer[] = [];
  #nextId = 1;
  #restored = false;

  // Saved real globals.
  #realDateNow: typeof Date.now;
  #realDate: typeof Date;
  #realSetTimeout: typeof setTimeout;
  #realClearTimeout: typeof clearTimeout;
  #realSetInterval: typeof setInterval;
  #realClearInterval: typeof clearInterval;

  constructor(start?: number | Date) {
    this.#now = start instanceof Date
      ? start.getTime()
      : (typeof start === "number" ? start : Date.now());

    const self = this;
    this.#realDateNow = Date.now;
    this.#realDate = Date;
    this.#realSetTimeout = globalThis.setTimeout;
    this.#realClearTimeout = globalThis.clearTimeout;
    this.#realSetInterval = globalThis.setInterval;
    this.#realClearInterval = globalThis.clearInterval;

    // Patch Date.now to the virtual clock.
    Date.now = () => self.#now;

    // Patch new Date()/Date() with no args to the virtual clock; preserve all
    // other construction forms and static members.
    const RealDate = this.#realDate;
    const FakeDateCtor = function (
      this: unknown,
      ...args: unknown[]
    ): unknown {
      if (args.length === 0) {
        return new RealDate(self.#now);
      }
      // deno-lint-ignore no-explicit-any
      return new (RealDate as any)(...args);
    } as unknown as DateConstructor;
    FakeDateCtor.prototype = RealDate.prototype;
    FakeDateCtor.now = () => self.#now;
    FakeDateCtor.parse = RealDate.parse;
    FakeDateCtor.UTC = RealDate.UTC;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Date = FakeDateCtor;

    // Patch timers to the virtual queue.
    // deno-lint-ignore no-explicit-any
    (globalThis as any).setTimeout = (cb: TimerCallback, ms = 0, ...a: unknown[]) =>
      self.#schedule(cb, ms, null, a);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).setInterval = (cb: TimerCallback, ms = 0, ...a: unknown[]) =>
      self.#schedule(cb, ms, ms, a);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).clearTimeout = (id?: number) => self.#cancel(id);
    // deno-lint-ignore no-explicit-any
    (globalThis as any).clearInterval = (id?: number) => self.#cancel(id);
  }

  get now(): number {
    return this.#now;
  }

  set now(value: number) {
    this.#now = value;
  }

  #schedule(
    callback: TimerCallback,
    ms: number,
    interval: number | null,
    args: unknown[],
  ): number {
    const id = this.#nextId++;
    this.#timers.push({
      id,
      due: this.#now + Math.max(0, ms),
      interval,
      callback,
      args,
    });
    return id;
  }

  #cancel(id?: number): void {
    if (id === undefined) return;
    const i = this.#timers.findIndex((t) => t.id === id);
    if (i >= 0) this.#timers.splice(i, 1);
  }

  #drainDue(target: number): void {
    // Fire all timers due at or before target, in chronological order.
    while (true) {
      this.#timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const next = this.#timers[0];
      if (!next || next.due > target) break;
      this.#now = next.due;
      if (next.interval !== null) {
        next.due = this.#now + Math.max(1, next.interval);
      } else {
        this.#timers.shift();
      }
      next.callback(...next.args);
    }
    this.#now = target;
  }

  tick(ms = 0): void {
    this.#drainDue(this.#now + Math.max(0, ms));
  }

  async tickAsync(ms = 0): Promise<void> {
    const target = this.#now + Math.max(0, ms);
    while (true) {
      this.#timers.sort((a, b) => a.due - b.due || a.id - b.id);
      const next = this.#timers[0];
      if (!next || next.due > target) break;
      this.#now = next.due;
      if (next.interval !== null) {
        next.due = this.#now + Math.max(1, next.interval);
      } else {
        this.#timers.shift();
      }
      await next.callback(...next.args);
      // Let microtasks/promises settle between timer firings.
      await Promise.resolve();
    }
    this.#now = target;
  }

  async runMicrotasks(): Promise<void> {
    await Promise.resolve();
  }

  restore(): void {
    if (this.#restored) return;
    this.#restored = true;
    Date.now = this.#realDateNow;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).Date = this.#realDate;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).setTimeout = this.#realSetTimeout;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).clearTimeout = this.#realClearTimeout;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).setInterval = this.#realSetInterval;
    // deno-lint-ignore no-explicit-any
    (globalThis as any).clearInterval = this.#realClearInterval;
    this.#timers = [];
  }

  [Symbol.dispose](): void {
    this.restore();
  }
}
