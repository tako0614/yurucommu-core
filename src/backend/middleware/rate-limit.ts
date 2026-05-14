import type { Context, Next } from "hono";

import { getClientIP } from "../lib/client-ip.ts";
import type { IKeyValueStore } from "../runtime/types.ts";
import type { Env, Variables } from "../types.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "middleware.rate_limit" });

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_KV_PREFIX = "rate-limit:v1";

/**
 * In-memory fallback rate-limit store used only when distributed KV is
 * unavailable. Entries expire once `resetAt` passes; we sweep expired
 * entries on every access. A hard cap also bounds worst-case growth
 * when many distinct keys hit the limiter within a single window.
 */
const FALLBACK_RATE_LIMIT_MAX_ENTRIES = 10_000;
const fallbackRateLimitStore = new Map<string, RateLimitEntry>();

function evictExpiredFallbackEntries(now: number): void {
  for (const [key, entry] of fallbackRateLimitStore) {
    if (entry.resetAt <= now) {
      fallbackRateLimitStore.delete(key);
    }
  }
  if (fallbackRateLimitStore.size >= FALLBACK_RATE_LIMIT_MAX_ENTRIES) {
    // Safety: every entry is still within its window but the cap is hit.
    // Clear to bound memory; the worst that happens is in-flight counters
    // for evicted keys reset early (more permissive in degraded mode).
    fallbackRateLimitStore.clear();
  }
}

/** @internal Test-only inspector for the fallback store. */
export const __fallbackRateLimitInternals = {
  size: () => fallbackRateLimitStore.size,
  clear: () => fallbackRateLimitStore.clear(),
  set: (key: string, entry: RateLimitEntry) =>
    fallbackRateLimitStore.set(key, entry),
  evict: evictExpiredFallbackEntries,
  maxEntries: FALLBACK_RATE_LIMIT_MAX_ENTRIES,
};

let hasWarnedKvFailure = false;

function getRateLimitStorageKey(key: string): string {
  return `${RATE_LIMIT_KV_PREFIX}:${encodeURIComponent(key)}`;
}

function isValidEntry(v: unknown): v is RateLimitEntry {
  if (typeof v !== "object" || v === null) return false;
  const entry = v as Record<string, unknown>;
  return typeof entry.count === "number" && typeof entry.resetAt === "number";
}

function parseRateLimitEntry(
  raw: string | null,
  now: number,
): RateLimitEntry | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isValidEntry(parsed) || parsed.resetAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

function consumeLocalFallback(
  key: string,
  windowMs: number,
  now: number,
): RateLimitEntry {
  evictExpiredFallbackEntries(now);
  const existing = fallbackRateLimitStore.get(key);
  if (!existing || existing.resetAt <= now) {
    const created = { count: 1, resetAt: now + windowMs };
    fallbackRateLimitStore.set(key, created);
    return created;
  }

  const next = { ...existing, count: existing.count + 1 };
  fallbackRateLimitStore.set(key, next);
  return next;
}

async function consumeDistributed(
  kv: IKeyValueStore,
  key: string,
  windowMs: number,
  now: number,
): Promise<RateLimitEntry> {
  const storageKey = getRateLimitStorageKey(key);
  const current = parseRateLimitEntry(await kv.get(storageKey), now);

  const next: RateLimitEntry = current
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + windowMs };

  const expirationTtl = Math.max(
    60,
    Math.ceil((next.resetAt - now) / 1000) + 5,
  );
  await kv.put(storageKey, JSON.stringify(next), { expirationTtl });
  return next;
}

async function consumeRateLimit(
  kv: IKeyValueStore | undefined,
  key: string,
  windowMs: number,
  now: number,
): Promise<RateLimitEntry> {
  if (!kv) {
    return consumeLocalFallback(key, windowMs, now);
  }

  try {
    return await consumeDistributed(kv, key, windowMs, now);
  } catch (err) {
    if (!hasWarnedKvFailure) {
      hasWarnedKvFailure = true;
      log.warn("KV unavailable, falling back to in-memory limiter", {
        event: "rate_limit.kv.unavailable",
        error: err,
      });
    }
    return consumeLocalFallback(key, windowMs, now);
  }
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

function buildKey(prefix: string | undefined, clientId: string): string {
  return `${prefix ?? ""}${clientId}`;
}

const RATE_LIMIT_WINDOW_MS = 60_000;

const RATE_LIMITS = {
  general: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 10_000 },
  auth: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 20 },
  postCreate: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 3_000 },
  search: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 3_000 },
  mediaUpload: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 2_000 },
  dm: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 6_000 },
  inbox: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 20_000 },
} as const;

export const RateLimitConfigs = {
  general: { ...RATE_LIMITS.general },
  auth: { ...RATE_LIMITS.auth, keyPrefix: "auth:" },
  postCreate: { ...RATE_LIMITS.postCreate, keyPrefix: "post:" },
  search: { ...RATE_LIMITS.search, keyPrefix: "search:" },
  mediaUpload: { ...RATE_LIMITS.mediaUpload, keyPrefix: "media:" },
  dm: { ...RATE_LIMITS.dm, keyPrefix: "dm:" },
  inbox: { ...RATE_LIMITS.inbox, keyPrefix: "inbox:" },
} as const satisfies Record<string, RateLimitConfig>;

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next,
  ) => {
    // Get client identifier (IP or authenticated actor)
    const actor = c.get("actor");
    const ip = getClientIP(c);
    const clientId = actor?.ap_id || ip;

    const key = buildKey(config.keyPrefix, clientId);
    const now = Date.now();
    const entry = await consumeRateLimit(c.env.KV, key, config.windowMs, now);

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count);
    const resetAt = Math.ceil(entry.resetAt / 1000);

    c.header("X-RateLimit-Limit", config.maxRequests.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", resetAt.toString());

    // Check if rate limited
    if (entry.count > config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header("Retry-After", retryAfter.toString());

      return c.json({
        error: "Too many requests",
        retry_after: retryAfter,
      }, 429);
    }

    await next();
  };
}
