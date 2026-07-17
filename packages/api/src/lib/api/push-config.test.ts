import { afterEach, expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import { createBrowserPushConfigResolver } from "./push-config.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});

const identity = {
  product: "yurucommu" as const,
  appId: "jp.takos.yurucommu.web",
  appDisplayName: "Yurucommu",
  serviceWorkerPath: "/notification-push-sw.js",
};

function mockConfig(body: unknown): void {
  clearYurucommuApiTransport();
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

test("resolveConfig builds from the server's runtime pusher config", async () => {
  mockConfig({
    gateway_url: "https://push.example/notify",
    web_push_public_key: "vapid-key",
  });
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => "https://yurucommu.example",
  });
  const config = await resolver.resolveConfig();
  expect(config).toEqual({
    product: "yurucommu",
    appId: "jp.takos.yurucommu.web",
    appDisplayName: "Yurucommu",
    serverOrigin: "https://yurucommu.example",
    gatewayUrl: "https://push.example/notify",
    vapidPublicKey: "vapid-key",
    serviceWorkerPath: "/notification-push-sw.js",
  });
});

test("resolveConfig returns null when push is disabled server-side", async () => {
  mockConfig({ gateway_url: null, web_push_public_key: null });
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => "https://yurucommu.example",
  });
  expect(await resolver.resolveConfig()).toBeNull();
});

test("resolveConfig falls back to build-time values when the server errors", async () => {
  clearYurucommuApiTransport();
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => "https://yurucommu.example",
    buildTimeValues: () => ({
      gatewayUrl: "https://fallback.example/notify",
      vapidPublicKey: "fallback-key",
    }),
  });
  const config = await resolver.resolveConfig();
  expect(config?.gatewayUrl).toBe("https://fallback.example/notify");
  expect(config?.vapidPublicKey).toBe("fallback-key");
});

test("config resolution yields null without a server origin", async () => {
  mockConfig({
    gateway_url: "https://push.example/notify",
    web_push_public_key: "vapid-key",
  });
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => null,
  });
  expect(await resolver.resolveConfig()).toBeNull();
  expect(resolver.buildTimeConfig()).toBeNull();
});
