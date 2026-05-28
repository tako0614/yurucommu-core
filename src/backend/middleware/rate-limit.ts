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
 *
 * When the cap is hit, the store uses LRU eviction (Map iteration order
 * is insertion order — by re-inserting an entry every time it is touched
 * the oldest live entries naturally end up at the front). This is more
 * forgiving than the previous `.clear()` behaviour (which reset every
 * counter and effectively bypassed the limiter for one window).
 */
const FALLBACK_RATE_LIMIT_MAX_ENTRIES = 10_000;
const fallbackRateLimitStore = new Map<string, RateLimitEntry>();

function evictExpiredFallbackEntries(now: number): void {
  for (const [key, entry] of fallbackRateLimitStore) {
    if (entry.resetAt <= now) {
      fallbackRateLimitStore.delete(key);
    }
  }
  enforceFallbackLruCap();
}

function enforceFallbackLruCap(): void {
  while (fallbackRateLimitStore.size > FALLBACK_RATE_LIMIT_MAX_ENTRIES) {
    // Map preserves insertion order; the first key is the least-recently
    // touched entry under the LRU re-insertion strategy used below.
    const iter = fallbackRateLimitStore.keys().next();
    if (iter.done) break;
    fallbackRateLimitStore.delete(iter.value);
  }
}

function touchFallbackEntry(key: string, entry: RateLimitEntry): void {
  // Re-inserting moves the key to the end of the Map iteration order,
  // which our LRU eviction relies on.
  fallbackRateLimitStore.delete(key);
  fallbackRateLimitStore.set(key, entry);
}

/** @internal Test-only inspector for the fallback store. */
export const __fallbackRateLimitInternals = {
  size: () => fallbackRateLimitStore.size,
  clear: () => fallbackRateLimitStore.clear(),
  set: (key: string, entry: RateLimitEntry) =>
    fallbackRateLimitStore.set(key, entry),
  touch: touchFallbackEntry,
  evict: evictExpiredFallbackEntries,
  enforceCap: enforceFallbackLruCap,
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
    touchFallbackEntry(key, created);
    enforceFallbackLruCap();
    return created;
  }

  const next = { ...existing, count: existing.count + 1 };
  touchFallbackEntry(key, next);
  enforceFallbackLruCap();
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

/**
 * Threshold reasoning (per-minute, bucketed by client IP unless a logged-in
 * actor is present, in which case the actor AP-ID is used):
 *
 *  - `general` (1k/min): generic page load + asset traffic. Even an SPA
 *    that fans out fetches on first paint stays well under 1k for a real
 *    user. Anything beyond is a scraper or a runaway client and should
 *    cool off.
 *  - `auth` (20/min): credential endpoints. Lower bound on guessing
 *    (a real user reauthenticating after a token rotation still
 *    fits inside 20). Kept tight because a brute-force window matters
 *    more than a smooth-UX false positive.
 *  - `postCreate` (200/min): publish/edit. A single user cannot meaningfully
 *    post 200 times per minute; multi-window scheduled jobs / bulk imports
 *    should authenticate as a service account with a higher quota.
 *  - `search` (3k/min): timeline search; this includes typeahead-style
 *    incremental queries so the budget is intentionally generous.
 *  - `mediaUpload` (2k/min): R2/media uploads; bounded by upstream
 *    egress, but we keep a sub-budget here for abuse detection.
 *  - `dm` (600/min): direct message send. Tight enough to make a spam
 *    bot visible without breaking an active human conversation.
 *  - `inbox` (1k/min): per-IP inbound federation. Previously 20k which
 *    effectively disabled the limiter — a misbehaving peer instance
 *    behind a single egress IP could DoS us. 1k/min is well above any
 *    legitimate peer throughput; per-domain caps (`inboxDomain` below)
 *    add a second-level guard for peers behind multiple egresses.
 *  - `inboxDomain` (1k/min): per-source-domain inbound federation.
 *    Same rationale as `inbox` but bucketed by the peer's hostname so
 *    that a domain with many egress IPs cannot multiply its budget.
 *  - `federationDiscovery` (60/min): WebFinger / NodeInfo / actor doc
 *    lookups. Public discovery should be slow enough to discourage
 *    enumeration.
 */
const RATE_LIMITS = {
  general: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 1_000 },
  auth: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 20 },
  postCreate: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 200 },
  search: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 3_000 },
  mediaUpload: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 2_000 },
  dm: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 600 },
  inbox: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 1_000 },
  inboxDomain: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 1_000 },
  federationDiscovery: { windowMs: RATE_LIMIT_WINDOW_MS, maxRequests: 60 },
} as const;

export const RateLimitConfigs = {
  general: { ...RATE_LIMITS.general },
  auth: { ...RATE_LIMITS.auth, keyPrefix: "auth:" },
  postCreate: { ...RATE_LIMITS.postCreate, keyPrefix: "post:" },
  search: { ...RATE_LIMITS.search, keyPrefix: "search:" },
  mediaUpload: { ...RATE_LIMITS.mediaUpload, keyPrefix: "media:" },
  dm: { ...RATE_LIMITS.dm, keyPrefix: "dm:" },
  inbox: { ...RATE_LIMITS.inbox, keyPrefix: "inbox:" },
  inboxDomain: { ...RATE_LIMITS.inboxDomain, keyPrefix: "inbox-domain:" },
  federationDiscovery: {
    ...RATE_LIMITS.federationDiscovery,
    keyPrefix: "fed-disc:",
  },
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

/**
 * Programmatic rate-limit consume helper used outside the middleware path.
 * Returns the updated entry so the caller can decide how to respond. Used by
 * the ActivityPub inbox to apply per-domain throttling alongside the
 * per-IP middleware.
 */
export async function consumeRateLimitProgrammatic(
  kv: IKeyValueStore | undefined,
  config: RateLimitConfig,
  bucketKey: string,
): Promise<{ entry: RateLimitEntry; limited: boolean; retryAfter: number }> {
  const key = buildKey(config.keyPrefix, bucketKey);
  const now = Date.now();
  const entry = await consumeRateLimit(kv, key, config.windowMs, now);
  const limited = entry.count > config.maxRequests;
  const retryAfter = Math.max(0, Math.ceil((entry.resetAt - now) / 1000));
  return { entry, limited, retryAfter };
}
