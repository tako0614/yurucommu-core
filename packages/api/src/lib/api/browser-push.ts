import type {
  NotificationPusherProduct,
  NotificationPusherRegistration,
} from "../../types/index.ts";
import {
  registerNotificationPusher,
  unregisterNotificationPusher,
} from "./notifications.ts";

/**
 * Browser / home-screen web app notifications through standard Web Push.
 *
 * The page subscribes with the instance's own VAPID public key (from
 * GET /api/notifications/pushers/config) and registers the subscription with
 * the instance as a `webpush` pusher in MSC4174's layout: pushkey = p256dh,
 * data.url = endpoint, data.auth. The instance encrypts and sends the push
 * itself; no gateway is involved. The same code path works in Safari, Chrome,
 * Firefox and in a browser-like shell that implements the Push API.
 */

export type BrowserNotificationPushState =
  "unsupported" | "unconfigured" | "denied" | "disabled" | "enabled";

export interface BrowserNotificationPushConfig {
  readonly product: NotificationPusherProduct;
  readonly appId: string;
  readonly appDisplayName: string;
  /** Origin of the yurucommu-compatible API that owns this registration. */
  readonly serverOrigin: string;
  /**
   * @deprecated Ignored. Browser push no longer goes through a gateway; the
   * instance sends standard Web Push itself. Gateways remain for store native
   * apps that register `http` pushers.
   */
  readonly gatewayUrl?: string | null;
  /** The instance's public uncompressed P-256 VAPID key, base64url encoded. */
  readonly vapidPublicKey: string;
  readonly serviceWorkerPath: string;
  readonly scope?: string;
  readonly lang?: string;
}

interface BrowserPushSubscriptionLike {
  readonly endpoint: string;
  readonly options?: {
    readonly applicationServerKey: ArrayBuffer | null;
  };
  /** Standard PushSubscription accessors; either one is enough to register. */
  getKey?(name: "p256dh" | "auth"): ArrayBuffer | null;
  toJSON?(): {
    readonly endpoint?: string | null;
    readonly keys?: Readonly<Record<string, string>>;
  };
  unsubscribe(): Promise<boolean>;
}

interface BrowserPushManagerLike {
  getSubscription(): Promise<BrowserPushSubscriptionLike | null>;
  subscribe(options: {
    readonly userVisibleOnly: true;
    readonly applicationServerKey: BufferSource;
  }): Promise<BrowserPushSubscriptionLike>;
}

interface BrowserServiceWorkerLike {
  readonly state: string;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

interface BrowserServiceWorkerRegistrationLike {
  readonly pushManager: BrowserPushManagerLike;
  /** Standard registration workers; absent in minimal runtimes and wrappers. */
  readonly active?: BrowserServiceWorkerLike | null;
  readonly installing?: BrowserServiceWorkerLike | null;
  readonly waiting?: BrowserServiceWorkerLike | null;
}

interface BrowserServiceWorkerContainerLike {
  register(
    scriptURL: string,
    options?: RegistrationOptions,
  ): Promise<BrowserServiceWorkerRegistrationLike>;
  getRegistration(
    clientURL?: string,
  ): Promise<BrowserServiceWorkerRegistrationLike | undefined>;
}

interface BrowserNotificationApiLike {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

interface BrowserPushStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserNotificationPushRuntime {
  readonly serviceWorker?: BrowserServiceWorkerContainerLike;
  readonly notification?: BrowserNotificationApiLike;
  readonly storage?: BrowserPushStorageLike;
}

export async function getBrowserNotificationPushState(
  config: BrowserNotificationPushConfig | null | undefined,
  runtime: BrowserNotificationPushRuntime = browserPushRuntime(),
): Promise<BrowserNotificationPushState> {
  if (!runtime.serviceWorker || !runtime.notification) return "unsupported";
  const normalized = normalizeBrowserPushConfig(config);
  if (!normalized) return "unconfigured";
  if (runtime.notification.permission === "denied") return "denied";
  const registration = await runtime.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription &&
    subscriptionMatchesConfig(normalized, subscription, runtime)
    ? "enabled"
    : "disabled";
}

export async function enableBrowserNotificationPush(
  config: BrowserNotificationPushConfig,
  runtime: BrowserNotificationPushRuntime = browserPushRuntime(),
): Promise<{
  readonly state: BrowserNotificationPushState;
  readonly registration?: NotificationPusherRegistration;
}> {
  if (!runtime.serviceWorker || !runtime.notification) {
    return { state: "unsupported" };
  }
  const normalized = requireBrowserPushConfig(config);
  const permission =
    runtime.notification.permission === "default"
      ? await runtime.notification.requestPermission()
      : runtime.notification.permission;
  if (permission !== "granted") {
    return { state: permission === "denied" ? "denied" : "disabled" };
  }

  const serviceWorker = await runtime.serviceWorker.register(
    normalized.serviceWorkerPath,
    { scope: "/" },
  );
  await waitForActiveWorker(serviceWorker);
  let existing = await serviceWorker.pushManager.getSubscription();
  if (existing && !subscriptionMatchesConfig(normalized, existing, runtime)) {
    await retireBrowserSubscription(normalized, existing, runtime);
    existing = null;
  }
  const subscription =
    existing ??
    (await serviceWorker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: normalized.applicationServerKey,
    }));
  const registration = await registerAndBind(normalized, subscription, runtime);
  return { state: "enabled", registration };
}

