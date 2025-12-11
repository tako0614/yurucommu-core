/**
 * App API Route Handler
 *
 * PLAN.md 17-app-sdk-implementation.md Phase 5: Backend 統合
 *
 * /-/apps/:appId/api/* ルートで App Handler を実行する
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { PublicAccountBindings as Bindings, Variables, TakosConfig } from "@takos/platform/server";
import {
  createPostService,
  createUserService,
  createStorageService,
  createActorService,
} from "@takos/platform/app/services/factories";
import { createMediaService } from "@takos/platform/app/services/media-service";
import { deliverActivity, signAndSendActivity } from "@takos/platform/activitypub/delivery";
import { getOrFetchActor, fetchRemoteObject } from "@takos/platform/activitypub/actor-fetch";
import {
  buildAiProviderRegistry,
  chatCompletion,
  embed,
} from "@takos/platform/server";

// Handler types from App SDK
type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

interface HandlerMetadata {
  id: string;
  method: HttpMethod;
  path: string;
  auth: boolean;
}

interface HandlerContext {
  auth: {
    userId: string;
    handle: string;
  };
  params: Record<string, string>;
  query: Record<string, string>;
  core: {
    posts: {
      list: (params?: Record<string, unknown>) => Promise<unknown[]>;
      get: (id: string) => Promise<unknown>;
      create: (data: Record<string, unknown>) => Promise<unknown>;
      delete: (id: string) => Promise<void>;
    };
    users: {
      get: (id: string) => Promise<unknown>;
      follow: (id: string) => Promise<void>;
      unfollow: (id: string) => Promise<void>;
    };
    activitypub: {
      send: (activity: Record<string, unknown>) => Promise<void>;
      resolve: (uri: string) => Promise<unknown>;
    };
    storage: {
      upload: (file: Blob, options?: Record<string, unknown>) => Promise<unknown>;
      get: (key: string) => Promise<Blob | null>;
      delete: (key: string) => Promise<void>;
    };
    ai: {
      complete: (prompt: string, options?: Record<string, unknown>) => Promise<string>;
      embed: (text: string, options?: Record<string, unknown>) => Promise<number[]>;
    };
  };
  storage: {
    get: <T>(key: string) => Promise<T | null>;
    set: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    list: (prefix: string) => Promise<string[]>;
  };
  json: <T>(data: T, options?: { status?: number }) => Response;
  error: (message: string, status?: number) => Response;
}

interface Handler<TInput = unknown, TOutput = unknown> {
  __takosHandler: true;
  metadata: HandlerMetadata;
  handler: (ctx: HandlerContext, input: TInput) => Promise<TOutput>;
}

/**
 * App Handler Registry - loaded handlers are cached here
 */
const handlerRegistry = new Map<string, Map<string, Handler>>();

/**
 * Load handlers for an app from the app's handlers module
 */
/**
 * Built-in handlers registry
 * App handlers should be registered here during build time
 */
const builtInHandlers: Record<string, Handler[]> = {};

/**
 * Register handlers for an app (called during initialization)
 */
export function registerAppHandlers(appId: string, handlers: Handler[]): void {
  builtInHandlers[appId] = handlers;
}

// ============================================================================
// Sample Counter App Registration
// ============================================================================
import * as sampleCounterHandlers from "../../../app/sample-counter/handlers";

/**
 * Wrap an AppHandler to app-api Handler format
 */
function wrapAppHandler(
  id: string,
  method: HttpMethod,
  path: string,
  auth: boolean,
  appHandler: (ctx: any, input?: unknown) => unknown | Promise<unknown>
): Handler {
  return {
    __takosHandler: true,
    metadata: { id: `${method}:${path}`, method, path, auth },
    handler: async (ctx: HandlerContext, input: unknown) => {
      // Adapt HandlerContext to TakosContext-like interface
      const takosCtx = {
        auth: ctx.auth.userId ? { userId: ctx.auth.userId, handle: ctx.auth.handle } : null,
        params: ctx.params,
        query: ctx.query,
        json: ctx.json,
        error: ctx.error,
        log: (level: string, message: string, data?: Record<string, unknown>) => {
          console.log(`[${level}] ${message}`, data ?? "");
        },
        services: {
          storage: ctx.storage,
        },
      };
      return appHandler(takosCtx, input);
    },
  };
}

