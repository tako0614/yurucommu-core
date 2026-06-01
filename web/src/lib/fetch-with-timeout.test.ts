import { assertEquals, assertRejects } from "#test/assert";
import { test } from "bun:test";
import { fetchWithTimeout } from "./fetch-with-timeout.ts";

test("fetchWithTimeout - aborts pending requests after timeout", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      }, { once: true });
    });
  }) as typeof fetch;

  try {
    const request = fetchWithTimeout("https://example.com/api/auth/me", {
      timeoutMs: 10,
    });
    await assertRejects(
      () => request,
      DOMException,
      "The operation was aborted.",
    );
    assertEquals(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
