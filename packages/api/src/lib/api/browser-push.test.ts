import { afterEach, expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import {
  clearBrowserNotificationPush,
  disableBrowserNotificationPush,
  enableBrowserNotificationPush,
  getBrowserNotificationPushState,
  refreshBrowserNotificationPush,
  type BrowserNotificationPushConfig,
  type BrowserNotificationPushRuntime,
} from "./browser-push.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});

test("browser push opt-in registers event-id-only Web Push and refreshes the current actor binding", async () => {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ method: init?.method ?? "GET", body });
    return Response.json({
      pusher: {
        id: "push-1",
        kind: "http",
        app_id: "jp.takos.yurucommu.web",
        data: { format: "event_id_only", provider: "webpush" },
        gateway_url: "https://push.example/_matrix/push/v1/notify",
        product: "yurucommu",
        scope: null,
        registered_at: "2026-07-14T00:00:00.000Z",
        last_seen_at: "2026-07-14T00:00:00.000Z",
      },
    });
  }) as typeof fetch;

  let permission: NotificationPermission = "default";
  let subscription: {
    endpoint: string;
    options: { applicationServerKey: ArrayBuffer };
    unsubscribe: () => Promise<boolean>;
  } | null = null;
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async (options: {
        userVisibleOnly: true;
        applicationServerKey: BufferSource;
      }) => {
        subscribeCalls += 1;
        expect(options.userVisibleOnly).toBe(true);
        expect(
          new Uint8Array(options.applicationServerKey as ArrayBufferLike)
            .byteLength,
        ).toBe(65);
        subscription = {
          endpoint: "https://updates.push.example/subscription-1",
          options: {
            applicationServerKey: copyBuffer(options.applicationServerKey),
          },
          unsubscribe: async () => {
            unsubscribeCalls += 1;
            subscription = null;
            return true;
          },
        };
        return subscription;
      },
    },
  };
  const runtime: BrowserNotificationPushRuntime = {
    storage: memoryStorage(),
    serviceWorker: {
      register: async (path, options) => {
        expect(path).toBe("/notification-push-sw.js");
        expect(options?.scope).toBe("/");
        return registration;
      },
      getRegistration: async () => registration,
    },
    notification: {
      get permission() {
        return permission;
      },
      requestPermission: async () => {
        permission = "granted";
        return permission;
      },
    },
  };

  expect(await getBrowserNotificationPushState(config(), runtime)).toBe(
    "disabled",
  );
  expect((await enableBrowserNotificationPush(config(), runtime)).state).toBe(
    "enabled",
  );
  expect(await refreshBrowserNotificationPush(config(), runtime)).toBe(
    "enabled",
  );
  expect(await disableBrowserNotificationPush(config(), runtime)).toBe(
    "disabled",
  );

  expect(subscribeCalls).toBe(1);
  expect(unsubscribeCalls).toBe(1);
  expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "DELETE"]);
  expect(calls[0]?.body).toMatchObject({
    product: "yurucommu",
    pusher: {
      kind: "http",
      app_id: "jp.takos.yurucommu.web",
      pushkey: "https://updates.push.example/subscription-1",
      data: {
        url: "https://push.example/_matrix/push/v1/notify",
        format: "event_id_only",
        provider: "webpush",
        ttl: 60,
        urgency: "normal",
      },
    },
  });
});

test("browser push retires a subscription after VAPID rotation without auto-resubscribing", async () => {
  const first = config();
  const rotatedKey = new Uint8Array(65).fill(2);
  rotatedKey[0] = 0x04;
  const rotated = {
    ...first,
    vapidPublicKey: Buffer.from(rotatedKey).toString("base64url"),
  };
  let unsubscribed = 0;
  let registered = 0;
  const subscription = {
    endpoint: "https://updates.push.example/old-subscription",
    options: {
      applicationServerKey: copyBuffer(
        Buffer.from(first.vapidPublicKey, "base64url"),
      ),
    },
    unsubscribe: async () => {
      unsubscribed += 1;
      return true;
    },
  };
  const runtime: BrowserNotificationPushRuntime = {
    storage: memoryStorage(),
    serviceWorker: {
      register: async () => {
        registered += 1;
        return {
          pushManager: {
            getSubscription: async () => subscription,
            subscribe: async () => subscription,
          },
        };
      },
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => subscription,
          subscribe: async () => subscription,
        },
      }),
    },
    notification: {
      permission: "granted",
      requestPermission: async () => "granted",
    },
  };

  expect(await refreshBrowserNotificationPush(rotated, runtime)).toBe(
    "disabled",
  );
  expect(unsubscribed).toBe(1);
  expect(registered).toBe(1);
});

test("browser push drops an old server binding and logout cleanup needs no runtime config", async () => {
  const storage = memoryStorage();
  const current = config();
  const subscription = {
    endpoint: "https://updates.push.example/subscription-1",
    options: {
      applicationServerKey: copyBuffer(
        Buffer.from(current.vapidPublicKey, "base64url"),
      ),
    },
    unsubscribeCalls: 0,
    async unsubscribe() {
      this.unsubscribeCalls += 1;
      return true;
    },
  };
  storage.setItem(
    "yurucommu.browser-push.v1.yurucommu.jp.takos.yurucommu.web",
    JSON.stringify({
      endpoint: subscription.endpoint,
      serverOrigin: "https://old-social.example",
      vapidPublicKey: current.vapidPublicKey,
    }),
  );
  const registration = {
    pushManager: {
      getSubscription: async () => subscription,
      subscribe: async () => subscription,
    },
  };
  const runtime: BrowserNotificationPushRuntime = {
    storage,
    serviceWorker: {
      register: async () => registration,
      getRegistration: async () => registration,
    },
    notification: {
      permission: "granted",
      requestPermission: async () => "granted",
    },
  };

  expect(await refreshBrowserNotificationPush(current, runtime)).toBe(
    "disabled",
  );
  expect(subscription.unsubscribeCalls).toBe(1);

  storage.setItem("unrelated", "keep");
  expect(
    await clearBrowserNotificationPush(
      {
        product: current.product,
        appId: current.appId,
        serviceWorkerPath: current.serviceWorkerPath,
      },
      runtime,
    ),
  ).toBe("disabled");
  expect(subscription.unsubscribeCalls).toBe(2);
  expect(storage.getItem("unrelated")).toBe("keep");
});

test("browser push remains fail-closed when permission is denied or config is absent", async () => {
  let registered = false;
  const runtime: BrowserNotificationPushRuntime = {
    serviceWorker: {
      register: async () => {
        registered = true;
        throw new Error("must not register");
      },
      getRegistration: async () => undefined,
    },
    notification: {
      permission: "denied",
      requestPermission: async () => "denied",
    },
  };

  expect(await getBrowserNotificationPushState(null, runtime)).toBe(
    "unconfigured",
  );
  expect((await enableBrowserNotificationPush(config(), runtime)).state).toBe(
    "denied",
  );
  expect(registered).toBe(false);
});

function config(): BrowserNotificationPushConfig {
  const publicKey = new Uint8Array(65).fill(1);
  publicKey[0] = 0x04;
  return {
    product: "yurucommu",
    appId: "jp.takos.yurucommu.web",
    appDisplayName: "Yurucommu",
    serverOrigin: "https://social.example",
    gatewayUrl: "https://push.example/_matrix/push/v1/notify",
    vapidPublicKey: Buffer.from(publicKey).toString("base64url"),
    serviceWorkerPath: "/notification-push-sw.js",
  };
}

function copyBuffer(value: BufferSource): ArrayBuffer {
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
  return Uint8Array.from(bytes).buffer;
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}