// Register sample-counter handlers
registerAppHandlers("sample-counter", [
  wrapAppHandler("getCounter", "GET", "/counter", true, sampleCounterHandlers.getCounter),
  wrapAppHandler("incrementCounter", "POST", "/counter/increment", true, sampleCounterHandlers.incrementCounter),
  wrapAppHandler("decrementCounter", "POST", "/counter/decrement", true, sampleCounterHandlers.decrementCounter),
  wrapAppHandler("resetCounter", "POST", "/counter/reset", true, sampleCounterHandlers.resetCounter),
  wrapAppHandler("setCounter", "POST", "/counter/set", true, sampleCounterHandlers.setCounter),
  wrapAppHandler("getAppInfo", "GET", "/info", false, sampleCounterHandlers.getAppInfo),
]);

async function loadAppHandlers(
  appId: string,
  _env: Bindings
): Promise<Map<string, Handler>> {
  const cached = handlerRegistry.get(appId);
  if (cached) {
    return cached;
  }

  const registry = new Map<string, Handler>();

  // Load built-in handlers for this app
  const handlers = builtInHandlers[appId] || builtInHandlers["default"] || [];
  for (const handler of handlers) {
    registry.set(handler.metadata.id, handler);
  }

  handlerRegistry.set(appId, registry);
  return registry;
}

/**
 * Type guard for Handler objects
 */
function isHandler(value: unknown): value is Handler {
  return (
    typeof value === "object" &&
    value !== null &&
    "__takosHandler" in value &&
    (value as Handler).__takosHandler === true
  );
}

/**
 * Find a handler by method and path
 */
function findHandler(
  registry: Map<string, Handler>,
  method: HttpMethod,
  path: string
): Handler | undefined {
  // Normalize path
  let normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (normalizedPath.length > 1 && normalizedPath.endsWith("/")) {
    normalizedPath = normalizedPath.slice(0, -1);
  }

  const id = `${method}:${normalizedPath}`;
  return registry.get(id);
}

/**
 * Build HandlerContext from Hono context
 */
