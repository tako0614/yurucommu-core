import { afterEach, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import {
  actors,
  notificationPushers,
  sessions,
  type Database,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import pusherRoutes from "../../routes/notification-pushers.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import {
  deriveVapidKeyPair,
  parseVapidDerivationSecret,
} from "../../lib/web-push/vapid.ts";
import {
  clearYurucommuApiTransport,
  setYurucommuApiTransport,
} from "../../../../packages/api/src/lib/transport.ts";
import { createBrowserPushConfigResolver } from "../../../../packages/api/src/lib/api/push-config.ts";
import { refreshBrowserNotificationPush } from "../../../../packages/api/src/lib/api/browser-push.ts";
import * as legacy from "../helpers/legacy-browser-push-4.1.15.ts";
import { createTestUserAgent } from "../helpers/web-push-receiver.ts";

// SDK bundles from 4.1.x keep running in open tabs and caches after the
// server moves to 4.2.0. These tests drive the frozen 4.1.15 client against
// the real 4.2 pusher routes and check that it never deletes anything.

const APP_URL = "https://yuru.test";
const ENCRYPTION_KEY = "5e".repeat(32);
const GATEWAY_URL = "https://push.example/_matrix/push/v1/notify";
const RAW_SESSION = "raw-session-alice";
const IDENTITY = {
  product: "yurucommu" as const,
  appId: "jp.takos.yurucommu.web",
  appDisplayName: "Yurucommu",
  serviceWorkerPath: "/notification-push-sw.js",
  serverOrigin: APP_URL,
};
const BINDING_KEY =
  "yurucommu.browser-push.v1.yurucommu.jp.takos.yurucommu.web";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearYurucommuApiTransport();
});

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = OFF");
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

const alice: Actor = {
  ap_id: `${APP_URL}/ap/users/alice`,
  type: "Person",
  preferred_username: "alice",
  name: "alice",
  summary: null,
  icon_url: null,
  header_url: null,
  inbox: `${APP_URL}/ap/users/alice/inbox`,
  outbox: `${APP_URL}/ap/users/alice/outbox`,
  followers_url: `${APP_URL}/ap/users/alice/followers`,
  following_url: `${APP_URL}/ap/users/alice/following`,
  public_key_pem: "public",
  private_key_pem: "private",
  takos_user_id: "takos:alice",
  follower_count: 0,
  following_count: 0,
  post_count: 0,
  is_private: 0,
  role: "owner",
  created_at: "2026-07-01T00:00:00.000Z",
};

async function seed(db: Database): Promise<void> {
  await db.insert(actors).values({
    apId: alice.ap_id,
    type: alice.type,
    preferredUsername: alice.preferred_username,
    name: alice.name,
    inbox: alice.inbox,
    outbox: alice.outbox,
    followersUrl: alice.followers_url,
    followingUrl: alice.following_url,
    publicKeyPem: alice.public_key_pem,
    privateKeyPem: alice.private_key_pem,
    takosUserId: alice.takos_user_id,
    role: alice.role,
    createdAt: alice.created_at,
  });
  const key = await hashSessionIdForEnv({}, RAW_SESSION);
  await db.insert(sessions).values({
    id: key,
    memberId: alice.ap_id,
    accessToken: key,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
}

function p256Key(fill: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(65).fill(fill);
  bytes[0] = 0x04;
  return bytes;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");

/** The gateway's VAPID key that 4.1.x browsers subscribed with. */
const GATEWAY_KEY = p256Key(7);

function serverEnv(): Env {
  return {
    APP_URL,
    ENCRYPTION_KEY,
    YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL: GATEWAY_URL,
    YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS: "push.example",
    // An operator that still has the gateway-era key configured.
    YURUCOMMU_NOTIFICATION_PUSH_WEB_PUSH_PUBLIC_KEY: b64url(GATEWAY_KEY),
  } as unknown as Env;
}

type ServerCall = { method: string; path: string; body: unknown };

/**
 * Route the SDK's requests to the real pusher routes, as alice's browser
 * session. `override` can answer a path instead (a hypothetical server).
 */
function connectSdk(
  db: Database,
  override?: (path: string) => Response | null,
): ServerCall[] {
  const calls: ServerCall[] = [];
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", alice);
    await next();
  });
  app.route("/api/notifications/pushers", pusherRoutes);
  setYurucommuApiTransport({
    credentials: "include",
    resolveUrl: (path) => `${APP_URL}${path}`,
    getAuthHeaders: () => ({ Cookie: `session=${RAW_SESSION}` }),
  });
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = request.method === "GET" ? "" : await request.clone().text();
    calls.push({
      method: request.method,
      path,
      body: text ? JSON.parse(text) : null,
    });
    return override?.(path) ?? app.fetch(request, serverEnv());
  }) as typeof fetch;
  return calls;
}