/**
 * Rebind this browser's subscription to the current signed-in actor and keep
 * it fresh. Never asks for permission. It subscribes again only for a server
 * this browser already enabled (a stored binding for the same server origin):
 * after a VAPID key rotation, or when the browser dropped the subscription.
 */
export async function refreshBrowserNotificationPush(
  config: BrowserNotificationPushConfig | null | undefined,
  runtime: BrowserNotificationPushRuntime = browserPushRuntime(),
): Promise<BrowserNotificationPushState> {
  if (!runtime.serviceWorker || !runtime.notification) return "unsupported";
  const normalized = normalizeBrowserPushConfig(config);
  if (!normalized) return "unconfigured";
  if (runtime.notification.permission !== "granted") {
    return runtime.notification.permission === "denied" ? "denied" : "disabled";
  }
  const serviceWorker = await runtime.serviceWorker.register(
    normalized.serviceWorkerPath,
    { scope: "/" },
  );
  await waitForActiveWorker(serviceWorker);
  const binding = readBrowserPushBinding(normalized, runtime);
  const enabledHere = binding?.serverOrigin === normalized.serverOrigin;
  let subscription = await serviceWorker.pushManager.getSubscription();
  if (
    subscription &&
    !subscriptionMatchesConfig(normalized, subscription, runtime)
  ) {
    await retireBrowserSubscription(normalized, subscription, runtime);
    subscription = null;
  }
  if (!subscription) {
    if (!enabledHere) return "disabled";
    subscription = await serviceWorker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: normalized.applicationServerKey,
    });
  }
  await registerAndBind(normalized, subscription, runtime, binding);
  return "enabled";
}

export async function disableBrowserNotificationPush(
  config: BrowserNotificationPushConfig,
  runtime: BrowserNotificationPushRuntime = browserPushRuntime(),
): Promise<BrowserNotificationPushState> {
  if (!runtime.serviceWorker || !runtime.notification) return "unsupported";
  const normalized = requireBrowserPushConfig(config);
  const serviceWorker = await runtime.serviceWorker.getRegistration();
  const subscription = await serviceWorker?.pushManager.getSubscription();
  if (!subscription) {
    clearBrowserPushBinding(normalized, runtime);
    return "disabled";
  }

  // Explicit disable is privacy-first: always invalidate the local endpoint,
  // even when the host cannot remove its row. The next 404/410 from the push
  // service lets the host clean that stale row.
  await retireBrowserSubscription(normalized, subscription, runtime, true);
  return "disabled";
}

/**
 * Invalidate this product's browser endpoint without requiring runtime push
 * configuration. Use this during logout/account teardown so a removed or
 * temporarily unavailable server cannot keep waking a signed-out device.
 */
export async function clearBrowserNotificationPush(
  identity: Pick<
    BrowserNotificationPushConfig,
    "product" | "appId" | "serviceWorkerPath"
  >,
  runtime: BrowserNotificationPushRuntime = browserPushRuntime(),
): Promise<BrowserNotificationPushState> {
  if (!runtime.serviceWorker) return "unsupported";
  const registration = await runtime.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
  clearBrowserPushBindingForIdentity(identity, runtime);
  return "disabled";
}

const SERVICE_WORKER_ACTIVATION_TIMEOUT_MS = 10_000;

