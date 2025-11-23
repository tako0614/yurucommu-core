import { getConfiguredBackendHost, getConfiguredBackendOrigin } from "./config";

export function buildAbsoluteUrl(path: string): string {
  if (typeof window !== "undefined" && window.location?.origin) {
    return new URL(path, window.location.origin).toString();
  }
  return path;
}

/**
 * Build ActivityPub profile URL
 * @param handle - User handle
 * @param domain - Full domain (e.g., "example.com")
 */
function parseHandleParts(rawHandle: string): { local: string; domain?: string } {
  const trimmed = (rawHandle || "").trim();
  const withoutPrefix = trimmed.replace(/^@+/, "");
  if (!withoutPrefix) {
    return { local: "" };
  }
  const parts = withoutPrefix.split("@");
  const local = parts.shift()?.trim() ?? "";
  const domainPart = parts.length ? parts.join("@").trim() : undefined;
  return {
    local,
    domain: domainPart || undefined,
  };
}

function resolveOrigin(preferredDomain?: string): { origin?: string; host?: string } {
  const windowOrigin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : undefined;
  const windowHost =
    typeof window !== "undefined" && window.location?.host
      ? window.location.host
      : undefined;
  const configuredOrigin = getConfiguredBackendOrigin();

  const normalizedPreferred = preferredDomain?.trim();
  if (normalizedPreferred) {
    if (configuredOrigin) {
      try {
        const configuredUrl = new URL(configuredOrigin);
        if (configuredUrl.host === normalizedPreferred) {
          return { origin: configuredUrl.origin, host: configuredUrl.host };
        }
      } catch {
        // ignore parse errors and fall back to manual origin construction
      }
    }
    if (windowHost && normalizedPreferred === windowHost) {
      return { origin: windowOrigin, host: windowHost };
    }
    const origin = `https://${normalizedPreferred}`;
    try {
      const url = new URL(origin);
      return { origin: url.origin, host: url.host };
    } catch {
      return { origin, host: normalizedPreferred };
    }
  }

  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      return { origin: url.origin, host: url.host };
    } catch {
      return { origin: configuredOrigin };
    }
  }

  if (windowOrigin) {
    try {
      const url = new URL(windowOrigin);
      return { origin: url.origin, host: url.host };
    } catch {
      return { origin: windowOrigin, host: windowHost };
    }
  }

  return {};
}

export function buildProfileUrlByHandle(handle: string, domain?: string): string {
  const { local, domain: embeddedDomain } = parseHandleParts(handle);
  if (!local) {
    return buildAbsoluteUrl("/profile");
  }

  const preferredHost =
    (domain && domain.trim()) ||
    embeddedDomain ||
    getConfiguredBackendHost() ||
    (typeof window !== "undefined" && window.location?.hostname
      ? window.location.hostname
      : undefined);

  const { origin, host } = resolveOrigin(preferredHost);
  const handleHost = preferredHost || host;

  if (origin && handleHost) {
    const cleanOrigin = origin.replace(/\/+$/, "");
    return `${cleanOrigin}/@${local}@${handleHost}`;
  }

  if (handleHost) {
    return buildAbsoluteUrl(`/@${local}@${handleHost}`);
  }

  return buildAbsoluteUrl(`/@${encodeURIComponent(local)}`);
}

/**
 * Build ActivityPub handle identifier
 * @param handle - User handle
 * @param domain - Full domain (e.g., "example.com")
 */
export function buildActivityPubHandle(handle: string, domain?: string): string {
  // If domain is provided, use it directly
  if (domain) {
    return `@${handle}@${domain}`;
  }

  const backendHost = getConfiguredBackendHost();
  if (backendHost) {
    return `@${handle}@${backendHost}`;
  }

  // Use current hostname as fallback
  if (typeof window !== "undefined" && window.location?.hostname) {
    return `@${handle}@${window.location.hostname}`;
  }

  return `@${handle}`;
}

/**
 * Extract domain from user data
 * Checks for domain field, or uses current hostname
 */
export function getUserDomain(user: any): string | undefined {
  const fallbackDomain = () => {
    const backendHost = getConfiguredBackendHost();
    if (backendHost) {
      return backendHost;
    }

    if (typeof window !== "undefined" && window.location?.hostname) {
      return window.location.hostname;
    }

    return undefined;
  };

  if (!user) {
    return fallbackDomain();
  }

  // Check if user has a domain field
  if (user.domain) return user.domain;

  // Check for handle in @handle@domain format
  const handle = user.handle || "";
  if (handle.includes("@")) {
    const parts = handle.split("@");
    if (parts.length === 3 && parts[0] === "") {
      // Format: @handle@domain
      return parts[2];
    }
  }

  return fallbackDomain();
}
