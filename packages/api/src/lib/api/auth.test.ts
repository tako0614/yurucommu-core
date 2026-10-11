import { expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import { ApiError } from "./fetch.ts";
import { logout } from "./auth.ts";

async function withMockFetch<T>(
  fetchImpl: typeof fetch,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
}

test("logout surfaces a failed session revocation response", async () => {
  await withMockFetch(
    (async () =>
      Response.json(
        {
          error: "Session revocation failed",
          code: "SESSION_REVOCATION_FAILED",
        },
        { status: 503 },
      )) as unknown as typeof fetch,
    async () => {
      let caught: unknown;
      try {
        await logout();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ApiError);
      expect(caught).toMatchObject({
        status: 503,
        code: "SESSION_REVOCATION_FAILED",
        message: "Session revocation failed",
      });
    },
  );
});

test("logout propagates a network failure without retrying", async () => {
  const networkError = new TypeError("network unavailable");
  let fetchCalls = 0;

  await withMockFetch(
    (async () => {
      fetchCalls += 1;
      throw networkError;
    }) as unknown as typeof fetch,
    async () => {
      await expect(logout()).rejects.toBe(networkError);
      expect(fetchCalls).toBe(1);
    },
  );
});

test("logout accepts successful responses without parsing a body", async () => {
  await withMockFetch(
    (async () =>
      new Response(null, { status: 204 })) as unknown as typeof fetch,
    async () => {
      await expect(logout()).resolves.toBeUndefined();
    },
  );
});
