import type {
  NotificationPusherProduct,
  NotificationPusherRegistration,
} from "../../types/index.ts";
import {
  registerNotificationPusher,
  unregisterNotificationPusher,
} from "./notifications.ts";

export type BrowserNotificationPushState =
  "unsupported" | "unconfigured" | "denied" | "disabled" | "enabled";

export interface BrowserNotificationPushConfig {
  readonly product: NotificationPusherProduct;
  readonly appId: string;
  readonly appDisplayName: string;
  /** Origin of the yurucommu-compatible API that owns this registration. */
  readonly serverOrigin: string;
  /** Public stateless gateway notify endpoint. */
  readonly gatewayUrl: string;
  /** Public uncompressed P-256 VAPID key, base64url encoded. */
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
  unsubscribe(): Promise<boolean>;
}

interface BrowserPushManagerLike {
  getSubscription(): Promise<BrowserPushSubscriptionLike | null>;
  subscribe(options: {
    readonly userVisibleOnly: true;
    readonly applicationServerKey: BufferSource;
  }): Promise<BrowserPushSubscriptionLike>;
}

interface BrowserServiceWorkerRegistrationLike {
  readonly pushManager: BrowserPushManagerLike;
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
  const registration = await registerBrowserSubscription(
    normalized,
    subscription,
  );
  storeBrowserPushBinding(normalized, subscription, runtime);
  return { state: "enabled", registration };
}

/**
 * Rebind an existing browser subscription to the current signed-in actor.
 * This never requests permission and never creates a new subscription.
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
  const subscription = await serviceWorker.pushManager.getSubscription();
  if (!subscription) return "disabled";
  if (!subscriptionMatchesConfig(normalized, subscription, runtime)) {
    await retireBrowserSubscription(normalized, subscription, runtime);
    return "disabled";
  }
  await registerBrowserSubscription(normalized, subscription);
  storeBrowserPushBinding(normalized, subscription, runtime);
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
  // even when the host cannot remove its row. The next rejected delivery lets
  // the host clean that stale row.
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
      "Browser notification push requires a valid HTTPS gateway URL, VAPID public key, app id, and root-relative service worker path.",
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
  const gatewayUrl = normalizeGatewayUrl(config.gatewayUrl);
  const vapidPublicKey = config.vapidPublicKey.trim();
  const applicationServerKey = decodeVapidPublicKey(vapidPublicKey);
  const serviceWorkerPath = config.serviceWorkerPath.trim();
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/.test(appId) ||
    !appDisplayName ||
    appDisplayName.length > 255 ||
    !serverOrigin ||
    !gatewayUrl ||
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
    gatewayUrl,
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
 * Client-side gateway URL policy. MUST stay behaviorally equivalent to the
 * server's `normalizeGatewayUrl` in the notification pusher contract — a
 * client-accepted / server-rejected URL yields a confusing "registers but
 * 400s" failure. The equivalence is pinned by a shared-fixture drift test.
 * Exported for that test; app code calls the higher-level helpers above.
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

function decodeVapidPublicKey(value: string): BufferSource | null {
  const normalized = value.trim().replace(/-/g, "+").replace(/_/g, "/");
  if (!normalized || normalized.length > 256) return null;
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    // Web Push uses an uncompressed P-256 public key.
    return bytes.byteLength === 65 && bytes[0] === 0x04 ? bytes : null;
  } catch {
    return null;
  }
}

async function registerBrowserSubscription(
  config: NormalizedBrowserPushConfig,
  subscription: BrowserPushSubscriptionLike,
): Promise<NotificationPusherRegistration> {
  const registration = await registerNotificationPusher({
    product: config.product,
    ...(config.scope ? { scope: config.scope } : {}),
    pusher: {
      kind: "http",
      app_id: config.appId,
      app_display_name: config.appDisplayName,
      pushkey: subscription.endpoint,
      ...(config.lang ? { lang: config.lang } : {}),
      data: {
        url: config.gatewayUrl,
        format: "event_id_only",
        provider: "webpush",
        ttl: 60,
        urgency: "normal",
      },
    },
  });
  return registration;
}

type StoredBrowserPushBinding = {
  readonly endpoint: string;
  readonly serverOrigin: string;
  readonly vapidPublicKey: string;
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
    return typeof parsed.endpoint === "string" &&
      typeof parsed.serverOrigin === "string" &&
      typeof parsed.vapidPublicKey === "string"
      ? {
          endpoint: parsed.endpoint,
          serverOrigin: parsed.serverOrigin,
          vapidPublicKey: parsed.vapidPublicKey,
        }
      : null;
  } catch {
    return null;
  }
}

function storeBrowserPushBinding(
  config: NormalizedBrowserPushConfig,
  subscription: BrowserPushSubscriptionLike,
  runtime: BrowserNotificationPushRuntime,
): void {
  try {
    runtime.storage?.setItem(
      browserPushBindingKey(config),
      JSON.stringify({
        endpoint: subscription.endpoint,
        serverOrigin: config.serverOrigin,
        vapidPublicKey: config.vapidPublicKey,
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
    try {
      await unregisterNotificationPusher({
        product: config.product,
        ...(config.scope ? { scope: config.scope } : {}),
        app_id: config.appId,
        pushkey: subscription.endpoint,
      });
    } catch {
      // Local invalidation below is the privacy boundary. A rejected delivery
      // lets the old server remove a stale row when it becomes reachable.
    }
  }
  try {
    await subscription.unsubscribe();
  } finally {
    clearBrowserPushBinding(config, runtime);
  }
}