type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  getKey: (name: "p256dh" | "auth") => ArrayBuffer | null;
  toJSON: () => { endpoint: string; keys: Record<string, string> };
  unsubscribe: () => Promise<boolean>;
};

/** One browser: a push manager, a service worker container and storage. */
async function fakeBrowser(applicationServerKey: Uint8Array<ArrayBuffer>) {
  const state = {
    subscription: null as FakeSubscription | null,
    unsubscribed: 0,
    subscribed: 0,
  };
  let serial = 0;
  const make = async (key: BufferSource): Promise<FakeSubscription> => {
    serial += 1;
    const agent = await createTestUserAgent();
    const keyBytes = ArrayBuffer.isView(key)
      ? new Uint8Array(key.buffer, key.byteOffset, key.byteLength).slice()
      : new Uint8Array(key).slice();
    const subscription: FakeSubscription = {
      endpoint: `https://fcm.googleapis.com/fcm/send/device-${serial}`,
      options: { applicationServerKey: keyBytes.buffer },
      getKey: (name) =>
        (name === "p256dh" ? agent.p256dh : agent.auth).slice().buffer,
      toJSON: () => ({
        endpoint: subscription.endpoint,
        keys: { p256dh: agent.p256dhBase64Url, auth: agent.authBase64Url },
      }),
      unsubscribe: async () => {
        state.unsubscribed += 1;
        if (state.subscription === subscription) state.subscription = null;
        return true;
      },
    };
    return subscription;
  };
  state.subscription = await make(applicationServerKey);
  const pushManager = {
    getSubscription: async () => state.subscription,
    subscribe: async (options: { applicationServerKey: BufferSource }) => {
      state.subscribed += 1;
      state.subscription = await make(options.applicationServerKey);
      return state.subscription;
    },
  };
  const registration = { pushManager, active: { state: "activated" } };
  const store = new Map<string, string>();
  const runtime = {
    serviceWorker: {
      register: async () => registration,
      getRegistration: async () => registration,
    },
    notification: {
      permission: "granted" as NotificationPermission,
      requestPermission: async () => "granted" as NotificationPermission,
    },
    storage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  };
  return { state, store, runtime };
}

/** What a 4.1.x enable left behind: an `http` row keyed by the endpoint. */
async function legacyRegistration(
  db: Database,
  browser: Awaited<ReturnType<typeof fakeBrowser>>,
): Promise<void> {
  const endpoint = browser.state.subscription!.endpoint;
  browser.store.set(
    BINDING_KEY,
    JSON.stringify({
      endpoint,
      serverOrigin: APP_URL,
      vapidPublicKey: b64url(GATEWAY_KEY),
    }),
  );
  connectSdk(db);
  await legacy.refreshBrowserNotificationPush(
    {
      ...IDENTITY,
      gatewayUrl: GATEWAY_URL,
      vapidPublicKey: b64url(GATEWAY_KEY),
    },
    browser.runtime as never,
  );
  const rows = await db.select().from(notificationPushers);
  expect(rows.map((row) => [row.kind, row.pushkey])).toEqual([
    ["http", endpoint],
  ]);
}

async function instanceKey(): Promise<string> {
  return (await deriveVapidKeyPair(parseVapidDerivationSecret(ENCRYPTION_KEY)!))
    .publicKeyBase64Url;
}

