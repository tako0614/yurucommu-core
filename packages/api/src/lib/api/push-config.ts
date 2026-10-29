import type { NotificationPusherProduct } from "../../types/index.ts";
import {
  clearBrowserNotificationPush,
  disableBrowserNotificationPush,
  type BrowserNotificationPushConfig,
} from "./browser-push.ts";
import { fetchNotificationPusherPublicConfig } from "./notifications.ts";

/**
 * Stable identity of a browser/PWA push client. Everything here is a per-app
 * constant; only the instance's VAPID key and the server origin are resolved
 * at runtime.
 */
export interface BrowserPushClientIdentity {
  readonly product: NotificationPusherProduct;
  readonly appId: string;
  readonly appDisplayName: string;
  /** Root-relative service worker script path (e.g. "/notification-push-sw.js"). */
  readonly serviceWorkerPath: string;
  readonly scope?: string;
  readonly lang?: string;
}

/** Non-secret runtime push values, from a fetch or build-time fallback. */
export interface BrowserPushRuntimeValues {
  /** @deprecated Ignored; browser push no longer goes through a gateway. */
  readonly gatewayUrl?: string | null;
  readonly vapidPublicKey?: string | null;
}

export interface BrowserPushConfigResolverOptions {
  readonly identity: BrowserPushClientIdentity;
  /**
   * Origin of the yurucommu-compatible API that owns the registration. Returns
   * null when it cannot be determined (e.g. SSR, or an unconfigured shell), in
   * which case config resolution yields null.
   */
  readonly resolveServerOrigin: () => string | null;
  /**
   * Build-time fallback used only when the server's runtime config cannot be
   * fetched; a responding runtime config always wins.
   */
  readonly buildTimeValues?: () => BrowserPushRuntimeValues | null;
}

export interface BrowserPushConfigResolver {
  /** Build config from build-time values only (no network). */
  readonly buildTimeConfig: () => BrowserNotificationPushConfig | null;
  /**
   * Resolve config from the server's runtime pusher config (the instance's
   * own VAPID key), falling back to build-time values only if the server is
   * unreachable. A server without a key has Web Push disabled.
   */
  readonly resolveConfig: () => Promise<BrowserNotificationPushConfig | null>;
  /**
   * Invalidate this device's endpoint before sign-out / account teardown,
   * disabling via the resolved config when possible and always clearing the
   * local subscription so a signed-out device is never woken.
   */
  readonly clearBeforeSignOut: () => Promise<void>;
}

/**
 * Build a browser push config resolver for a single client identity. Promoted
 * from the near-identical per-app resolvers in the yurucommu and yurume web
 * clients so the fetch/fallback/clear flow lives in one place.
 */
export function createBrowserPushConfigResolver(
  options: BrowserPushConfigResolverOptions,
): BrowserPushConfigResolver {
  const { identity, resolveServerOrigin, buildTimeValues } = options;

  const build = (
    values: BrowserPushRuntimeValues | null | undefined,
  ): BrowserNotificationPushConfig | null => {
    const vapidPublicKey = values?.vapidPublicKey?.trim();
    if (!vapidPublicKey) return null;
    const serverOrigin = resolveServerOrigin();
    if (!serverOrigin) return null;
    return {
      product: identity.product,
      appId: identity.appId,
      appDisplayName: identity.appDisplayName,
      serverOrigin,
      vapidPublicKey,
      serviceWorkerPath: identity.serviceWorkerPath,
      ...(identity.scope ? { scope: identity.scope } : {}),
      ...(identity.lang ? { lang: identity.lang } : {}),
    };
  };

  const buildTimeConfig = (): BrowserNotificationPushConfig | null =>
    build(buildTimeValues?.() ?? null);

  const resolveConfig =
    async (): Promise<BrowserNotificationPushConfig | null> => {
      try {
        const runtime = await fetchNotificationPusherPublicConfig();
        if (!runtime.enabled || !runtime.web_push_public_key) return null;
        return build({ vapidPublicKey: runtime.web_push_public_key });
      } catch {
        // Compatibility with older servers while they roll forward. Build-time
        // public values are a fallback only; a responding runtime config is the
        // deployment authority.
        return buildTimeConfig();
      }
    };

  const clearBeforeSignOut = async (): Promise<void> => {
    const config = await resolveConfig().catch(() => null);
    if (config) {
      try {
        await disableBrowserNotificationPush(config);
        return;
      } catch {
        // Fall through to local endpoint invalidation.
      }
    }
    await clearBrowserNotificationPush(identity).catch(() => undefined);
  };

  return { buildTimeConfig, resolveConfig, clearBeforeSignOut };
}