function buildHandlerContext(
  c: any,
  env: Bindings,
  appId: string
): HandlerContext {
  const userId = c.get("userId") || null;
  const handle = c.get("handle") || c.get("userHandle") || "";

  // Build core services
  const postService = createPostService(env);
  const actorService = createActorService(env);
  const storageService = createStorageService(env);

  // Auth context for core services
  const authCtx = {
    userId,
    sessionId: c.get("sessionId") || null,
    isAuthenticated: !!userId,
    plan: { id: "default", name: "default", limits: {}, features: [] },
    limits: {},
  };

  return {
    auth: {
      userId: userId || "",
      handle: handle,
    },
    params: c.req.param() || {},
    query: Object.fromEntries(new URL(c.req.url).searchParams),

    // Core services wrapper
    core: {
      posts: {
        list: async (params?: Record<string, unknown>) =>
          postService.listTimeline(authCtx as any, params as any).then((r) => r.posts),
        get: async (id: string) => postService.getPost(authCtx as any, id),
        create: async (data: Record<string, unknown>) =>
          postService.createPost(authCtx as any, data as any),
        delete: async (id: string) => postService.deletePost(authCtx as any, id),
      },
      users: {
        get: async (id: string) => actorService.get(authCtx as any, id),
        follow: async (id: string) => actorService.follow(authCtx as any, id),
        unfollow: async (id: string) => actorService.unfollow(authCtx as any, id),
      },
      activitypub: {
        send: async (activity: Record<string, unknown>) => {
          // Deliver ActivityPub activity to recipients
          await deliverActivity(env, activity);
        },
        resolve: async (uri: string) => {
          // Resolve a remote ActivityPub object or actor
          // Try as actor first, then as object
          const actor = await getOrFetchActor(uri, env as any);
          if (actor) return actor as unknown as Record<string, unknown>;
          const obj = await fetchRemoteObject(uri);
          return obj ?? {};
        },
      },
      storage: {
        upload: async (file: Blob, options?: Record<string, unknown>) => {
          // Use MediaService for file upload
          const mediaService = createMediaService(env, storageService);
          const result = await mediaService.upload(authCtx as any, {
            file,
            filename: (options?.filename as string) ?? "upload",
            contentType: (options?.contentType as string) ?? file.type,
            folder: options?.folder as string | undefined,
            status: (options?.status as any) ?? "temp",
            attachedTo: options?.attachedTo as string | undefined,
            attachedType: options?.attachedType as string | undefined,
            alt: options?.alt as string | undefined,
            description: options?.description as string | undefined,
          });
          return result;
        },
        get: async (key: string) => {
          if (env.MEDIA?.get) {
            const obj = await env.MEDIA.get(key);
            return obj ? await obj.blob() : null;
          }
          return null;
        },
        delete: async (key: string) => {
          if (env.MEDIA?.delete) {
            await env.MEDIA.delete(key);
          }
        },
      },
      ai: {
        complete: async (prompt: string, options?: Record<string, unknown>) => {
          // Use AI provider registry for chat completion
          const takosConfig = (c.get("takosConfig") as TakosConfig | undefined) ??
            (env as any).takosConfig;
          const aiConfig = takosConfig?.ai;

          if (!aiConfig || aiConfig.enabled === false) {
            console.warn("AI is disabled for this node");
            return "";
          }

          try {
            const registry = buildAiProviderRegistry(aiConfig, env as any);
            const provider = registry.get(options?.provider as string | undefined);
            if (!provider) {
              console.warn("No AI provider configured");
              return "";
            }

            const model = (options?.model as string) ?? provider.model;
            if (!model) {
              console.warn("No model specified for AI completion");
              return "";
            }

            const result = await chatCompletion(provider, [
              { role: "user", content: prompt },
            ], {
              model,
              temperature: options?.temperature as number | undefined,
              maxTokens: options?.maxTokens as number | undefined,
            });

            return result.choices[0]?.message?.content ?? "";
          } catch (error) {
            console.error("AI completion error:", error);
            return "";
          }
        },
        embed: async (text: string, options?: Record<string, unknown>) => {
          // Use AI provider registry for embedding
          const takosConfig = (c.get("takosConfig") as TakosConfig | undefined) ??
            (env as any).takosConfig;
          const aiConfig = takosConfig?.ai;

          if (!aiConfig || aiConfig.enabled === false) {
            console.warn("AI is disabled for this node");
            return [];
          }

          try {
            const registry = buildAiProviderRegistry(aiConfig, env as any);
            const provider = registry.get(options?.provider as string | undefined);
            if (!provider) {
              console.warn("No AI provider configured for embedding");
              return [];
            }

            const result = await embed(provider, text, {
              model: options?.model as string | undefined,
              dimensions: options?.dimensions as number | undefined,
            });

            // Return the first embedding vector
            return result.embeddings[0]?.embedding ?? [];
          } catch (error) {
            console.error("AI embedding error:", error);
            return [];
          }
        },
      },
    },

    // App-scoped KV storage
    storage: createAppStorage(env, appId, userId),

    // Response helpers
    json: <T>(data: T, options?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: options?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    error: (message: string, status?: number) =>
      new Response(JSON.stringify({ error: message }), {
        status: status ?? 400,
        headers: { "Content-Type": "application/json" },
      }),
  };
}

/**
 * Create app-scoped KV storage interface
 */
function createAppStorage(
  env: Bindings,
  appId: string,
  userId: string | null
) {
  // Storage key format: app:{appId}:user:{userId}:{key}
  // This provides per-app, per-user isolation
  const buildKey = (key: string): string => {
    const userPart = userId || "_anonymous";
    return `app:${appId}:user:${userPart}:${key}`;
  };

  const kv = (env as any).APP_STATE || env.KV;

  return {
    get: async <T>(key: string): Promise<T | null> => {
      if (!kv) {
        console.warn("APP_STATE KV binding not available");
        return null;
      }
      const fullKey = buildKey(key);
      const value = await kv.get(fullKey, "json");
      return value as T | null;
    },

    set: async (key: string, value: unknown): Promise<void> => {
      if (!kv) {
        console.warn("APP_STATE KV binding not available");
        return;
      }
      const fullKey = buildKey(key);
      await kv.put(fullKey, JSON.stringify(value));
    },

    delete: async (key: string): Promise<void> => {
      if (!kv) {
        console.warn("APP_STATE KV binding not available");
        return;
      }
      const fullKey = buildKey(key);
      await kv.delete(fullKey);
    },

    list: async (prefix: string): Promise<string[]> => {
      if (!kv) {
        console.warn("APP_STATE KV binding not available");
        return [];
      }
      const fullPrefix = buildKey(prefix);
      const result = await kv.list({ prefix: fullPrefix });
      // Strip the app/user prefix from returned keys
      const prefixLen = buildKey("").length;
      return result.keys.map((k: { name: string }) => k.name.slice(prefixLen));
    },
  };
}

/**
 * Verify authentication if handler requires it
 */
function checkAuth(c: any, handler: Handler): void {
  if (handler.metadata.auth) {
    const userId = c.get("userId");
    if (!userId) {
      throw new HTTPException(401, { message: "Authentication required" });
    }
  }
}

/**
 * Parse request body based on content type
 */
async function parseRequestBody(c: any): Promise<unknown> {
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("application/json")) {
    try {
      return await c.req.json();
    } catch {
      return {};
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await c.req.formData();
    const obj: Record<string, unknown> = {};
    formData.forEach((value: File | string, key: string) => {
      obj[key] = value;
    });
    return obj;
  }

  return {};
}

// Create the router
type AppApiBindings = { Bindings: Bindings; Variables: Variables };
const appApiRouter = new Hono<AppApiBindings>();

/**
 * GET /-/apps/:appId/manifest.json
 *
 * Returns the app manifest for the specified app.
 * This endpoint is used by app-loader.ts to load app metadata.
 */
appApiRouter.get("/:appId/manifest.json", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  // For now, return a placeholder manifest based on built-in handlers
  // In production, this would load from app storage (R2/VFS)
  const handlers = builtInHandlers[appId] || builtInHandlers["default"] || [];

  // Try to load manifest from R2/VFS storage if available
  const bucket = (env as any)?.APP_MANIFESTS ??
                 (env as any)?.VFS_BUCKET ??
                 (env as any)?.WORKSPACE_VFS ??
                 (env as any)?.MEDIA ??
                 null;

  if (bucket) {
    const manifestKey = `apps/${appId}/manifest.json`;
    try {
      const obj = await bucket.get(manifestKey);
      if (obj) {
        const text = await obj.text();
        const manifest = JSON.parse(text);
        return c.json(manifest);
      }
    } catch (error) {
      console.warn(`[app-api] Failed to load manifest from storage for ${appId}:`, error);
    }
  }

  // Fallback to generated manifest from registered handlers
  const manifest = {
    id: appId,
    name: appId,
    version: "1.0.0",
    description: `App ${appId}`,
    permissions: [],
    handlers: handlers.map((h) => ({
      id: h.metadata.id,
      method: h.metadata.method,
      path: h.metadata.path,
      auth: h.metadata.auth,
    })),
  };

  return c.json(manifest);
});

