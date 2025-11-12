/**
 * Instance-scoped routing helpers.
 *
 * The platform treats every Worker instance as operating on a fully qualified
 * domain (INSTANCE_DOMAIN) and accepts an explicit tenant handle when needed.
 */

import type { Context, Next } from "hono";

export const DEFAULT_INSTANCE_DOMAIN = "yurucommu.com";

export type TenantContext = {
  tenantHandle: string | null;
  tenantMode: "user" | "root" | "reserved";
};

export type InstanceConfig = {
  instanceDomain?: string;
  tenantHandle?: string | null;
};

let activeInstanceConfig: InstanceConfig = {};

const HANDLE_PATTERN = /^[a-z0-9_]{3,32}$/;

/**
 * Update the default instance configuration used by platform helpers.
 * Can be called from the backend factory to inject per-app settings.
 */
export function setInstanceConfig(config: InstanceConfig): void {
  activeInstanceConfig = {
    ...activeInstanceConfig,
    ...config,
  };
}

function normalizeDomain(domain: string | undefined | null): string | undefined {
  if (!domain) return undefined;
  return String(domain).trim().toLowerCase();
}

function normalizeHandle(value?: string | null): string | null {
  if (value == null) return null;
  const handle = String(value).trim().toLowerCase();
  if (!handle) return null;
  return HANDLE_PATTERN.test(handle) ? handle : null;
}

function deriveHandleFromDomain(domain?: string | null): string | null {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;
  const [candidate, ...rest] = normalizedDomain.split(".");
  if (!candidate || rest.length === 0) return null;
  return HANDLE_PATTERN.test(candidate) ? candidate : null;
}

function resolveInstanceDomain(env: any, override?: string): string | undefined {
  return normalizeDomain(
    override ??
      activeInstanceConfig.instanceDomain ??
      env?.INSTANCE_DOMAIN ??
      DEFAULT_INSTANCE_DOMAIN,
  );
}

function resolveTenantHandle(
  env: any,
  instanceDomain?: string,
  override?: string | null,
): string | null {
  const configured = normalizeHandle(
    override ??
      activeInstanceConfig.tenantHandle ??
      env?.INSTANCE_TENANT_HANDLE ??
      null,
  );
  if (configured) {
    return configured;
  }
  return deriveHandleFromDomain(instanceDomain ?? resolveInstanceDomain(env));
}

/**
 * Require INSTANCE_DOMAIN to be present. Throws if missing.
 */
export function requireInstanceDomain(env: any): string {
  const domain = resolveInstanceDomain(env);
  if (!domain) {
    throw new Error(
      "INSTANCE_DOMAIN must be configured via createTakosApp() or env.INSTANCE_DOMAIN",
    );
  }
  return domain;
}

export type SubdomainMiddlewareOptions = {
  instanceDomain?: string;
  tenantHandle?: string | null;
};

/**
 * Instance routing middleware.
 *
 * The middleware ensures c.env.INSTANCE_DOMAIN is always populated with the
 * resolved domain and stores tenant metadata on the context for downstream
 * handlers. Reserved tenant mode is kept for backward compatibility, although
 * the platform no longer distinguishes reserved subdomains explicitly.
 */
export function subdomainMiddleware(
  options: SubdomainMiddlewareOptions = {},
) {
  return async (c: Context, next: Next) => {
    try {
      const instanceDomain = resolveInstanceDomain(
        c.env,
        options.instanceDomain,
      );
      if (!instanceDomain) {
        throw new Error("INSTANCE_DOMAIN not configured");
      }
      // Ensure downstream consumers observe the resolved domain.
      c.env.INSTANCE_DOMAIN = instanceDomain;

      const tenantHandle = resolveTenantHandle(
        c.env,
        instanceDomain,
        options.tenantHandle,
      );
      const tenantMode: TenantContext["tenantMode"] = tenantHandle
        ? "user"
        : "root";

      c.set("tenantHandle", tenantHandle);
      c.set("tenantMode", tenantMode);

      await next();
    } catch (error) {
      console.error("Instance context error:", error);
      c.set("tenantHandle", null);
      c.set("tenantMode", "root");
      await next();
    }
  };
}

/**
 * Require that the current request is scoped to a tenant.
 */
export function requireUserTenant() {
  return async (c: Context, next: Next) => {
    const tenantMode = c.get("tenantMode");
    const tenantHandle = c.get("tenantHandle");

    if (tenantMode !== "user" || !tenantHandle) {
      return c.json(
        {
          ok: false,
          error: "This endpoint must be accessed with a tenant-scoped domain",
        },
        404,
      );
    }

    await next();
  };
}

/**
 * Build Actor URI for a local user on this instance.
 */
export function getActorUri(
  handle: string,
  instanceDomain: string,
  protocol: string = "https",
): string {
  return `${protocol}://${instanceDomain}/ap/users/${handle}`;
}

/**
 * Build Object URI for a local post.
 */
export function getObjectUri(
  handle: string,
  objectId: string,
  instanceDomain: string,
  protocol: string = "https",
): string {
  return `${protocol}://${instanceDomain}/ap/objects/${objectId}`;
}

/**
 * Build Activity URI for a local activity.
 */
export function getActivityUri(
  handle: string,
  activityId: string,
  instanceDomain: string,
  protocol: string = "https",
): string {
  return `${protocol}://${instanceDomain}/ap/activities/${activityId}`;
}

/**
 * Parse an Actor URI and determine whether it belongs to this instance.
 */
export function parseActorUri(
  uri: string,
  instanceDomain: string,
): { handle: string; domain: string; isLocal: boolean } | null {
  try {
    const url = new URL(uri);
    const domain = url.hostname.toLowerCase();
    const isLocal = domain === instanceDomain.toLowerCase();

    const match = url.pathname.match(/^\/ap\/users\/([a-z0-9_]{3,20})$/);
    if (!match) return null;

    const handle = match[1];

    return {
      handle,
      domain,
      isLocal,
    };
  } catch {
    return null;
  }
}
