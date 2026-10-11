import { expect, test } from "bun:test";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";

async function mockHeaders(run: (signal: () => AbortSignal) => Promise<void>) {
  const original = globalThis.fetch;
  let signal: AbortSignal | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  try {
    await run(() => {
      if (!signal) throw new Error("fetch did not receive an abort signal");
      return signal;
    });
  } finally {
    globalThis.fetch = original;
  }
}

test("request deadline remains active after response headers", async () => {
  await mockHeaders(async (signal) => {
    await fetchWithTimeout("https://example.invalid/api", { timeoutMs: 20 });
    await Bun.sleep(40);
    expect(signal().aborted).toBe(true);
  });
});

test("caller cancellation after headers still aborts the fetch body", async () => {
  await mockHeaders(async (signal) => {
    const caller = new AbortController();
    await fetchWithTimeout("https://example.invalid/api", {
      signal: caller.signal,
      timeoutMs: 30,
    });
    const reason = new Error("obsolete view");
    caller.abort(reason);
    expect(signal().aborted).toBe(true);
    expect(signal().reason).toBe(reason);
  });
});

test("input Request cancellation is preserved when init omits signal", async () => {
  await mockHeaders(async (signal) => {
    const caller = new AbortController();
    const input = new Request("https://example.invalid/api", {
      signal: caller.signal,
    });
    await fetchWithTimeout(input, { timeoutMs: 30 });
    caller.abort();
    expect(signal().aborted).toBe(true);
  });
});

test("an already cancelled Request fails before calling the transport", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}");
  }) as unknown as typeof fetch;
  const caller = new AbortController();
  const reason = new Error("view already left");
  caller.abort(reason);
  try {
    const input = new Request("https://example.invalid/api", {
      signal: caller.signal,
    });
    await expect(fetchWithTimeout(input)).rejects.toBe(reason);
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
  }
});

test("explicit init signal overrides a preaborted Request, including null", async () => {
  const original = globalThis.fetch;
  const response = new Response("{}");
  const old = new AbortController();
  old.abort("old request");
  const input = new Request("https://example.invalid/api", {
    signal: old.signal,
  });
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  try {
    expect(await fetchWithTimeout(input, { signal: null, timeoutMs: 0 })).toBe(
      response,
    );
    const current = new AbortController();
    expect(
      await fetchWithTimeout(input, { signal: current.signal, timeoutMs: 20 }),
    ).toBe(response);
  } finally {
    globalThis.fetch = original;
  }
});

test("null bodies and fetch rejection promptly remove the caller listener", async () => {
  const original = globalThis.fetch;
  for (const rejected of [false, true]) {
    const caller = new AbortController();
    const remove = caller.signal.removeEventListener.bind(caller.signal);
    let removed = 0;
    caller.signal.removeEventListener = (
      ...args: Parameters<AbortSignal["removeEventListener"]>
    ) => {
      removed++;
      remove(...args);
    };
    const failure = new Error("network failed");
    globalThis.fetch = (async () => {
      if (rejected) throw failure;
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    try {
      if (rejected)
        await expect(
          fetchWithTimeout("https://example.invalid", {
            signal: caller.signal,
          }),
        ).rejects.toBe(failure);
      else
        expect(
          (
            await fetchWithTimeout("https://example.invalid", {
              signal: caller.signal,
            })
          ).status,
        ).toBe(204);
      expect(removed).toBe(1);
    } finally {
      globalThis.fetch = original;
    }
  }
});

test("body response listener is retained until cancellation or deadline", async () => {
  await mockHeaders(async () => {
    for (const cancel of [false, true]) {
      const caller = new AbortController();
      const remove = caller.signal.removeEventListener.bind(caller.signal);
      let removed = 0;
      caller.signal.removeEventListener = (
        ...args: Parameters<AbortSignal["removeEventListener"]>
      ) => {
        removed++;
        remove(...args);
      };
      await fetchWithTimeout("https://example.invalid", {
        signal: caller.signal,
        timeoutMs: 20,
      });
      expect(removed).toBe(0);
      if (cancel) caller.abort("finished view");
      else await Bun.sleep(40);
      expect(removed).toBe(1);
    }
  });
});

test("default and upload deadlines begin before fetch headers, with native identity retained", async () => {
  const { DEFAULT_REQUEST_TIMEOUT_MS, UPLOAD_REQUEST_TIMEOUT_MS } =
    await import("./fetch-with-timeout.ts");
  const originalFetch = globalThis.fetch;
  const originalTimer = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const delays: number[] = [];
  const response = Response.error(); // null/opaque-like metadata must remain untouched
  globalThis.setTimeout = ((callback: () => void, delay: number) => {
    delays.push(delay);
    return originalTimer(callback, delay);
  }) as typeof setTimeout;
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  try {
    expect(await fetchWithTimeout("https://example.invalid")).toBe(response);
    expect(
      await fetchWithTimeout("https://example.invalid", {
        timeoutMs: UPLOAD_REQUEST_TIMEOUT_MS,
      }),
    ).toBe(response);
    expect(delays).toEqual([
      DEFAULT_REQUEST_TIMEOUT_MS,
      UPLOAD_REQUEST_TIMEOUT_MS,
    ]);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalTimer;
    globalThis.clearTimeout = originalClear;
  }
});
