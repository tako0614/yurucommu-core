import { clearYurucommuApiTransport } from "../transport.ts";

type MockFetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response;

export async function withMockFetch<T>(
  handler: MockFetchHandler,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(input, init))) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
}

export function withMockJsonFetch<T>(
  responseBody: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  return withMockFetch(
    () =>
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    fn,
  );
}
