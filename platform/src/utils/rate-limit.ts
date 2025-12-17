/**
 * Rate Limiting Middleware for ActivityPub Inbox
 *
 * Implements per-instance and per-actor rate limiting to prevent abuse
 */

import type { Context } from "hono";
import type { D1Database } from "@cloudflare/workers-types";
import { makeData } from "../server/data-factory";
import { fail } from "./response-helpers";

export interface RateLimitConfig {
  // Maximum requests per window
  maxRequests: number;
  // Window size in seconds
  windowSeconds: number;
  // Namespace for rate limit (e.g., "inbox", "api")
  namespace: string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp
}

export const buildRateLimitExceededResponse = (
  c: Context,
  message: string,
  details: Record<string, unknown>,
  resetUnix: number,
): Response => {
  const nowUnix = Math.floor(Date.now() / 1000);
  const retryAfter = Math.max(0, resetUnix - nowUnix);
  return fail(c, message, 429, {
    code: "RATE_LIMIT_EXCEEDED",
    details,
    headers: {
      ...(retryAfter > 0 ? { "Retry-After": String(retryAfter) } : {}),
    },
  });
};

/**
 * Default rate limit configurations
 */
export const RATE_LIMITS = {
  // Inbox: 100 requests per hour per remote instance
  INBOX_PER_INSTANCE: {
    maxRequests: 100,
    windowSeconds: 3600,
    namespace: "inbox:instance",
  } as RateLimitConfig,

  // Inbox: 20 requests per hour per remote actor
  INBOX_PER_ACTOR: {
    maxRequests: 20,
    windowSeconds: 3600,
    namespace: "inbox:actor",
  } as RateLimitConfig,

  // WebFinger: 60 requests per minute per IP
  WEBFINGER_PER_IP: {
    maxRequests: 60,
    windowSeconds: 60,
    namespace: "webfinger:ip",
  } as RateLimitConfig,
};

/**
 * Check rate limit using Database API
 *
 * @param env - Environment with DB binding
 * @param key - Unique key for this rate limit (e.g., "mastodon.social")
 * @param config - Rate limit configuration
 * @returns Rate limit result
 */
export async function checkRateLimit(
  env: { DB: D1Database },
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - config.windowSeconds * 1000;
  const rateLimitKey = `${config.namespace}:${key}`;

  const store = makeData(env as any);

  try {
    // Clean up old entries
    await store.deleteOldRateLimits(rateLimitKey, windowStart);

    // Get current count
    const result = await store.countRateLimits(rateLimitKey, windowStart);

    const count = result.count;
    const oldestWindow = result.oldestWindow;

    // Calculate reset time (when oldest entry expires)
    const reset = Math.floor((Number(oldestWindow) + config.windowSeconds * 1000) / 1000);

    if (count >= config.maxRequests) {
      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        reset,
      };
    }

    // Increment counter
    await store.createRateLimitEntry(crypto.randomUUID(), rateLimitKey, now, now);

    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - count - 1,
      reset,
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // On error, allow request but log
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests,
      reset: Math.floor((now + config.windowSeconds * 1000) / 1000),
    };
  } finally {
    await store.disconnect();
  }
}

/**
 * Rate limit middleware for Inbox endpoints
 *
 * Checks both per-instance and per-actor limits
 */
export function inboxRateLimitMiddleware() {
  return async (c: Context, next: () => Promise<void>) => {
    const env = c.env as { DB: D1Database };

    // Get remote actor from request body
    let actorId: string | null = null;
    let instanceDomain: string | null = null;

    try {
      const body = await c.req.json();
      const actor = typeof body.actor === "string" ? body.actor : body.actor?.id;

      if (actor && typeof actor === "string") {
        actorId = actor;
        const url = new URL(actor);
        instanceDomain = url.hostname;
      }

      // Note: Body has already been consumed, downstream handlers should re-parse if needed
    } catch (error) {
      // Invalid JSON, let downstream handler deal with it
      console.error("Rate limit: Failed to parse body", error);
    }

    // Check per-instance limit
    if (instanceDomain) {
      const instanceLimit = await checkRateLimit(env, instanceDomain, RATE_LIMITS.INBOX_PER_INSTANCE);

      // Add rate limit headers
      c.header("X-RateLimit-Limit", instanceLimit.limit.toString());
      c.header("X-RateLimit-Remaining", instanceLimit.remaining.toString());
      c.header("X-RateLimit-Reset", instanceLimit.reset.toString());

      if (!instanceLimit.allowed) {
        console.warn(`Rate limit exceeded for instance: ${instanceDomain}`);
        return buildRateLimitExceededResponse(
          c,
          "Rate limit exceeded",
          {
            namespace: RATE_LIMITS.INBOX_PER_INSTANCE.namespace,
            key: instanceDomain,
            limit: instanceLimit.limit,
            remaining: instanceLimit.remaining,
            reset: instanceLimit.reset,
          },
          instanceLimit.reset,
        );
      }
    }

    // Check per-actor limit
    if (actorId) {
      const actorLimit = await checkRateLimit(env, actorId, RATE_LIMITS.INBOX_PER_ACTOR);
      c.header("X-RateLimit-Limit", actorLimit.limit.toString());
      c.header("X-RateLimit-Remaining", actorLimit.remaining.toString());
      c.header("X-RateLimit-Reset", actorLimit.reset.toString());

      if (!actorLimit.allowed) {
        console.warn(`Rate limit exceeded for actor: ${actorId}`);
        return buildRateLimitExceededResponse(
          c,
          "Rate limit exceeded",
          {
            namespace: RATE_LIMITS.INBOX_PER_ACTOR.namespace,
            key: actorId,
            limit: actorLimit.limit,
            remaining: actorLimit.remaining,
            reset: actorLimit.reset,
          },
          actorLimit.reset,
        );
      }
    }

    await next();
  };
}

/**
 * Generic rate limit middleware factory
 */
export function rateLimitMiddleware(config: RateLimitConfig, keyExtractor: (c: Context) => string | null) {
  return async (c: Context, next: () => Promise<void>) => {
    const env = c.env as { DB: D1Database };
    const key = keyExtractor(c);

    if (!key) {
      // No key to rate limit on, allow request
      await next();
      return;
    }

    const result = await checkRateLimit(env, key, config);

    // Add rate limit headers
    c.header("X-RateLimit-Limit", result.limit.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.reset.toString());

    if (!result.allowed) {
      console.warn(`Rate limit exceeded for ${config.namespace}:${key}`);
      return buildRateLimitExceededResponse(
        c,
        "Rate limit exceeded",
        {
          namespace: config.namespace,
          key,
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
        },
        result.reset,
      );
    }

    await next();
  };
}

/**
 * Extract IP address from request
 */
export function extractIP(c: Context): string | null {
  // Cloudflare provides CF-Connecting-IP
  const cfIP = c.req.header("CF-Connecting-IP");
  if (cfIP) return cfIP;

  // Fallback to X-Forwarded-For
  const forwarded = c.req.header("X-Forwarded-For");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return null;
}

/**
 * WebFinger rate limit middleware
 */
export function webfingerRateLimitMiddleware() {
  return rateLimitMiddleware(RATE_LIMITS.WEBFINGER_PER_IP, extractIP);
}
