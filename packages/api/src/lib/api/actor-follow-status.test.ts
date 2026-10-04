import { expect, test } from "bun:test";

import { clearYurucommuApiTransport } from "../transport.ts";
import { fetchActor } from "./actors.ts";
import { InvalidApiResponseError } from "./response.ts";

function actor(outgoing_follow_status?: unknown) {
  return {
    ap_id: "https://example.com/ap/users/alice",
    preferred_username: "alice",
    ...(outgoing_follow_status === undefined ? {} : { outgoing_follow_status }),
  };
}

function outgoingStatus(value: object): unknown {
  return (value as Record<string, unknown>).outgoing_follow_status;
}

async function withMockFetch<T>(
  body: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = Object.assign(
    async () =>
      new Response(JSON.stringify({ actor: body }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    { preconnect: originalFetch.preconnect },
  );

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
}

test("fetchActor accepts legacy omission and preserves valid outgoing status", async () => {
  const legacy = await withMockFetch(actor(), () => fetchActor("alice"));
  expect(legacy).not.toHaveProperty("outgoing_follow_status");

  for (const status of ["none", "pending", "accepted"] as const) {
    const result = await withMockFetch(actor(status), () =>
      fetchActor("alice"),
    );
    expect(outgoingStatus(result)).toBe(status);
    expect(result.username).toBe("alice@example.com");
  }
});

test("fetchActor rejects malformed outgoing status values as invalid API responses", async () => {
  for (const status of [null, 1, false, "rejected", "unknown"]) {
    await expect(
      withMockFetch(actor(status), () => fetchActor("alice")),
    ).rejects.toBeInstanceOf(InvalidApiResponseError);
  }
});
