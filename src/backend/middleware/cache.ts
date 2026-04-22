/**
 * Caching Middleware for Yurucommu Backend
 *
 * Supports multiple runtimes:
 * - Cloudflare Workers: Uses Cache API
 * - Node.js/Bun/Deno: Uses in-memory LRU cache
 *
 * Features:
 * - TTL-based caching
 * - ETag and Last-Modified headers
 * - Conditional requests
 * - Cache invalidation
 */

import type { Context, MiddlewareHandler, Next } from "hono";
import type { Env, Variables } from "../types.ts";

declare global {
  interface CacheStorage {
    default: Cache;
  }
}

// ============================================================================
// Types
// ============================================================================

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;
type HonoMiddleware = MiddlewareHandler<
  { Bindings: Env; Variables: Variables }
>;

interface CacheConfig {
  /** Time-to-live in seconds */
  ttl: number;
  /** Whether to include query params in cache key (default: true) */
  includeQueryParams?: boolean;
  /** Specific query params to include (if not specified, all are included) */
  queryParamsToInclude?: string[];
  /** Cache tag for invalidation grouping */
  cacheTag?: string;
  /** Whether to add stale-while-revalidate (default: false) */
  staleWhileRevalidate?: number;
  /** Whether to vary cache by authenticated actor */
  varyByActor?: boolean;
  /** Custom cache key generator */
  cacheKeyGenerator?: (c: HonoContext) => string;
}

export const CacheTTL = {
  /** Public timeline (2 minutes) - frequently updated */
  PUBLIC_TIMELINE: 120,
  /** Actor profile data (5 minutes) */
  ACTOR_PROFILE: 300,
  /** ActivityPub actor JSON (10 minutes) */
  ACTIVITYPUB_ACTOR: 600,
  /** WebFinger response (1 hour) */
  WEBFINGER: 3600,
  /** Community info (5 minutes) */
  COMMUNITY: 300,
  /** Search results (1 minute) */
  SEARCH: 60,
} as const;

export const CacheTags = {
  TIMELINE: "timeline",
  ACTOR: "actor",
  COMMUNITY: "community",
  WEBFINGER: "webfinger",
} as const;

// ============================================================================
// In-Memory LRU Cache (for non-Cloudflare runtimes)
// ============================================================================

interface CacheEntry {
  body: string;
  headers: Record<string, string>;
  status: number;
  expiresAt: number;
  etag: string;
  lastModified: string;
  tag?: string;
}

class LRUCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);

    return entry;
  }

  set(key: string, entry: CacheEntry): void {
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

const memoryCache = new LRUCache(1000);

const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function maybeCleanup(): void {
  const now = Date.now();
  if (now - lastCleanup >= CLEANUP_INTERVAL) {
    lastCleanup = now;
    memoryCache.cleanup();
  }
}

// ============================================================================
// Shared Helpers
// ============================================================================

function generateCacheKey(c: HonoContext, config: CacheConfig): string {
  if (config.cacheKeyGenerator) {
    return config.cacheKeyGenerator(c);
  }

  const url = new URL(c.req.url);
  let cacheKey = url.pathname;

  if (config.includeQueryParams !== false) {
    const params = new URLSearchParams();

    if (config.queryParamsToInclude) {
      for (const key of config.queryParamsToInclude) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          params.set(key, value);
        }
      }
    } else {
      const sortedKeys = Array.from(url.searchParams.keys()).sort();
      for (const key of sortedKeys) {
        params.set(key, url.searchParams.get(key)!);
      }
    }

    const queryString = params.toString();
    if (queryString) {
      cacheKey += `?${queryString}`;
    }
  }

  if (config.varyByActor) {
    const actor = c.get("actor");
    cacheKey += actor ? `#actor:${actor.ap_id}` : "#actor:anonymous";
  }

  return cacheKey;
}

async function generateETag(body: string): Promise<string> {
  const data = new TextEncoder().encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `"${hashHex.substring(0, 16)}"`;
}

