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

/**
 * @deprecated Build-time push values are ignored since 4.2.0. The instance
 * derives its VAPID key from its own secret and serves it only through
 * GET /api/notifications/pushers/config; a key baked into a build is the
 * gateway-era key, and subscribing or comparing with it would make the SDK
 * retire a working subscription.
 */
export interface BrowserPushRuntimeValues {
  /** @deprecated Ignored; browser push no longer goes through a gateway. */
  readonly gatewayUrl?: string | null;
  /** @deprecated Ignored; only the server's runtime key is used. */
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
   * @deprecated Ignored since 4.2.0 (see BrowserPushRuntimeValues). Accepted
   * so existing callers keep compiling.
   */
  readonly buildTimeValues?: () => BrowserPushRuntimeValues | null;
}

export interface BrowserPushConfigResolver {
  /**
   * @deprecated Always null since 4.2.0: the instance's key is known only at
   * runtime. Use `resolveConfig`.
   */
  readonly buildTimeConfig: () => BrowserNotificationPushConfig | null;
  /**
   * Resolve config from the server's runtime pusher config
   * (`web_push_instance_public_key`). Null when the server has no key, is
   * older than 4.2.0, or cannot be reached — "unconfigured", which never
   * touches an existing subscription.
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
  const { identity, resolveServerOrigin } = options;

  const build = (
    instancePublicKey: string | null | undefined,
  ): BrowserNotificationPushConfig | null => {
    const vapidPublicKey = instancePublicKey?.trim();
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

  const buildTimeConfig = (): BrowserNotificationPushConfig | null => null;

  const resolveConfig =
    async (): Promise<BrowserNotificationPushConfig | null> => {
      try {
        const runtime = await fetchNotificationPusherPublicConfig();
        if (!runtime.enabled) return null;
        return build(runtime.web_push_instance_public_key);
      } catch {
        // No fallback key: a stale build-time key would make refresh retire
        // the browser's working subscription. Unconfigured touches nothing.
        return null;
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
