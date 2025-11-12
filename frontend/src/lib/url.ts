import { getConfiguredBackendHost } from "./config";

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
export function buildProfileUrlByHandle(handle: string, domain?: string): string {
  // If domain is provided, use it directly
  if (domain) {
    return `https://${domain}/@${encodeURIComponent(handle)}`;
  }
  const backendHost = getConfiguredBackendHost();
  if (backendHost) {
    return `https://${backendHost}/@${encodeURIComponent(handle)}`;
  }
  // Fallback to current domain
  return buildAbsoluteUrl(`/@${encodeURIComponent(handle)}`);
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
  // Check if user has a domain field
  if (user.domain) return user.domain;

  // Check for handle in @handle@domain format
  const handle = user.handle || '';
  if (handle.includes('@')) {
    const parts = handle.split('@');
    if (parts.length === 3 && parts[0] === '') {
      // Format: @handle@domain
      return parts[2];
    }
  }

  // Prefer configured backend host when available
  const backendHost = getConfiguredBackendHost();
  if (backendHost) {
    return backendHost;
  }

  // Fallback to current hostname
  if (typeof window !== "undefined" && window.location?.hostname) {
    return window.location.hostname;
  }

  return undefined;
}
