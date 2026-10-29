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
const BINDING_KEY =
  "yurucommu.browser-push.v1.yurucommu.jp.takos.yurucommu.web";

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});

type Call = { method: string; body: Record<string, unknown> };

function recordServer(): Call[] {
  const calls: Call[] = [];
  clearYurucommuApiTransport();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ method: init?.method ?? "GET", body });
    if (init?.method === "DELETE") return Response.json({ deleted: true });
    return Response.json({
      pusher: {
        id: "push-1",
        kind: "webpush",
        app_id: "jp.takos.yurucommu.web",
        data: { url: (body.pusher as { data: { url: string } }).data.url },
        product: "yurucommu",
        scope: null,
        registered_at: "2026-10-29T00:00:00.000Z",
        last_seen_at: "2026-10-29T00:00:00.000Z",
      },
    });
  }) as typeof fetch;
  return calls;
}

type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  getKey?: (name: "p256dh" | "auth") => ArrayBuffer | null;
  toJSON?: () => { endpoint: string; keys: Record<string, string> };
  unsubscribe: () => Promise<boolean>;
};

function keyBytes(
  fill: number,
  length: number,
  prefix?: number,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length).fill(fill);
  if (prefix !== undefined) bytes[0] = prefix;
  return bytes;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** A push manager whose subscriptions carry fresh p256dh/auth per subscribe. */
function fakePushManager(options: { toJSON?: boolean; getKey?: boolean } = {}) {
  const state = {
    subscription: null as FakeSubscription | null,
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    keys: [] as Array<{ p256dh: string; auth: string }>,
  };
  const make = (
    endpoint: string,
    applicationServerKey: BufferSource,
    serial: number,
  ): FakeSubscription => {
    const p256dh = keyBytes(serial + 10, 65, 0x04);
    const auth = keyBytes(serial + 20, 16);
    state.keys.push({ p256dh: b64url(p256dh), auth: b64url(auth) });
    const subscription: FakeSubscription = {
      endpoint,
      options: { applicationServerKey: copyBuffer(applicationServerKey) },
      unsubscribe: async () => {
        state.unsubscribeCalls += 1;
        if (state.subscription === subscription) state.subscription = null;
        return true;
      },
    };
    if (options.toJSON !== false) {
      subscription.toJSON = () => ({
        endpoint,
        // Browsers may pad; the SDK must send canonical unpadded base64url.
        keys: {
          p256dh: Buffer.from(p256dh).toString("base64"),
          auth: b64url(auth),
        },
      });
    }
    if (options.getKey) {
      subscription.getKey = (name) =>
        copyBuffer(name === "p256dh" ? p256dh : auth);
    }
    return subscription;
  };
  const registration = {
    pushManager: {
      getSubscription: async () => state.subscription,
      subscribe: async (input: {
        userVisibleOnly: true;
        applicationServerKey: BufferSource;
      }) => {
        expect(input.userVisibleOnly).toBe(true);
        state.subscribeCalls += 1;
        state.subscription = make(
          `https://fcm.googleapis.com/fcm/send/sub-${state.subscribeCalls}`,
          input.applicationServerKey,
          state.subscribeCalls,
        );
        return state.subscription;
      },
    },
  };
  return { state, registration, make };
}

function runtimeFor(
  registration: { pushManager: unknown },
  storage = memoryStorage(),
  permission: NotificationPermission = "granted",
): BrowserNotificationPushRuntime & {
  storage: ReturnType<typeof memoryStorage>;
} {
  let current = permission;
  return {
    storage,
    serviceWorker: {
      register: async (path, options) => {
        expect(path).toBe("/notification-push-sw.js");
        expect(options?.scope).toBe("/");
        return registration as never;
      },
      getRegistration: async () => registration as never,
    },
    notification: {
      get permission() {
        return current;
      },
      requestPermission: async () => {
        current = "granted";
        return current;
      },
    },
  };
}

test("opt-in subscribes with the instance key and registers webpush in MSC4174 order; disable deletes by p256dh", async () => {
  const calls = recordServer();
  const { state, registration } = fakePushManager();
  const runtime = runtimeFor(registration, memoryStorage(), "default");

  expect(await getBrowserNotificationPushState(config(), runtime)).toBe(
    "disabled",
  );
  const enabled = await enableBrowserNotificationPush(config(), runtime);
  expect(enabled.state).toBe("enabled");
  expect(enabled.registration?.kind).toBe("webpush");
  expect(await refreshBrowserNotificationPush(config(), runtime)).toBe(
    "enabled",
  );
  expect(await getBrowserNotificationPushState(config(), runtime)).toBe(
    "enabled",
  );
  expect(await disableBrowserNotificationPush(config(), runtime)).toBe(
    "disabled",
  );

  expect(state.subscribeCalls).toBe(1);
  expect(state.unsubscribeCalls).toBe(1);
  expect(calls.map((call) => call.method)).toEqual(["POST", "POST", "DELETE"]);
  expect(calls[0]?.body).toEqual({
    product: "yurucommu",
    pusher: {
      kind: "webpush",
      app_id: "jp.takos.yurucommu.web",
      app_display_name: "Yurucommu",
      pushkey: state.keys[0]!.p256dh,
      lang: "ja-JP",
      data: {
        url: "https://fcm.googleapis.com/fcm/send/sub-1",
        auth: state.keys[0]!.auth,
      },
    },
  });
  expect(state.keys[0]!.p256dh).not.toContain("=");
  expect(calls[2]?.body).toEqual({
    product: "yurucommu",
    app_id: "jp.takos.yurucommu.web",
    pushkey: state.keys[0]!.p256dh,
  });
  expect(runtime.storage.getItem(BINDING_KEY)).toBeNull();
});