test("/config keeps the gateway-era field null and serves the instance key under its own name", async () => {
  const db = await freshDb();
  await seed(db);
  const calls = connectSdk(db);
  const response = await fetch(`${APP_URL}/api/notifications/pushers/config`);
  expect(calls).toHaveLength(1);
  expect(await response.json()).toEqual({
    gateway_url: GATEWAY_URL,
    web_push_public_key: null,
    web_push_instance_public_key: await instanceKey(),
  });
});

test("a 4.1.15 tab with a gateway-era subscription stays unconfigured and deletes nothing", async () => {
  const db = await freshDb();
  await seed(db);
  const browser = await fakeBrowser(GATEWAY_KEY);
  await legacyRegistration(db, browser);
  const binding = browser.store.get(BINDING_KEY);

  const calls = connectSdk(db);
  const config = await legacy.legacyResolveConfig(IDENTITY);
  expect(config).toBeNull();
  expect(
    await legacy.getBrowserNotificationPushState(
      config,
      browser.runtime as never,
    ),
  ).toBe("unconfigured");
  expect(
    await legacy.refreshBrowserNotificationPush(
      config,
      browser.runtime as never,
    ),
  ).toBe("unconfigured");

  expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(browser.state.unsubscribed).toBe(0);
  expect(browser.store.get(BINDING_KEY)).toBe(binding);
  // The gateway row keeps working until the new SDK migrates it.
  expect((await db.select().from(notificationPushers)).length).toBe(1);
});

test("a 4.1.15 tab next to a tab that already moved to instance Web Push deletes nothing", async () => {
  const db = await freshDb();
  await seed(db);
  const browser = await fakeBrowser(GATEWAY_KEY);
  await legacyRegistration(db, browser);

  // The new SDK (another tab) migrates the browser to the instance key.
  connectSdk(db);
  const resolver = createBrowserPushConfigResolver({
    identity: IDENTITY,
    resolveServerOrigin: () => APP_URL,
  });
  const current = await resolver.resolveConfig();
  expect(current?.vapidPublicKey).toBe(await instanceKey());
  expect(
    await refreshBrowserNotificationPush(current, browser.runtime as never),
  ).toBe("enabled");
  const migrated = await db.select().from(notificationPushers);
  expect(migrated.map((row) => row.kind)).toEqual(["webpush"]);
  const subscription = browser.state.subscription;
  const binding = browser.store.get(BINDING_KEY);

  // The old tab then refreshes against the same server.
  const calls = connectSdk(db);
  const config = await legacy.legacyResolveConfig(IDENTITY);
  expect(config).toBeNull();
  expect(
    await legacy.refreshBrowserNotificationPush(
      config,
      browser.runtime as never,
    ),
  ).toBe("unconfigured");
  expect(calls.filter((call) => call.method !== "GET")).toEqual([]);
  expect(browser.state.subscription).toBe(subscription);
  expect(browser.store.get(BINDING_KEY)).toBe(binding);
  expect(await db.select().from(notificationPushers)).toEqual(migrated);

  // And the new tab keeps the subscription it registered.
  connectSdk(db);
  expect(
    await refreshBrowserNotificationPush(
      await resolver.resolveConfig(),
      browser.runtime as never,
    ),
  ).toBe("enabled");
  expect(browser.state.subscription).toBe(subscription);
});

test("control: serving the instance key under the old field name would make a 4.1.15 tab delete the subscription", async () => {
  // This is the shape the field had before the fix. The frozen client is the
  // real 4.1.15 code, so it shows the hazard the separate field avoids.
  const db = await freshDb();
  await seed(db);
  const browser = await fakeBrowser(GATEWAY_KEY);
  await legacyRegistration(db, browser);
  const key = await instanceKey();
  const calls = connectSdk(db, (path) =>
    path === "/api/notifications/pushers/config"
      ? Response.json({ gateway_url: GATEWAY_URL, web_push_public_key: key })
      : null,
  );
  const config = await legacy.legacyResolveConfig(IDENTITY);
  expect(config?.vapidPublicKey).toBe(key);
  expect(
    await legacy.refreshBrowserNotificationPush(
      config,
      browser.runtime as never,
    ),
  ).toBe("disabled");
  expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  expect(browser.state.unsubscribed).toBe(1);
  expect(browser.store.get(BINDING_KEY)).toBeUndefined();
});
