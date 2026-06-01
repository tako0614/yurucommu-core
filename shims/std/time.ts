// Bun test time helpers with a self-contained FakeTime.
//
// FakeTime installs a controllable virtual clock: it freezes Date.now()/
// new Date(), and queues timers so tests can advance time deterministically via
// tick()/tickAsync(). This provides the subset used by yurucommu tests:
// `new FakeTime(now?)`, `.now`, `.tick(ms)`, `.tickAsync(ms)`, `.restore()`.

type TimerCallback = (...args: unknown[]) => void;

interface QueuedTimer {
  id: number;
  due: number;
  interval: number | null;
  callback: TimerCallback;
  args: unknown[];
}

// Tracks the most recently constructed, not-yet-restored FakeTime so a
// bun:test afterEach safety net can force-restore a clock that a test forgot
// to (or whose afterEach hook did not fire) before the next test runs.
let activeFakeTime: FakeTime | undefined;

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

    this.#realDateNow = Date.now;
    this.#realDate = Date;
    this.#realSetTimeout = globalThis.setTimeout;
    this.#realClearTimeout = globalThis.clearTimeout;
    this.#realSetInterval = globalThis.setInterval;
    this.#realClearInterval = globalThis.clearInterval;

    const now = () => this.#now;

    // Patch Date.now to the virtual clock.
    Date.now = () => now();

    // Patch new Date()/Date() with no args to the virtual clock; preserve all
    // other construction forms and static members.
    const RealDate = this.#realDate;
    const FakeDateCtor = function (
      this: unknown,
      ...args: unknown[]
    ): unknown {
      if (args.length === 0) {
        return new RealDate(now());
      }
      return new (RealDate as any)(...args);
    } as unknown as DateConstructor;
    (FakeDateCtor as { prototype: Date }).prototype = RealDate.prototype;
    FakeDateCtor.now = () => now();
    FakeDateCtor.parse = RealDate.parse;
    FakeDateCtor.UTC = RealDate.UTC;
    (globalThis as any).Date = FakeDateCtor;

    // Patch timers to the virtual queue.
    (globalThis as any).setTimeout = (
      cb: TimerCallback,
      ms = 0,
      ...a: unknown[]
    ) => this.#schedule(cb, ms, null, a);
    (globalThis as any).setInterval = (
      cb: TimerCallback,
      ms = 0,
      ...a: unknown[]
    ) => this.#schedule(cb, ms, ms, a);
    (globalThis as any).clearTimeout = (id?: number) => this.#cancel(id);
    (globalThis as any).clearInterval = (id?: number) => this.#cancel(id);

    // Record as the active (installed) fake clock so a forgotten/late restore
    // can be cleaned up at test-scope exit before it leaks into the next test.
    activeFakeTime = this;
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
    if (activeFakeTime === this) activeFakeTime = undefined;
    Date.now = this.#realDateNow;
    (globalThis as any).Date = this.#realDate;
    (globalThis as any).setTimeout = this.#realSetTimeout;
    (globalThis as any).clearTimeout = this.#realClearTimeout;
    (globalThis as any).setInterval = this.#realSetInterval;
    (globalThis as any).clearInterval = this.#realClearInterval;
    this.#timers = [];
  }

  [Symbol.dispose](): void {
    this.restore();
  }
}

// Pristine globals captured at module-eval time, before any FakeTime is
// constructed. These are the ground-truth real implementations we restore to.
const PRISTINE_DATE = globalThis.Date;
const PRISTINE_DATE_NOW = globalThis.Date.now;
const PRISTINE_SET_TIMEOUT = globalThis.setTimeout;
const PRISTINE_CLEAR_TIMEOUT = globalThis.clearTimeout;
const PRISTINE_SET_INTERVAL = globalThis.setInterval;
const PRISTINE_CLEAR_INTERVAL = globalThis.clearInterval;

// Safety net for bun:test. A suite that installs FakeTime (e.g.
// `const t = new FakeTime(new Date("2026-02-18..."))`) and restores it in a
// try/finally works fine in isolation, but under bun:test the global Date
// patch can still be observed by a LATER test file before the restore is
// visible across the file boundary — freezing new Date()/Date.now() at the
// fake clock. That silently breaks time-sensitive assertions downstream (the
// activitypub inbox HTTP-signature freshness window: a frozen 2026-02 clock
// vs a real-time signed Date header exceeds MAX_SIGNATURE_AGE_MS => 401).
//
// To make the leak impossible regardless of lifecycle timing, hard-reset the
// global time primitives to the pristine implementations after EVERY test —
// unconditionally, not only when a FakeTime is still flagged active. A test
// that genuinely needs fake time installs it inside its own body and tears it
// down before asserting, so a post-test reset never interferes. Best-effort
// and Bun-only: when the `bun:test` import throws (caught), no reset is needed.
try {
  const bunTest = (await import("bun:test")) as {
    afterEach?: (fn: () => void) => void;
  };
  bunTest.afterEach?.(() => {
    activeFakeTime?.restore();
    // Unconditional hard reset in case restore() did not run or did not take
    // effect across the test/file boundary.
    if (globalThis.Date !== PRISTINE_DATE) globalThis.Date = PRISTINE_DATE;
    if (globalThis.Date.now !== PRISTINE_DATE_NOW) {
      globalThis.Date.now = PRISTINE_DATE_NOW;
    }
    globalThis.setTimeout = PRISTINE_SET_TIMEOUT;
    globalThis.clearTimeout = PRISTINE_CLEAR_TIMEOUT;
    globalThis.setInterval = PRISTINE_SET_INTERVAL;
    globalThis.clearInterval = PRISTINE_CLEAR_INTERVAL;
    activeFakeTime = undefined;
  });
} catch {
  // Not running under bun:test — nothing to install.
}