/**
 * `pushManager.subscribe()` needs an active worker; right after the first
 * `register()` the worker is still installing and browsers reject with
 * "no active Service Worker". Wait (bounded) until it activates.
 */
async function waitForActiveWorker(
  registration: BrowserServiceWorkerRegistrationLike,
): Promise<void> {
  if (registration.active) return;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) return;
  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (timer !== undefined) clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      resolve();
    };
    const check = () => {
      if (worker.state === "activated" || worker.state === "redundant") {
        finish();
      }
    };
    timer = setTimeout(finish, SERVICE_WORKER_ACTIVATION_TIMEOUT_MS);
    worker.addEventListener("statechange", check);
    check();
  });
}

function browserPushRuntime(): BrowserNotificationPushRuntime {
  const navigatorValue = globalThis.navigator as Navigator | undefined;
  const notificationValue = globalThis.Notification;
  let storage: BrowserPushStorageLike | undefined;
  try {
    storage = globalThis.localStorage;
  } catch {
    storage = undefined;
  }
  return {
    ...(navigatorValue?.serviceWorker
      ? {
          serviceWorker:
            navigatorValue.serviceWorker as unknown as BrowserServiceWorkerContainerLike,
        }
      : {}),
    ...(notificationValue
      ? {
          notification:
            notificationValue as unknown as BrowserNotificationApiLike,
        }
      : {}),
    ...(storage ? { storage } : {}),
  };
}

type NormalizedBrowserPushConfig = BrowserNotificationPushConfig & {
  readonly applicationServerKey: BufferSource;
};

function requireBrowserPushConfig(
  config: BrowserNotificationPushConfig,
): NormalizedBrowserPushConfig {
  const normalized = normalizeBrowserPushConfig(config);
  if (!normalized) {
    throw new Error(
      "Browser notification push requires a VAPID public key, a server origin, an app id, and a root-relative service worker path.",
    );
  }
  return normalized;
}

function normalizeBrowserPushConfig(
  config: BrowserNotificationPushConfig | null | undefined,
): NormalizedBrowserPushConfig | null {
  if (!config) return null;
  const appId = config.appId.trim();
  const appDisplayName = config.appDisplayName.trim();
  const serverOrigin = normalizeServerOrigin(config.serverOrigin);
  const vapidPublicKey = config.vapidPublicKey.trim();
  const applicationServerKey = decodeVapidPublicKey(vapidPublicKey);
  const serviceWorkerPath = config.serviceWorkerPath.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(appId) ||
    !appDisplayName ||
    appDisplayName.length > 255 ||
    !serverOrigin ||
    !applicationServerKey ||
    !serviceWorkerPath.startsWith("/") ||
    serviceWorkerPath.startsWith("//") ||
    serviceWorkerPath.length > 512
  ) {
    return null;
  }
  return {
    ...config,
    appId,
    appDisplayName,
    serverOrigin,
    vapidPublicKey,
    serviceWorkerPath,
    applicationServerKey,
  };
}

function normalizeServerOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.hash) return null;
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Client-side push URL policy (gateway URLs for native `http` pushers and
 * Web Push endpoints alike). MUST stay behaviorally equivalent to the
 * server's `normalizeGatewayUrl` in the notification pusher contract — a
 * client-accepted / server-rejected URL yields a confusing "registers but
 * 400s" failure. The equivalence is pinned by a shared-fixture drift test.
 */
export function normalizeBrowserPushGatewayUrl(value: string): string | null {
  return normalizeGatewayUrl(value);
}

function normalizeGatewayUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:") {
      if (url.port && url.port !== "443") return null;
      if (!isPublicHttpsHostname(url.hostname)) return null;
      return url.toString();
    }
    if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1"
  ) {
    return true;
  }
  const octets = normalized.split(".").map(Number);
  return (
    octets.length === 4 &&
    octets.every(
      (part) => Number.isInteger(part) && part >= 0 && part <= 255,
    ) &&
    octets[0] === 127
  );
}

function isPublicHttpsHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !normalized.includes(".") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".lan")
  ) {
    return false;
  }
  const ipv4 = normalized.split(".").map(Number);
  if (
    ipv4.length === 4 &&
    ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    return false;
  }
  return !normalized.includes(":");
}

