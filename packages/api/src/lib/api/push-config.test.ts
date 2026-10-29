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

test("resolveConfig builds from the instance's VAPID key, with or without a gateway", async () => {
  mockConfig({
    gateway_url: null,
    web_push_public_key: null,
    web_push_instance_public_key: "vapid-key",
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
    vapidPublicKey: "vapid-key",
    serviceWorkerPath: "/notification-push-sw.js",
  });
});

test("resolveConfig returns null when the server has no VAPID key", async () => {
  mockConfig({
    gateway_url: "https://push.example/notify",
    web_push_public_key: null,
    web_push_instance_public_key: null,
  });
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => "https://yurucommu.example",
  });
  expect(await resolver.resolveConfig()).toBeNull();
});

test("resolveConfig ignores a pre-4.2 server's gateway-era key", async () => {
  mockConfig({
    gateway_url: "https://push.example/notify",
    web_push_public_key: "gateway-vapid-key",
  });
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => "https://yurucommu.example",
  });
  expect(await resolver.resolveConfig()).toBeNull();
});

test("resolveConfig never falls back to a build-time key when the server errors", async () => {
  // A build-time key is the gateway-era key; refreshing with it would retire
  // the browser's working instance subscription. Unconfigured touches nothing.
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
  expect(await resolver.resolveConfig()).toBeNull();
  expect(resolver.buildTimeConfig()).toBeNull();
});

test("config resolution yields null without a server origin", async () => {
  mockConfig({
    gateway_url: "https://push.example/notify",
    web_push_public_key: null,
    web_push_instance_public_key: "vapid-key",
  });
  const resolver = createBrowserPushConfigResolver({
    identity,
    resolveServerOrigin: () => null,
  });
  expect(await resolver.resolveConfig()).toBeNull();
  expect(resolver.buildTimeConfig()).toBeNull();
});