/**
 * GET /-/apps/:appId/dist/*
 *
 * Serves app build artifacts (client.bundle.js, etc.)
 * This endpoint is used by app-loader.ts to dynamically import app modules.
 */
appApiRouter.get("/:appId/dist/*", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  // Extract the file path (everything after /dist/)
  const fullPath = c.req.path;
  const distPathMatch = fullPath.match(/\/dist(\/.*)?$/);
  const distPath = distPathMatch?.[1]?.slice(1) || ""; // Remove leading slash

  if (!distPath) {
    return c.json({ error: "File path required" }, 400);
  }

  // Try to load from R2/VFS storage
  const bucket = (env as any)?.APP_MANIFESTS ??
                 (env as any)?.VFS_BUCKET ??
                 (env as any)?.WORKSPACE_VFS ??
                 (env as any)?.MEDIA ??
                 null;

  if (!bucket) {
    return c.json({ error: "App storage not configured" }, 500);
  }

  const fileKey = `apps/${appId}/dist/${distPath}`;

  try {
    const obj = await bucket.get(fileKey);
    if (!obj) {
      return c.json({ error: "File not found", path: distPath }, 404);
    }

    // Determine content type based on file extension
    const ext = distPath.split(".").pop()?.toLowerCase() || "";
    const contentTypes: Record<string, string> = {
      js: "application/javascript",
      mjs: "application/javascript",
      css: "text/css",
      json: "application/json",
      html: "text/html",
      map: "application/json",
    };
    const contentType = contentTypes[ext] || "application/octet-stream";

    // Set appropriate headers
    const headers = new Headers();
    headers.set("Content-Type", contentType);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(obj.body, { headers });
  } catch (error) {
    console.error(`[app-api] Failed to serve dist file for ${appId}/${distPath}:`, error);
    return c.json({ error: "Failed to load file" }, 500);
  }
});

