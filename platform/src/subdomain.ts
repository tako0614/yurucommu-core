/**
 * Instance utilities for the single-instance OSS deployment.
 *
 * Multi-tenant routing lives in takos-private; the OSS build only resolves the
 * configured INSTANCE_DOMAIN to build ActivityPub URLs.
 */

const DEFAULT_INSTANCE_DOMAIN = "example.com";

type InstanceConfig = {
  instanceDomain?: string;
};

let activeInstanceConfig: InstanceConfig = {};

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

export function requireInstanceDomain(env: any): string {
  const domain = normalizeDomain(
    env?.INSTANCE_DOMAIN ?? activeInstanceConfig.instanceDomain ?? DEFAULT_INSTANCE_DOMAIN,
  );
  if (!domain) {
    throw new Error("INSTANCE_DOMAIN must be configured");
  }
  return domain;
}

export function getActorUri(
  handle: string,
  instanceDomain: string,
  protocol = "https",
): string {
  // Normalize handle and instanceDomain to lowercase for consistency
  const normalizedHandle = handle.toLowerCase();
  const normalizedDomain = instanceDomain.toLowerCase();
  return `${protocol}://${normalizedDomain}/ap/users/${normalizedHandle}`;
}

export function getObjectUri(
  handle: string,
  objectId: string,
  instanceDomain: string,
  protocol = "https",
): string {
  return `${protocol}://${instanceDomain}/ap/objects/${objectId}`;
}

export function getActivityUri(
  handle: string,
  activityId: string,
  instanceDomain: string,
  protocol = "https",
): string {
  return `${protocol}://${instanceDomain}/ap/activities/${activityId}`;
}

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
