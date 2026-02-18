// Rate limiting middleware for Yurucommu backend
// Uses KV-backed distributed store (with in-memory fallback on KV failure).

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';
import { getClientIP } from '../lib/client-ip';

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

function parseRateLimitEntry(raw: string | null, now: number): RateLimitEntry | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<RateLimitEntry>;
    if (typeof parsed.count !== 'number' || typeof parsed.resetAt !== 'number') {
      return null;
    }
    if (parsed.resetAt <= now) {
      return null;
    }
    return {
      count: parsed.count,
      resetAt: parsed.resetAt,
    };
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
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix?: string;    // Prefix for the key (to differentiate rate limit types)
}

// Default configurations for different endpoint types
export const RateLimitConfigs = {
  // General API: 10,000 requests per minute
  general: { windowMs: 60000, maxRequests: 10000 },
  // Auth endpoints: 20 requests per minute
  auth: { windowMs: 60000, maxRequests: 20, keyPrefix: 'auth:' },
  // Post creation: 3,000 per minute
  postCreate: { windowMs: 60000, maxRequests: 3000, keyPrefix: 'post:' },
  // Search: 3,000 per minute
  search: { windowMs: 60000, maxRequests: 3000, keyPrefix: 'search:' },
  // Media upload: 2,000 per minute
  mediaUpload: { windowMs: 60000, maxRequests: 2000, keyPrefix: 'media:' },
  // DM: 6,000 per minute
  dm: { windowMs: 60000, maxRequests: 6000, keyPrefix: 'dm:' },
  // Federation inbox: 20,000 per minute (need to accept activities from other servers)
  inbox: { windowMs: 60000, maxRequests: 20000, keyPrefix: 'inbox:' },
};

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    // Get client identifier (IP or authenticated actor)
    const actor = c.get('actor');
    const ip = getClientIP(c);
    const clientId = actor?.ap_id || ip;

    const key = `${config.keyPrefix || ''}${clientId}`;
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
  const key = `${keyPrefix || ''}${clientId}`;
  return statusCache.get(key) || fallbackRateLimitStore.get(key) || null;
}
