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

import type { Context, MiddlewareHandler, Next } from 'hono';
import type { Env, Variables } from '../types';

// Cloudflare Workers Cache API extension
declare global {
  interface CacheStorage {
    default: Cache;
  }
}

// ============================================================================
// Types
// ============================================================================

export interface CacheConfig {
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
  cacheKeyGenerator?: (c: Context<{ Bindings: Env; Variables: Variables }>) => string;
}

// Predefined TTL configurations
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
  /** Static content like well-known (1 hour) */
  STATIC: 3600,
  /** Search results (1 minute) */
  SEARCH: 60,
} as const;

// Cache tags for grouping
export const CacheTags = {
  TIMELINE: 'timeline',
  ACTOR: 'actor',
  COMMUNITY: 'community',
  POST: 'post',
  WEBFINGER: 'webfinger',
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

    // Check if expired
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
    // Remove oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, entry);
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  deleteByTag(tag: string): number {
    let deleted = 0;
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (entry.tag === tag) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
  }

  // Cleanup expired entries
  cleanup(): void {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
}

// Singleton cache instance for in-memory caching
const memoryCache = new LRUCache(1000);

// Periodic cleanup (every 5 minutes)
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
// Cache Key Generation
// ============================================================================

function generateCacheKey(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  config: CacheConfig
): string {
  // Use custom generator if provided
  if (config.cacheKeyGenerator) {
    return config.cacheKeyGenerator(c);
  }

  const url = new URL(c.req.url);
  let cacheKey = url.pathname;

  // Include query params if configured
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

  // Vary by actor if configured
  if (config.varyByActor) {
    const actor = c.get('actor');
    if (actor) {
      cacheKey += `#actor:${actor.ap_id}`;
    } else {
      cacheKey += '#actor:anonymous';
    }
  }

  return cacheKey;
}

async function generateETag(body: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `"${hashHex.substring(0, 16)}"`;
}

// ============================================================================
// Runtime Detection
// ============================================================================

function isCloudflareWorkers(): boolean {
  // Check for caches.default which is Cloudflare-specific
  return typeof caches !== 'undefined' && 'default' in caches;
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
export function withCache(
  config: CacheConfig
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    // Only cache GET requests
    if (c.req.method !== 'GET') {
      await next();
      return;
    }

    // Skip caching for authenticated requests if not varying by actor
    if (!config.varyByActor) {
      const actor = c.get('actor');
      if (actor) {
        await next();
        return;
      }
    }

    const cacheKey = generateCacheKey(c, config);

    if (isCloudflareWorkers()) {
      return handleCloudflareCache(c, next, cacheKey, config);
    } else {
      return handleMemoryCache(c, next, cacheKey, config);
    }
  };
}

/**
 * Handle caching using Cloudflare Cache API
 */
async function handleCloudflareCache(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
  cacheKey: string,
  config: CacheConfig
): Promise<Response | void> {
  const cache = caches.default;
  const url = new URL(c.req.url);
  const fullCacheKey = new Request(`${url.origin}/_cache${cacheKey}`);

  // Try to get from cache
  const cachedResponse = await cache.match(fullCacheKey);

  if (cachedResponse) {
    // Handle conditional requests
    const ifNoneMatch = c.req.header('If-None-Match');
    const etag = cachedResponse.headers.get('ETag');
    if (ifNoneMatch && etag && ifNoneMatch === etag) {
      return c.body(null, 304);
    }

    const ifModifiedSince = c.req.header('If-Modified-Since');
    const lastModified = cachedResponse.headers.get('Last-Modified');
    if (ifModifiedSince && lastModified) {
      const ifModifiedDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(lastModified);
      if (ifModifiedDate >= lastModifiedDate) {
        return c.body(null, 304);
      }
    }

    // Return cached response with X-Cache header
    const headers = new Headers(cachedResponse.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers,
    });
  }

  // Execute handler
  await next();

  // Only cache successful responses
  if (c.res.status !== 200) {
    return;
  }

  // Prepare cached response
  const responseBody = await c.res.text();
  const etag = await generateETag(responseBody);
  const now = new Date();

  let cacheControl = `public, max-age=${config.ttl}`;
  if (config.staleWhileRevalidate) {
    cacheControl += `, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }

  const headers = new Headers(c.res.headers);
  headers.set('Cache-Control', cacheControl);
  headers.set('ETag', etag);
  headers.set('Last-Modified', now.toUTCString());
  headers.set('X-Cache', 'MISS');
  if (config.cacheTag) {
    headers.set('Cache-Tag', config.cacheTag);
  }

  const responseToCache = new Response(responseBody, {
    status: 200,
    headers,
  });

  // Store in cache with error handling
  const ctx = c.executionCtx;
  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(
      cache.put(fullCacheKey, responseToCache.clone()).catch(err => {
        console.error('Failed to store response in cache:', err);
      })
    );
  }

  c.res = responseToCache;
}

/**
 * Handle caching using in-memory LRU cache
 */
async function handleMemoryCache(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
  cacheKey: string,
  config: CacheConfig
): Promise<Response | void> {
  maybeCleanup();

  // Try to get from cache
  const cached = memoryCache.get(cacheKey);

  if (cached) {
    // Handle conditional requests
    const ifNoneMatch = c.req.header('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      return c.body(null, 304);
    }

    const ifModifiedSince = c.req.header('If-Modified-Since');
    if (ifModifiedSince) {
      const ifModifiedDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(cached.lastModified);
      if (ifModifiedDate >= lastModifiedDate) {
        return c.body(null, 304);
      }
    }

    // Return cached response
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, {
      status: cached.status,
      headers,
    });
  }

  // Execute handler
  await next();

  // Only cache successful responses
  if (c.res.status !== 200) {
    return;
  }

  // Prepare cached entry
  const responseBody = await c.res.text();
  const etag = await generateETag(responseBody);
  const now = new Date();

  let cacheControl = `public, max-age=${config.ttl}`;
  if (config.staleWhileRevalidate) {
    cacheControl += `, stale-while-revalidate=${config.staleWhileRevalidate}`;
  }

  const headers = new Headers(c.res.headers);
  headers.set('Cache-Control', cacheControl);
  headers.set('ETag', etag);
  headers.set('Last-Modified', now.toUTCString());
  headers.set('X-Cache', 'MISS');
  if (config.cacheTag) {
    headers.set('Cache-Tag', config.cacheTag);
  }

  // Store in memory cache
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
    lastModified: now.toUTCString(),
    tag: config.cacheTag,
  });

  c.res = new Response(responseBody, {
    status: 200,
    headers,
  });
}

// ============================================================================
// Cache Invalidation
// ============================================================================

/**
 * Invalidate cache entries by key pattern
 */
export async function invalidateCache(patterns: string[]): Promise<void> {
  if (isCloudflareWorkers()) {
    const cache = caches.default;
    await Promise.all(
      patterns.map(pattern => {
        // For Cloudflare, we need the full URL
        // This requires knowing the origin, which we may not have here
        // In practice, call this from middleware where you have access to c.req.url
        return cache.delete(new Request(pattern));
      })
    );
  } else {
    // For memory cache, delete by exact key
    for (const pattern of patterns) {
      memoryCache.delete(pattern);
    }
  }
}

/**
 * Invalidate all cache entries with a specific tag
 */
export function invalidateCacheByTag(tag: string): number {
  if (!isCloudflareWorkers()) {
    return memoryCache.deleteByTag(tag);
  }
  // Cloudflare Cache API doesn't support tag-based purging in Workers
  // Would need to use Cloudflare API for that
  return 0;
}

/**
 * Middleware to invalidate cache on mutations
 *
 * @example
 * posts.post('/', invalidateCacheOnMutation([CacheTags.TIMELINE, CacheTags.ACTOR]), handler);
 */
export function invalidateCacheOnMutation(
  tags: string[]
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    await next();

    // Only invalidate on successful mutations
    if (c.res.status >= 200 && c.res.status < 300) {
      for (const tag of tags) {
        invalidateCacheByTag(tag);
      }
    }
  };
}

// ============================================================================
// Cache Headers Middleware (CDN/Browser caching only)
// ============================================================================

/**
 * Add cache headers without storing in cache
 * Useful for CDN or browser caching
 */
export function withCacheHeaders(
  config: CacheConfig
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    await next();

    if (c.req.method !== 'GET' || c.res.status !== 200) {
      return;
    }

    let cacheControl = `public, max-age=${config.ttl}`;
    if (config.staleWhileRevalidate) {
      cacheControl += `, stale-while-revalidate=${config.staleWhileRevalidate}`;
    }

    const body = await c.res.text();
    const etag = await generateETag(body);

    const headers = new Headers(c.res.headers);
    headers.set('Cache-Control', cacheControl);
    headers.set('ETag', etag);
    headers.set('Last-Modified', new Date().toUTCString());

    c.res = new Response(body, {
      status: c.res.status,
      headers,
    });
  };
}

/**
 * No-cache middleware
 */
export const noCache: MiddlewareHandler<{ Bindings: Env; Variables: Variables }> = async (c, next) => {
  await next();

  const headers = new Headers(c.res.headers);
  headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');

  const body = await c.res.text();
  c.res = new Response(body, {
    status: c.res.status,
    headers,
  });
};

/**
 * Clear all in-memory cache (useful for testing)
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
}
