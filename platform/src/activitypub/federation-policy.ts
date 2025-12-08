import type { TakosActivityPubConfig } from "../config/takos-config";

export type ActivityPubPolicy = {
  blocked: string[];
  allow: string[];
};

const BLOCKLIST_ENV_KEYS = [
  "BLOCKED_INSTANCES",
  "ACTIVITYPUB_BLOCKED_INSTANCES",
  "AP_BLOCKLIST",
  "ACTIVITYPUB_BLOCKLIST",
];

const ALLOWLIST_ENV_KEYS = ["AP_ALLOWLIST", "ACTIVITYPUB_ALLOWLIST"];

const toList = (value: unknown): string[] => {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeEntries = (items: string[]): string[] => {
  const uniq = new Set<string>();
  for (const item of items) {
    const normalized = item.trim().toLowerCase();
    if (normalized) {
      uniq.add(normalized);
    }
  }
  return Array.from(uniq);
};

const domainMatches = (hostname: string, pattern: string): boolean => {
  const host = hostname.toLowerCase();
  const pat = pattern.toLowerCase();
  return host === pat || host.endsWith(`.${pat}`);
};

export const extractHostname = (target: string): string | null => {
  if (!target || typeof target !== "string") return null;
  try {
    return new URL(target).hostname.toLowerCase();
  } catch {
    const trimmed = target.trim().toLowerCase();
    if (!trimmed) return null;
    // Allow bare domains (without scheme) for defensive matching
    if (!trimmed.includes("/") && !trimmed.includes(" ")) {
      return trimmed;
    }
    return null;
  }
};

export function buildActivityPubPolicy(
  options: { env?: any; config?: TakosActivityPubConfig | null } = {},
): ActivityPubPolicy {
  const configBlocked = normalizeEntries(options.config?.blocked_instances ?? []);
  const envBlocked = normalizeEntries(
    BLOCKLIST_ENV_KEYS.flatMap((key) => toList(options.env?.[key])),
  );
  const envAllow = normalizeEntries(ALLOWLIST_ENV_KEYS.flatMap((key) => toList(options.env?.[key])));

  return {
    blocked: normalizeEntries([...configBlocked, ...envBlocked]),
    allow: envAllow,
  };
}

export function applyFederationPolicy(
  target: string,
  policy: ActivityPubPolicy,
): { allowed: boolean; hostname: string | null; reason?: "blocked" | "allowlist" } {
  const hostname = extractHostname(target);
  if (!hostname) {
    if (policy.allow.length > 0) {
      return { allowed: false, hostname: null, reason: "allowlist" };
    }
    return { allowed: true, hostname: null };
  }

  if (policy.blocked.some((pattern) => domainMatches(hostname, pattern))) {
    return { allowed: false, hostname, reason: "blocked" };
  }

  if (policy.allow.length > 0 && !policy.allow.some((pattern) => domainMatches(hostname, pattern))) {
    return { allowed: false, hostname, reason: "allowlist" };
  }

  return { allowed: true, hostname };
}