// Main handler for all app API routes
appApiRouter.all("/:appId/api/*", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  // Extract the API path (everything after /api/)
  const fullPath = c.req.path;
  const apiPathMatch = fullPath.match(/\/api(\/.*)?$/);
  const apiPath = apiPathMatch?.[1] || "/";

  // Get HTTP method
  const method = c.req.method.toUpperCase() as HttpMethod;

  // Load handlers for this app
  const handlers = await loadAppHandlers(appId, env);

  // Find matching handler
  const handler = findHandler(handlers, method, apiPath);

  if (!handler) {
    return c.json(
      {
        error: "Handler not found",
        path: apiPath,
        method,
        availableHandlers: Array.from(handlers.keys()),
      },
      404
    );
  }

  // Check authentication
  checkAuth(c, handler);

  // Build handler context
  const ctx = buildHandlerContext(c, env, appId);

  // Parse request body for POST/PUT/DELETE
  let input: unknown = {};
  if (["POST", "PUT", "DELETE"].includes(method)) {
    input = await parseRequestBody(c);
  }

  try {
    // Execute handler
    const result = await handler.handler(ctx, input);

    // If result is already a Response, return it directly
    if (result instanceof Response) {
      return result;
    }

    // Otherwise wrap in JSON response
    return c.json(result);
  } catch (error) {
    console.error(`Handler error for ${method} ${apiPath}:`, error);

    if (error instanceof HTTPException) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "Internal server error";
    return c.json({ error: message }, 500);
  }
});

// Handler metadata endpoint - lists available handlers for an app
appApiRouter.get("/:appId/handlers", async (c) => {
  const appId = c.req.param("appId");
  const handlers = await loadAppHandlers(appId, c.env);

  const metadata = Array.from(handlers.values()).map((h) => h.metadata);

  return c.json({
    appId,
    handlers: metadata,
  });
});

export { appApiRouter };
