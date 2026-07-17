import { expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import type { Notification } from "../../types/index.ts";
import {
  fetchNotificationPusherPublicConfig,
  fetchNotifications,
  registerNotificationPusher,
  unregisterNotificationPusher,
} from "./notifications.ts";

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

test("notification pusher public config derives enabled only from both public values", async () => {
  const configured = await withMockFetch(
    {
      gateway_url: "https://push.example/_matrix/push/v1/notify",
      web_push_public_key: "public-vapid-key",
    },
    fetchNotificationPusherPublicConfig,
  );
  expect(configured).toEqual({
    enabled: true,
    gateway_url: "https://push.example/_matrix/push/v1/notify",
    web_push_public_key: "public-vapid-key",
  });

  const disabled = await withMockFetch(
    { gateway_url: null, web_push_public_key: "public-vapid-key" },
    fetchNotificationPusherPublicConfig,
  );
  expect(disabled.enabled).toBe(false);
});

test("notification pusher helpers use the shared POST/DELETE wire shape", async () => {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return Response.json(
      init?.method === "DELETE"
        ? { deleted: true }
        : {
            pusher: {
              id: "p1",
              kind: "http",
              app_id: "jp.takos.yurucommu",
              data: { format: "event_id_only" },
              gateway_url: "https://push.example/_matrix/push/v1/notify",
              product: "yurucommu",
              scope: null,
              registered_at: "2026-07-01T00:00:00.000Z",
              last_seen_at: "2026-07-01T00:00:00.000Z",
            },
          },
    );
  }) as unknown as typeof fetch;
  try {
    await registerNotificationPusher({
      product: "yurucommu",
      pusher: {
        kind: "http",
        app_id: "jp.takos.yurucommu",
        pushkey: "fid",
        data: {
          url: "https://push.example/_matrix/push/v1/notify",
          format: "event_id_only",
        },
      },
    });
    await unregisterNotificationPusher({
      product: "yurucommu",
      app_id: "jp.takos.yurucommu",
      pushkey: "fid",
    });
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
  expect(calls.map(({ url, method }) => ({ url, method }))).toEqual([
    { url: "/api/notifications/pushers", method: "POST" },
    { url: "/api/notifications/pushers", method: "DELETE" },
  ]);
  expect(calls[0]?.body).toMatchObject({
    product: "yurucommu",
    pusher: { app_id: "jp.takos.yurucommu", pushkey: "fid" },
  });
});