test("a subscription that exposes only getKey() registers too", async () => {
  const calls = recordServer();
  const { state, registration } = fakePushManager({
    toJSON: false,
    getKey: true,
  });
  const runtime = runtimeFor(registration);
  expect((await enableBrowserNotificationPush(config(), runtime)).state).toBe(
    "enabled",
  );
  expect(calls[0]?.body).toMatchObject({
    pusher: {
      pushkey: state.keys[0]!.p256dh,
      data: { auth: state.keys[0]!.auth },
    },
  });
});

test("a key rotation on the same server resubscribes with the new key without asking again", async () => {
  const calls = recordServer();
  const { state, registration } = fakePushManager();
  const storage = memoryStorage();
  const runtime = runtimeFor(registration, storage);
  await enableBrowserNotificationPush(config(), runtime);
  calls.length = 0;

  const rotated = { ...config(), vapidPublicKey: b64url(keyBytes(2, 65, 4)) };
  expect(await refreshBrowserNotificationPush(rotated, runtime)).toBe(
    "enabled",
  );
  expect(state.subscribeCalls).toBe(2);
  expect(state.unsubscribeCalls).toBe(1);
  expect(calls.map((call) => call.method)).toEqual(["DELETE", "POST"]);
  expect(calls[0]?.body).toMatchObject({ pushkey: state.keys[0]!.p256dh });
  expect(calls[1]?.body).toMatchObject({
    pusher: { kind: "webpush", pushkey: state.keys[1]!.p256dh },
  });
  expect(
    new Uint8Array(state.subscription!.options.applicationServerKey),
  ).toEqual(keyBytes(2, 65, 4));
  expect(JSON.parse(storage.getItem(BINDING_KEY)!)).toMatchObject({
    vapidPublicKey: rotated.vapidPublicKey,
    kind: "webpush",
    pushkey: state.keys[1]!.p256dh,
  });
});

test("a gateway-era subscription on the same server moves to webpush and its old http row is removed", async () => {
  const calls = recordServer();
  const { state, registration, make } = fakePushManager();
  const storage = memoryStorage();
  const gatewayKey = b64url(keyBytes(9, 65, 4));
  state.subscription = make(
    "https://fcm.googleapis.com/fcm/send/gateway-era",
    new Uint8Array(Buffer.from(gatewayKey, "base64url")),
    0,
  );
  storage.setItem(
    BINDING_KEY,
    JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/gateway-era",
      serverOrigin: "https://social.example",
      vapidPublicKey: gatewayKey,
    }),
  );
  const runtime = runtimeFor(registration, storage);

  expect(await refreshBrowserNotificationPush(config(), runtime)).toBe(
    "enabled",
  );
  const deletes = calls.filter((call) => call.method === "DELETE");
  expect(deletes.map((call) => call.body.pushkey)).toContain(
    "https://fcm.googleapis.com/fcm/send/gateway-era",
  );
  const posts = calls.filter((call) => call.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0]?.body).toMatchObject({
    pusher: {
      kind: "webpush",
      data: { url: "https://fcm.googleapis.com/fcm/send/sub-1" },
    },
  });
});

test("without a binding a mismatched subscription is retired and not replaced", async () => {
  const calls = recordServer();
  const { state, registration, make } = fakePushManager();
  state.subscription = make(
    "https://fcm.googleapis.com/fcm/send/unknown",
    keyBytes(3, 65, 4),
    0,
  );
  const runtime = runtimeFor(registration);
  expect(await refreshBrowserNotificationPush(config(), runtime)).toBe(
    "disabled",
  );
  expect(state.unsubscribeCalls).toBe(1);
  expect(state.subscribeCalls).toBe(0);
  expect(calls.every((call) => call.method === "DELETE")).toBe(true);
});

test("a subscription the browser dropped is recreated for the server that enabled it", async () => {
  recordServer();
  const { state, registration } = fakePushManager();
  const runtime = runtimeFor(registration);
  await enableBrowserNotificationPush(config(), runtime);
  state.subscription = null;
  expect(await refreshBrowserNotificationPush(config(), runtime)).toBe(
    "enabled",
  );
  expect(state.subscribeCalls).toBe(2);
});