function decodeBase64Url(
  value: string,
  maxLength = 256,
): Uint8Array<ArrayBuffer> | null {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || normalized.length > maxLength) return null;
  const unpadded = normalized.replace(/=+$/, "");
  const padded = unpadded.padEnd(Math.ceil(unpadded.length / 4) * 4, "=");
  try {
    const binary = globalThis.atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeVapidPublicKey(value: string): BufferSource | null {
  const bytes = decodeBase64Url(value);
  // Web Push uses an uncompressed P-256 public key.
  return bytes && bytes.byteLength === 65 && bytes[0] === 0x04 ? bytes : null;
}

type SubscriptionKeys = { readonly p256dh: string; readonly auth: string };

/**
 * The subscription's p256dh and auth in canonical unpadded base64url, from
 * `toJSON()` or `getKey()`. Null when the runtime exposes neither.
 */
function readSubscriptionKeys(
  subscription: BrowserPushSubscriptionLike,
): SubscriptionKeys | null {
  let p256dh: Uint8Array | null = null;
  let auth: Uint8Array | null = null;
  try {
    const keys = subscription.toJSON?.()?.keys;
    if (typeof keys?.p256dh === "string") p256dh = decodeBase64Url(keys.p256dh);
    if (typeof keys?.auth === "string") auth = decodeBase64Url(keys.auth);
  } catch {
    // fall back to getKey
  }
  try {
    if (!p256dh) {
      const raw = subscription.getKey?.("p256dh");
      if (raw) p256dh = new Uint8Array(raw);
    }
    if (!auth) {
      const raw = subscription.getKey?.("auth");
      if (raw) auth = new Uint8Array(raw);
    }
  } catch {
    // treated as missing below
  }
  if (
    !p256dh ||
    p256dh.byteLength !== 65 ||
    p256dh[0] !== 0x04 ||
    !auth ||
    auth.byteLength !== 16
  ) {
    return null;
  }
  return { p256dh: encodeBase64Url(p256dh), auth: encodeBase64Url(auth) };
}

async function registerAndBind(
  config: NormalizedBrowserPushConfig,
  subscription: BrowserPushSubscriptionLike,
  runtime: BrowserNotificationPushRuntime,
  previous: StoredBrowserPushBinding | null = readBrowserPushBinding(
    config,
    runtime,
  ),
): Promise<NotificationPusherRegistration> {
  const keys = readSubscriptionKeys(subscription);
  if (!keys) {
    throw new Error(
      "This browser's push subscription does not expose its p256dh/auth keys.",
    );
  }
  const registration = await registerNotificationPusher({
    product: config.product,
    ...(config.scope ? { scope: config.scope } : {}),
    pusher: {
      kind: "webpush",
      app_id: config.appId,
      app_display_name: config.appDisplayName,
      pushkey: keys.p256dh,
      ...(config.lang ? { lang: config.lang } : {}),
      data: { url: subscription.endpoint, auth: keys.auth },
    },
  });
  storeBrowserPushBinding(config, subscription, keys.p256dh, runtime);
  // A subscription registered before Web Push moved into the instance is an
  // `http` pusher keyed by its endpoint. Remove that row so the same browser
  // is not notified twice once a gateway is configured again.
  if (
    previous &&
    previous.kind !== "webpush" &&
    previous.serverOrigin === config.serverOrigin
  ) {
    await unregisterQuietly(config, previous.endpoint);
  }
  return registration;
}

type StoredBrowserPushBinding = {
  readonly endpoint: string;
  readonly serverOrigin: string;
  readonly vapidPublicKey: string;
  /** Absent on bindings written before Web Push moved into the instance. */
  readonly kind?: "webpush";
  /** p256dh: the server-side pushkey of a `webpush` registration. */
  readonly pushkey?: string;
};

function browserPushBindingKey(
  identity: Pick<BrowserNotificationPushConfig, "product" | "appId">,
): string {
  return `yurucommu.browser-push.v1.${identity.product}.${identity.appId}`;
}

function readBrowserPushBinding(
  config: NormalizedBrowserPushConfig,
  runtime: BrowserNotificationPushRuntime,
): StoredBrowserPushBinding | null {
  try {
    const value = runtime.storage?.getItem(browserPushBindingKey(config));
    if (!value || value.length > 4096) return null;
    const parsed = JSON.parse(value) as Partial<StoredBrowserPushBinding>;
    if (
      typeof parsed.endpoint !== "string" ||
      typeof parsed.serverOrigin !== "string" ||
      typeof parsed.vapidPublicKey !== "string"
    ) {
      return null;
    }
    return {
      endpoint: parsed.endpoint,
      serverOrigin: parsed.serverOrigin,
      vapidPublicKey: parsed.vapidPublicKey,
      ...(parsed.kind === "webpush" && typeof parsed.pushkey === "string"
        ? { kind: "webpush" as const, pushkey: parsed.pushkey }
        : {}),
    };
  } catch {
    return null;
  }
}

function storeBrowserPushBinding(
  config: NormalizedBrowserPushConfig,
  subscription: BrowserPushSubscriptionLike,
  pushkey: string,
  runtime: BrowserNotificationPushRuntime,
): void {
  try {
    runtime.storage?.setItem(
      browserPushBindingKey(config),
      JSON.stringify({
        endpoint: subscription.endpoint,
        serverOrigin: config.serverOrigin,
        vapidPublicKey: config.vapidPublicKey,
        kind: "webpush",
        pushkey,
      } satisfies StoredBrowserPushBinding),
    );
  } catch {
    // Storage can be disabled independently of Push. The subscription's own
    // applicationServerKey still protects key rotation in that case.
  }
}

function clearBrowserPushBinding(
  config: NormalizedBrowserPushConfig,
  runtime: BrowserNotificationPushRuntime,
): void {
  clearBrowserPushBindingForIdentity(config, runtime);
}

function clearBrowserPushBindingForIdentity(
  identity: Pick<BrowserNotificationPushConfig, "product" | "appId">,
  runtime: BrowserNotificationPushRuntime,
): void {
  try {
    runtime.storage?.removeItem(browserPushBindingKey(identity));
  } catch {
    // Best-effort metadata cleanup; the Push endpoint itself is authoritative.
  }
}

function subscriptionMatchesConfig(
  config: NormalizedBrowserPushConfig,
  subscription: BrowserPushSubscriptionLike,
  runtime: BrowserNotificationPushRuntime,
): boolean {
  const binding = readBrowserPushBinding(config, runtime);
  if (
    binding &&
    (binding.endpoint !== subscription.endpoint ||
      binding.serverOrigin !== config.serverOrigin ||
      binding.vapidPublicKey !== config.vapidPublicKey)
  ) {
    return false;
  }

  const existingKey = subscription.options?.applicationServerKey;
  if (!existingKey) return binding !== null;
  return equalBufferSources(existingKey, config.applicationServerKey);
}

function equalBufferSources(left: BufferSource, right: BufferSource): boolean {
  const leftBytes = bufferSourceBytes(left);
  const rightBytes = bufferSourceBytes(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function bufferSourceBytes(value: BufferSource): Uint8Array {
  return ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

async function unregisterQuietly(
  config: NormalizedBrowserPushConfig,
  pushkey: string,
): Promise<void> {
  try {
    await unregisterNotificationPusher({
      product: config.product,
      ...(config.scope ? { scope: config.scope } : {}),
      app_id: config.appId,
      pushkey,
    });
  } catch {
    // Local invalidation is the privacy boundary. A 404/410 from the push
    // service lets the server remove a stale row when it next delivers.
  }
}

async function retireBrowserSubscription(
  config: NormalizedBrowserPushConfig,
  subscription: BrowserPushSubscriptionLike,
  runtime: BrowserNotificationPushRuntime,
  unregisterCurrentServer = false,
): Promise<void> {
  const binding = readBrowserPushBinding(config, runtime);
  const canUnregisterCurrentServer =
    unregisterCurrentServer ||
    !binding ||
    binding.serverOrigin === config.serverOrigin;
  if (canUnregisterCurrentServer) {
    // The server row is keyed by p256dh for `webpush` and by the endpoint for
    // a registration from before Web Push moved into the instance. Remove
    // whichever this browser may have; deleting a missing row is a no-op.
    const pushkeys = new Set<string>();
    if (binding?.kind === "webpush" && binding.pushkey) {
      pushkeys.add(binding.pushkey);
    } else {
      pushkeys.add(subscription.endpoint);
    }
    const keys = readSubscriptionKeys(subscription);
    if (keys) pushkeys.add(keys.p256dh);
    for (const pushkey of pushkeys) await unregisterQuietly(config, pushkey);
  }
  try {
    await subscription.unsubscribe();
  } finally {
    clearBrowserPushBinding(config, runtime);
  }
}
