import type { Context, Next } from 'hono';

import { getClientIP } from '../lib/client-ip';
import type { Env, Variables } from '../types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const RATE_LIMIT_KV_PREFIX = 'rate-limit:v1';
const fallbackRateLimitStore = new Map<string, RateLimitEntry>();
const statusCache = new Map<string, RateLimitEntry>();

let hasWarnedKvFailure = false;

function getRateLimitStorageKey(key: string): string {
  return `${RATE_LIMIT_KV_PREFIX}:${encodeURIComponent(key)}`;
}

function isValidEntry(v: Partial<RateLimitEntry>): v is RateLimitEntry {
  return typeof v.count === 'number' && typeof v.resetAt === 'number';
}

function parseRateLimitEntry(raw: string | null, now: number): RateLimitEntry | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<RateLimitEntry>;
    if (!isValidEntry(parsed) || parsed.resetAt <= now) return null;
    return parsed;
  } catch {
    return null;
  }
}

function consumeLocalFallback(key: string, windowMs: number, now: number): RateLimitEntry {
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
  kv: KVNamespace,
  key: string,
  windowMs: number,
  now: number
): Promise<RateLimitEntry> {
  const storageKey = getRateLimitStorageKey(key);
  const current = parseRateLimitEntry(await kv.get(storageKey), now);

  const next: RateLimitEntry = current
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt: now + windowMs };

  const expirationTtl = Math.max(1, Math.ceil((next.resetAt - now) / 1000) + 5);
  await kv.put(storageKey, JSON.stringify(next), { expirationTtl });
  return next;
}

async function consumeRateLimit(
  kv: KVNamespace | undefined,
  key: string,
  windowMs: number,
  now: number
): Promise<RateLimitEntry> {
  if (!kv) {
    return consumeLocalFallback(key, windowMs, now);
  }

  try {
    return await consumeDistributed(kv, key, windowMs, now);
  } catch (err) {
    if (!hasWarnedKvFailure) {
      hasWarnedKvFailure = true;
      console.warn('[RateLimit] KV unavailable, falling back to in-memory limiter', err);
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
  return `${prefix ?? ''}${clientId}`;
}

export const RateLimitConfigs = {
  general:     { windowMs: 60000, maxRequests: 10000 },
  auth:        { windowMs: 60000, maxRequests: 20,    keyPrefix: 'auth:' },
  postCreate:  { windowMs: 60000, maxRequests: 3000,  keyPrefix: 'post:' },
  search:      { windowMs: 60000, maxRequests: 3000,  keyPrefix: 'search:' },
  mediaUpload: { windowMs: 60000, maxRequests: 2000,  keyPrefix: 'media:' },
  dm:          { windowMs: 60000, maxRequests: 6000,  keyPrefix: 'dm:' },
  inbox:       { windowMs: 60000, maxRequests: 20000, keyPrefix: 'inbox:' },
} as const satisfies Record<string, RateLimitConfig>;

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    // Get client identifier (IP or authenticated actor)
    const actor = c.get('actor');
    const ip = getClientIP(c);
    const clientId = actor?.ap_id || ip;

    const key = buildKey(config.keyPrefix, clientId);
    const now = Date.now();
    const entry = await consumeRateLimit(c.env.KV, key, config.windowMs, now);
    statusCache.set(key, entry);

    // Set rate limit headers
    const remaining = Math.max(0, config.maxRequests - entry.count);
    const resetAt = Math.ceil(entry.resetAt / 1000);

    c.header('X-RateLimit-Limit', config.maxRequests.toString());
    c.header('X-RateLimit-Remaining', remaining.toString());
    c.header('X-RateLimit-Reset', resetAt.toString());

    // Check if rate limited
    if (entry.count > config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      c.header('Retry-After', retryAfter.toString());

      return c.json({
        error: 'Too many requests',
        retry_after: retryAfter,
      }, 429);
    }

    await next();
  };
}

/**
 * Get current rate limit status for a client (useful for debugging/monitoring)
 */
export function getRateLimitStatus(clientId: string, keyPrefix?: string): RateLimitEntry | null {
  const key = buildKey(keyPrefix, clientId);
  return statusCache.get(key) ?? fallbackRateLimitStore.get(key) ?? null;
}
