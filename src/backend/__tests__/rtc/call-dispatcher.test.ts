import { expect, test } from "bun:test";
import { createCallDispatcher } from "../../runtime/call-dispatcher.ts";
import {
  CALL_RELAY_JOB_MAX_BYTES,
  type CallRelayResult,
} from "../../runtime/call-relay.ts";

const LOCAL = "https://local.example/ap/users/alice";
const PEER = "https://peer.example/ap/users/bob";
const UUID = "00000000-0000-4000-8000-000000000001";

function job(overrides: Record<string, unknown> = {}) {
  return {
    effect: {
      effectId: UUID,
      callId: "call-1",
      generation: "00000000-0000-4000-8000-000000000002",
      deadline: Date.now() + 8_000,
      signalType: "offer",
      continuation: "none",
    },
    envelope: {
      v: 1,
      callId: "call-1",
      from: LOCAL,
      to: PEER,
      type: "offer",
      sdp: "SECRET-SDP",
      ts: Date.now(),
      ttlMs: 30_000,
    },
    ...overrides,
  };
}

function request(path: string, value: unknown) {
  return new Request(`https://dispatcher.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function context() {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("condition was not reached");
}

test("/_dispatch registers waitUntil and returns 202 without awaiting peer or callback", async () => {
  const send = deferred<void>();
  const report = deferred<void>();
  let callbackStarted = false;
  const dispatcher = createCallDispatcher({
    send: () => send.promise,
    report: async () => {
      callbackStarted = true;
      await report.promise;
    },
  });
  const ctx = context();

  const response = await dispatcher.fetch(request("/_dispatch", job()), ctx);
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ accepted: true, effectId: UUID });
  expect(ctx.tasks).toHaveLength(1);
  expect(callbackStarted).toBe(false);

  send.resolve();
  await until(() => callbackStarted);
  // A running callback must not delay the already-returned accepted response.
  expect(response.status).toBe(202);
  report.resolve();
  await Promise.all(ctx.tasks);
});

test("a callback that does not settle keeps its job slot reserved", async () => {
  const blockedCallbacks: ReturnType<typeof deferred<void>>[] = [];
  const dispatcher = createCallDispatcher({
    send: async () => {},
    report: async () => {
      const item = deferred<void>();
      blockedCallbacks.push(item);
      await item.promise;
    },
  });
  const contexts = Array.from({ length: 8 }, context);
  const responses = await Promise.all(
    contexts.map((ctx) => dispatcher.fetch(request("/_dispatch", job()), ctx)),
  );
  expect(responses.every((response) => response.status === 202)).toBe(true);
  await until(() => blockedCallbacks.length === 8);
  const full = await dispatcher.fetch(request("/_dispatch", job()), context());
  expect(full.status).toBe(503);
  for (const callback of blockedCallbacks) callback.resolve();
  await Promise.all(contexts.flatMap((ctx) => ctx.tasks));
});

test("aborted uncancellable sends keep capacity until the actual send settles", async () => {
  const pending: ReturnType<typeof deferred<void>>[] = [];
  const signals: AbortSignal[] = [];
  const dispatcher = createCallDispatcher({
    now: Date.now,
    send: (_job, signal) => {
      signals.push(signal);
      const item = deferred<void>();
      pending.push(item);
      return item.promise;
    },
    report: async () => {},
  });
  const contexts = Array.from({ length: 8 }, context);
  const accepted = await Promise.all(
    contexts.map((ctx) =>
      dispatcher.fetch(
        request("/_dispatch", {
          ...job(),
          effect: { ...job().effect, deadline: Date.now() + 40 },
        }),
        ctx,
      ),
    ),
  );
  expect(accepted.every((response) => response.status === 202)).toBe(true);
  await until(() => signals.length === 8);
  await until(() => signals.every((signal) => signal.aborted));

  const stillFull = await dispatcher.fetch(
    request("/_dispatch", job()),
    context(),
  );
  expect(stillFull.status).toBe(503);

  for (const item of pending) item.resolve();
  await Promise.all(contexts.flatMap((ctx) => ctx.tasks));
});

test("live payload budget is capped independently of the eight-job count", async () => {
  const pending: ReturnType<typeof deferred<void>>[] = [];
  const dispatcher = createCallDispatcher({
    send: () => {
      const item = deferred<void>();
      pending.push(item);
      return item.promise;
    },
    report: async () => {},
  });
  const contexts = Array.from({ length: 3 }, context);
  const largeJob = {
    ...job(),
    ignoredPadding: "x".repeat(1_397_000),
  };
  const accepted = await Promise.all(
    contexts.map((ctx) =>
      dispatcher.fetch(request("/_dispatch", largeJob), ctx),
    ),
  );
  expect(accepted.every((response) => response.status === 202)).toBe(true);
  await until(() => pending.length === 3);

  const overBudget = await dispatcher.fetch(
    request("/_dispatch", largeJob),
    context(),
  );
  expect(overBudget.status).toBe(503);
  for (const item of pending) item.resolve();
  await Promise.all(contexts.flatMap((ctx) => ctx.tasks));
});

test("send failure is attempted once and only reports a compact failed result", async () => {
  let attempts = 0;
  const reports: { result: CallRelayResult; actor: string }[] = [];
  const ctx = context();
  const dispatcher = createCallDispatcher({
    send: async () => {
      attempts += 1;
      throw new Error("transport failed");
    },
    report: async (result, actor) => {
      reports.push({ result, actor });
    },
  });
  const response = await dispatcher.fetch(request("/_dispatch", job()), ctx);
  expect(response.status).toBe(202);
  await Promise.all(ctx.tasks);
  expect(attempts).toBe(1);
  expect(reports).toHaveLength(1);
  expect(reports[0]?.actor).toBe(LOCAL);
  expect(reports[0]?.result.outcome).toBe("failed");
  expect(JSON.stringify(reports[0])).not.toContain("SECRET-SDP");
});

test("expired, invalid, oversized, and unknown requests are rejected", async () => {
  const dispatcher = createCallDispatcher({
    now: () => 10_000,
    send: async () => {},
    report: async () => {},
  });
  expect(
    (
      await dispatcher.fetch(
        request(
          "/_dispatch",
          job({ effect: { ...job().effect, deadline: 9_999 } }),
        ),
        context(),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await dispatcher.fetch(
        request("/_dispatch", { ...job(), envelope: {} }),
        context(),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await dispatcher.fetch(
        new Request("https://dispatcher.internal/_dispatch", {
          method: "POST",
          headers: { "Content-Length": String(CALL_RELAY_JOB_MAX_BYTES + 1) },
          body: "{}",
        }),
        context(),
      )
    ).status,
  ).toBe(413);
  expect(
    (await dispatcher.fetch(request("/_private", job()), context())).status,
  ).toBe(404);
});

test("admission rejects stale envelopes and effects beyond envelope expiry", async () => {
  const current = Date.now();
  let attempts = 0;
  const dispatcher = createCallDispatcher({
    now: () => current,
    send: async () => {
      attempts += 1;
    },
    report: async () => {},
  });

  const expiredEnvelope = job();
  expiredEnvelope.effect.deadline = current + 5_000;
  expiredEnvelope.envelope.ts = current - 31_000;
  const expired = await dispatcher.fetch(
    request("/_dispatch", expiredEnvelope),
    context(),
  );
  expect(expired.status).toBe(400);

  const lateEffect = job();
  lateEffect.envelope.ts = current;
  lateEffect.envelope.ttlMs = 3_000;
  lateEffect.effect.deadline = current + 5_000;
  const beyondExpiry = await dispatcher.fetch(
    request("/_dispatch", lateEffect),
    context(),
  );
  expect(beyondExpiry.status).toBe(400);
  expect(attempts).toBe(0);
});

test("send rechecks envelope freshness before attempting the peer POST", async () => {
  const current = Date.now();
  let clockReads = 0;
  let attempts = 0;
  const reports: CallRelayResult[] = [];
  const dispatcher = createCallDispatcher({
    now: () => (clockReads++ === 0 ? current : current + 31_000),
    send: async () => {
      attempts += 1;
    },
    report: async (result) => {
      reports.push(result);
    },
  });
  const ctx = context();
  const response = await dispatcher.fetch(request("/_dispatch", job()), ctx);
  expect(response.status).toBe(202);
  await Promise.all(ctx.tasks);
  expect(attempts).toBe(0);
  expect(reports[0]?.outcome).toBe("failed");
});

test("/_send waits for and returns the actual result without callback", async () => {
  let attempts = 0;
  let callbacks = 0;
  const dispatcher = createCallDispatcher({
    send: async () => {
      attempts += 1;
    },
    report: async () => {
      callbacks += 1;
    },
  });
  const response = await dispatcher.fetch(request("/_send", job()), context());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    effectId: UUID,
    outcome: "peer_ack",
  });
  expect(attempts).toBe(1);
  expect(callbacks).toBe(0);
});
