import { expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import type { Notification } from "../../types/index.ts";
import { fetchNotifications } from "./notifications.ts";

function makeNotification(id: string): Notification {
  return {
    id,
    type: "like",
    actor: {
      ap_id: "https://example.com/ap/users/alice",
      username: "alice@example.com",
      preferred_username: "alice",
      name: "Alice",
      icon_url: null,
    },
    object_ap_id: null,
    read: false,
    created_at: "2026-01-01T00:00:00.000Z",
  } as unknown as Notification;
}

async function withMockFetch<T>(
  responseBody: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = ((_input: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
}

// Regression: the notifications "load older" affordance depends on the client
// surfacing the server's `has_more` (it was previously discarded).
test("fetchNotifications surfaces has_more as hasMore and maps notifications", async () => {
  const result = await withMockFetch(
    { notifications: [makeNotification("n1")], has_more: true },
    () => fetchNotifications({ limit: 20 }),
  );

  expect(result.notifications.map((n) => n.id)).toEqual(["n1"]);
  expect(result.hasMore).toBe(true);
});

test("fetchNotifications defaults hasMore to false when the server omits it", async () => {
  const result = await withMockFetch({ notifications: [] }, () =>
    fetchNotifications({ limit: 20 }),
  );

  expect(result.notifications).toEqual([]);
  expect(result.hasMore).toBe(false);
});
