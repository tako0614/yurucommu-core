// Rate limiting middleware for Yurucommu backend
// Uses in-memory Map for simple rate limiting (per-worker instance)
// For distributed rate limiting, use KV or Durable Objects

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Store rate limit data in memory (per-worker instance)
// For production scale, consider using Cloudflare KV or Durable Objects
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries periodically
const CLEANUP_INTERVAL = 60000; // 1 minute
let lastCleanup = Date.now();

function cleanupExpired(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  keyPrefix?: string;    // Prefix for the key (to differentiate rate limit types)
}

// Default configurations for different endpoint types
export const RateLimitConfigs = {
  // General API: 100 requests per minute
  general: { windowMs: 60000, maxRequests: 100 },
  // Auth endpoints: 10 requests per minute (prevent brute force)
  auth: { windowMs: 60000, maxRequests: 10, keyPrefix: 'auth:' },
  // Post creation: 30 per minute
  postCreate: { windowMs: 60000, maxRequests: 30, keyPrefix: 'post:' },
  // Search: 30 per minute
  search: { windowMs: 60000, maxRequests: 30, keyPrefix: 'search:' },
  // Media upload: 20 per minute
  mediaUpload: { windowMs: 60000, maxRequests: 20, keyPrefix: 'media:' },
  // DM: 60 per minute
  dm: { windowMs: 60000, maxRequests: 60, keyPrefix: 'dm:' },
  // Federation inbox: 200 per minute (need to accept activities from other servers)
  inbox: { windowMs: 60000, maxRequests: 200, keyPrefix: 'inbox:' },
};

/**
 * Create a rate limiting middleware
 */
export function rateLimit(config: RateLimitConfig) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    cleanupExpired();

    // Get client identifier (IP or authenticated actor)
    const actor = c.get('actor');
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const clientId = actor?.ap_id || ip;

    const key = `${config.keyPrefix || ''}${clientId}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    // If no entry or expired, create new one
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 1,
        resetAt: now + config.windowMs,
      };
      rateLimitStore.set(key, entry);
    } else {
      entry.count++;
    }

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
        retryAfter,
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
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
  return rateLimitStore.get(key) || null;
}