test("an old server binding is dropped and logout cleanup needs no runtime config", async () => {
  const calls = recordServer();
  const { state, registration, make } = fakePushManager();
  const storage = memoryStorage();
  const current = config();
  state.subscription = make(
    "https://fcm.googleapis.com/fcm/send/old",
    new Uint8Array(Buffer.from(current.vapidPublicKey, "base64url")),
    0,
  );
  storage.setItem(
    BINDING_KEY,
    JSON.stringify({
      endpoint: "https://fcm.googleapis.com/fcm/send/old",
      serverOrigin: "https://old-social.example",
      vapidPublicKey: current.vapidPublicKey,
      kind: "webpush",
      pushkey: state.keys[0]!.p256dh,
    }),
  );
  const runtime = runtimeFor(registration, storage);

  expect(await refreshBrowserNotificationPush(current, runtime)).toBe(
    "disabled",
  );
  expect(state.unsubscribeCalls).toBe(1);
  expect(state.subscribeCalls).toBe(0);
  // The old server's row is not touched through the new server.
  expect(calls).toHaveLength(0);

  storage.setItem("unrelated", "keep");
  state.subscription = make(
    "https://fcm.googleapis.com/fcm/send/again",
    new Uint8Array(Buffer.from(current.vapidPublicKey, "base64url")),
    1,
  );
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
  expect(state.unsubscribeCalls).toBe(2);
  expect(storage.getItem("unrelated")).toBe("keep");
});

test("disable through a wrapper that hides the subscription keys still deletes by the stored p256dh", async () => {
  const calls = recordServer();
  const { state, registration } = fakePushManager();
  const storage = memoryStorage();
  await enableBrowserNotificationPush(
    config(),
    runtimeFor(registration, storage),
  );
  calls.length = 0;
  // Like a consumer's guarded runtime: only endpoint/options/unsubscribe.
  const hidden = {
    pushManager: {
      getSubscription: async () => {
        const subscription = state.subscription;
        return subscription
          ? {
              endpoint: subscription.endpoint,
              options: subscription.options,
              unsubscribe: () => subscription.unsubscribe(),
            }
          : null;
      },
      subscribe: registration.pushManager.subscribe,
    },
  };
  expect(
    await disableBrowserNotificationPush(config(), runtimeFor(hidden, storage)),
  ).toBe("disabled");
  expect(calls).toEqual([
    {
      method: "DELETE",
      body: {
        product: "yurucommu",
        app_id: "jp.takos.yurucommu.web",
        pushkey: state.keys[0]!.p256dh,
      },
    },
  ]);
});

test("first opt-in waits for the freshly registered worker to activate before subscribing", async () => {
  recordServer();
  const { state, registration } = fakePushManager();
  const listeners = new Set<() => void>();
  const worker = {
    state: "installing",
    addEventListener: (_type: "statechange", listener: () => void) =>
      void listeners.add(listener),
    removeEventListener: (_type: "statechange", listener: () => void) =>
      void listeners.delete(listener),
  };
  const installing = {
    get active() {
      return worker.state === "activated" ? worker : null;
    },
    get installing() {
      return worker.state === "activated" ? null : worker;
    },
    waiting: null,
    pushManager: {
      getSubscription: registration.pushManager.getSubscription,
      subscribe: async (input: {
        userVisibleOnly: true;
        applicationServerKey: BufferSource;
      }) => {
        if (worker.state !== "activated") {
          throw new DOMException(
            "Subscription failed - no active Service Worker",
            "AbortError",
          );
        }
        return registration.pushManager.subscribe(input);
      },
    },
  };
  setTimeout(() => {
    worker.state = "activated";
    for (const listener of listeners) listener();
  }, 20);
  const result = await enableBrowserNotificationPush(
    config(),
    runtimeFor(installing),
  );
  expect(result.state).toBe("enabled");
  expect(state.subscribeCalls).toBe(1);
  expect(listeners.size).toBe(0);
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
  expect(
    await getBrowserNotificationPushState(
      { ...config(), vapidPublicKey: "not-a-key" },
      runtime,
    ),
  ).toBe("unconfigured");
  expect((await enableBrowserNotificationPush(config(), runtime)).state).toBe(
    "denied",
  );
  expect(await refreshBrowserNotificationPush(config(), runtime)).toBe(
    "denied",
  );
  expect(registered).toBe(false);
});

function config(): BrowserNotificationPushConfig {
  return {
    product: "yurucommu",
    appId: "jp.takos.yurucommu.web",
    appDisplayName: "Yurucommu",
    serverOrigin: "https://social.example",
    vapidPublicKey: b64url(keyBytes(1, 65, 4)),
    serviceWorkerPath: "/notification-push-sw.js",
    lang: "ja-JP",
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
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}
