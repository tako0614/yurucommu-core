// Server-facing exports
export * from "../types";

import type { Handler, HandlerConfig, HandlerContext, HandlerMetadata, HttpMethod } from "../types";

/**
 * Generates a unique handler ID from method and path.
 * Format: "method:path" (e.g., "GET:/stats", "POST:/items")
 */
function generateHandlerId(method: HttpMethod, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${method}:${normalizedPath}`;
}

/**
 * Normalizes a path to ensure consistent format.
 * - Ensures leading slash
 * - Removes trailing slash (except for root "/")
 */
function normalizePath(path: string): string {
  let normalized = path.startsWith("/") ? path : `/${path}`;
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

/**
 * Defines a type-safe server-side handler for App API endpoints.
 *
 * @example
 * ```typescript
 * import { defineHandler } from '@takos/app-sdk/server';
 *
 * export const getStats = defineHandler({
 *   method: 'GET',
 *   path: '/stats',
 *   auth: true,
 *   handler: async (ctx) => {
 *     const posts = await ctx.core.posts.list({ authorId: ctx.auth.userId });
 *     return ctx.json({ totalPosts: posts.length });
 *   },
 * });
 *
 * export const createItem = defineHandler({
 *   method: 'POST',
 *   path: '/items',
 *   auth: true,
 *   handler: async (ctx, input: { name: string }) => {
 *     await ctx.storage.set(`item:${Date.now()}`, input);
 *     return ctx.json({ success: true });
 *   },
 * });
 * ```
 */
export function defineHandler<TInput = unknown, TOutput = unknown>(
  config: HandlerConfig<TInput, TOutput>
): Handler<TInput, TOutput> {
  const normalizedPath = normalizePath(config.path);

  const metadata: HandlerMetadata = {
    id: generateHandlerId(config.method, normalizedPath),
    method: config.method,
    path: normalizedPath,
    auth: config.auth ?? true
  };

  return {
    __takosHandler: true,
    metadata,
    handler: config.handler
  };
}

/**
 * Type guard to check if an object is a Handler.
 */
export function isHandler(value: unknown): value is Handler {
  return (
    typeof value === "object" &&
    value !== null &&
    "__takosHandler" in value &&
    (value as Handler).__takosHandler === true
  );
}

/**
 * Extracts handlers from a module's exports.
 * Useful for collecting all handlers defined in a file.
 *
 * @example
 * ```typescript
 * import * as handlers from './handlers/stats';
 * const allHandlers = extractHandlers(handlers);
 * ```
 */
export function extractHandlers(moduleExports: Record<string, unknown>): Handler[] {
  return Object.values(moduleExports).filter(isHandler);
}

/**
 * Creates a handler registry from multiple handler modules.
 * The registry maps handler IDs to their definitions for fast lookup.
 *
 * @example
 * ```typescript
 * import * as statsHandlers from './handlers/stats';
 * import * as itemsHandlers from './handlers/items';
 *
 * const registry = createHandlerRegistry([
 *   ...extractHandlers(statsHandlers),
 *   ...extractHandlers(itemsHandlers),
 * ]);
 * ```
 */
export function createHandlerRegistry(
  handlers: Handler[]
): Map<string, Handler> {
  const registry = new Map<string, Handler>();

  for (const handler of handlers) {
    const key = handler.metadata.id;
    if (registry.has(key)) {
      console.warn(`Duplicate handler ID: ${key}. Later definition will be used.`);
    }
    registry.set(key, handler);
  }

  return registry;
}

/**
 * Finds a handler by HTTP method and path.
 *
 * @example
 * ```typescript
 * const handler = findHandler(registry, 'GET', '/stats');
 * if (handler) {
 *   const result = await handler.handler(ctx, input);
 * }
 * ```
 */
export function findHandler(
  registry: Map<string, Handler>,
  method: HttpMethod,
  path: string
): Handler | undefined {
  const normalizedPath = normalizePath(path);
  const id = generateHandlerId(method, normalizedPath);
  return registry.get(id);
}

/**
 * Extracts metadata from all handlers for manifest generation.
 *
 * @example
 * ```typescript
 * const metadata = extractHandlerMetadata(handlers);
 * // Returns array of { id, method, path, auth } for each handler
 * ```
 */
export function extractHandlerMetadata(handlers: Handler[]): HandlerMetadata[] {
  return handlers.map((h) => h.metadata);
}

/**
 * Creates a stub HandlerContext for testing purposes.
 * All methods return empty/default values.
 */
export function createStubHandlerContext(
  overrides?: Partial<HandlerContext>
): HandlerContext {
  const defaultContext: HandlerContext = {
    auth: {
      userId: "test-user",
      handle: "test@example.com"
    },
    params: {},
    query: {},
    core: {
      posts: {
        list: async () => [],
        get: async () => ({}),
        create: async () => ({}),
        delete: async () => {}
      },
      users: {
        get: async () => ({}),
        follow: async () => {},
        unfollow: async () => {}
      },
      timeline: {
        home: async () => ({})
      },
      notifications: {
        list: async () => ({}),
        markRead: async () => {}
      },
      activitypub: {
        send: async () => {},
        resolve: async () => ({})
      },
      storage: {
        upload: async () => ({}),
        get: async () => null,
        delete: async () => {}
      },
      ai: {
        complete: async () => "",
        embed: async () => []
      }
    },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      list: async () => []
    },
    json: <T>(data: T, options?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: options?.status ?? 200,
        headers: { "Content-Type": "application/json" }
      }),
    error: (message: string, status?: number) =>
      new Response(JSON.stringify({ error: message }), {
        status: status ?? 400,
        headers: { "Content-Type": "application/json" }
      })
  };

  return { ...defaultContext, ...overrides };
}