function buildCacheControl(config: CacheConfig): string {
  let value = `public, max-age=${config.ttl}`;
  if (config.staleWhileRevalidate) {
    value += `, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }
  return value;
}

/**
 * Check If-None-Match and If-Modified-Since conditional request headers.
 * Returns true if the client's cached copy is still fresh (caller should respond 304).
 */
function isConditionalHit(
  c: HonoContext,
  etag: string | null,
  lastModified: string | null,
): boolean {
  const ifNoneMatch = c.req.header("If-None-Match");
  if (ifNoneMatch && etag && ifNoneMatch === etag) {
    return true;
  }

  const ifModifiedSince = c.req.header("If-Modified-Since");
  if (ifModifiedSince && lastModified) {
    if (new Date(ifModifiedSince) >= new Date(lastModified)) {
      return true;
    }
  }

  return false;
}

/**
 * Apply standard cache headers to a Headers object.
 * Mutates `headers` in place and returns it for chaining convenience.
 */
function applyCacheHeaders(
  headers: Headers,
  config: CacheConfig,
  etag: string,
  lastModified: string,
  cacheStatus: "HIT" | "MISS",
): Headers {
  headers.set("Cache-Control", buildCacheControl(config));
  headers.set("ETag", etag);
  headers.set("Last-Modified", lastModified);
  headers.set("X-Cache", cacheStatus);
  if (config.cacheTag) {
    headers.set("Cache-Tag", config.cacheTag);
  }
  return headers;
}

function isCloudflareWorkers(): boolean {
  return typeof caches !== "undefined" && "default" in caches;
}

// ============================================================================
// Caching Middleware
// ============================================================================

/**
 * Create a caching middleware
 *
 * @example
 * // Cache public timeline for 2 minutes
 * timeline.get('/', withCache({ ttl: CacheTTL.PUBLIC_TIMELINE }), handler);
 *
 * // Cache actor profile with tag for invalidation
 * actors.get('/:username', withCache({
 *   ttl: CacheTTL.ACTOR_PROFILE,
 *   cacheTag: CacheTags.ACTOR,
 * }), handler);
 */
export function withCache(config: CacheConfig): HonoMiddleware {
  return async (c, next) => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }

    if (!config.varyByActor && c.get("actor")) {
      await next();
      return;
    }

    const cacheKey = generateCacheKey(c, config);

    if (isCloudflareWorkers()) {
      return handleCloudflareCache(c, next, cacheKey, config);
    }
    return handleMemoryCache(c, next, cacheKey, config);
  };
}

async function handleCloudflareCache(
  c: HonoContext,
  next: Next,
  cacheKey: string,
  config: CacheConfig,
): Promise<Response | void> {
  const cache = caches.default;
  const url = new URL(c.req.url);
  const fullCacheKey = new Request(`${url.origin}/_cache${cacheKey}`);

  const cachedResponse = await cache.match(fullCacheKey);

  if (cachedResponse) {
    const etag = cachedResponse.headers.get("ETag");
    const lastModified = cachedResponse.headers.get("Last-Modified");

    if (isConditionalHit(c, etag, lastModified)) {
      return c.body(null, 304);
    }

    const headers = new Headers(cachedResponse.headers);
    headers.set("X-Cache", "HIT");
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers,
    });
  }

  await next();

  if (c.res.status !== 200) {
    return;
  }

  const responseBody = await c.res.text();
  const etag = await generateETag(responseBody);
  const lastModified = new Date().toUTCString();

  const headers = new Headers(c.res.headers);
  applyCacheHeaders(headers, config, etag, lastModified, "MISS");

  const responseToCache = new Response(responseBody, {
    status: 200,
    headers,
  });

  const ctx = c.executionCtx;
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(
      cache.put(fullCacheKey, responseToCache.clone()).catch((err) => {
        console.error("Failed to store response in cache:", err);
      }),
    );
  }

  c.res = responseToCache;
}

async function handleMemoryCache(
  c: HonoContext,
  next: Next,
  cacheKey: string,
  config: CacheConfig,
): Promise<Response | void> {
  maybeCleanup();

  const cached = memoryCache.get(cacheKey);

  if (cached) {
    if (isConditionalHit(c, cached.etag, cached.lastModified)) {
      return c.body(null, 304);
    }

    const headers = new Headers(cached.headers);
    headers.set("X-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      headers,
    });
  }

  await next();

  if (c.res.status !== 200) {
    return;
  }

  const responseBody = await c.res.text();
  const etag = await generateETag(responseBody);
  const lastModified = new Date().toUTCString();

  const headers = new Headers(c.res.headers);
  applyCacheHeaders(headers, config, etag, lastModified, "MISS");

  const headersObj: Record<string, string> = {};
  headers.forEach((value, key) => {
    headersObj[key] = value;
  });

  memoryCache.set(cacheKey, {
    body: responseBody,
    headers: headersObj,
    status: 200,
    expiresAt: Date.now() + config.ttl * 1000,
    etag,
    lastModified,
    tag: config.cacheTag,
  });

  c.res = new Response(responseBody, {
    status: 200,
    headers,
  });
}
