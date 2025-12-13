/**
 * App API Route Handler (Workers-style TakosApp loader)
 *
 * PLAN.md 17-app-sdk-implementation.md Phase 2: Core 側 App ローダー
 *
 * /-/apps/:appId/api/* ルートで TakosApp.fetch(request, env) を実行する
 */

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables, TakosConfig } from "@takos/platform/server";
import { HttpError } from "@takos/platform/server";
import { deliverActivity } from "@takos/platform/activitypub/delivery";
import { getOrFetchActor, fetchRemoteObject } from "@takos/platform/activitypub/actor-fetch";
import {
  buildAiProviderRegistry,
  chatCompletion,
  embed,
} from "@takos/platform/server";
import type { AppEnv, AppManifest, TakosApp, Activity, AiCompleteOptions, AiEmbedOptions } from "@takos/app-sdk/server";

type AppApiBindings = { Bindings: Bindings; Variables: Variables };
const appApiRouter = new Hono<AppApiBindings>();

// Loaded app cache
const appCache = new Map<string, TakosApp>();
const manifestCache = new Map<string, AppManifest>();

function isTakosApp(value: unknown): value is TakosApp {
  return !!value && typeof value === "object" && typeof (value as any).fetch === "function";
}

function normalizeTakosApp(value: unknown): TakosApp | null {
  if (!value) return null;
  if (isTakosApp(value)) return value;
  const maybeModule = value as any;
  if (isTakosApp(maybeModule?.default)) return maybeModule.default;
  return null;
}

function resolveAppBucket(env: Bindings): any | null {
  return (env as any)?.APP_MANIFESTS ??
         (env as any)?.VFS_BUCKET ??
         (env as any)?.WORKSPACE_VFS ??
         (env as any)?.MEDIA ??
         null;
}

async function loadAppManifest(env: Bindings, appId: string): Promise<AppManifest | null> {
  const cached = manifestCache.get(appId);
  if (cached) return cached;

  const bucket = resolveAppBucket(env);
  if (!bucket?.get) return null;

  const manifestKey = `apps/${appId}/manifest.json`;
  try {
    const obj = await bucket.get(manifestKey);
    if (!obj) return null;
    const text = await obj.text();
    const manifest = JSON.parse(text) as AppManifest;
    manifestCache.set(appId, manifest);
    return manifest;
  } catch (error) {
    console.warn(`[app-api] Failed to load manifest from storage for ${appId}:`, error);
    return null;
  }
}

async function loadApp(appId: string, env: Bindings): Promise<TakosApp> {
  const cached = appCache.get(appId);
  if (cached) return cached;

  const candidates: Array<{ source: string; module: unknown }> = [];

  const globalApps = (globalThis as any).__takosApps;
  if (globalApps && typeof globalApps === "object") {
    candidates.push({
      source: "global:__takosApps",
      module: globalApps[appId] ?? globalApps.default,
    });
  }

  const envApps = (env as any).APP_MODULES;
  if (envApps && typeof envApps === "object") {
    candidates.push({
      source: "env:APP_MODULES",
      module: envApps[appId] ?? envApps.default,
    });
  }

  const envMain = (env as any).APP_MAIN_MODULE;
  if (envMain) {
    candidates.push({ source: "env:APP_MAIN_MODULE", module: envMain });
  }

  const globalMain = (globalThis as any).__takosApp;
  if (globalMain) {
    candidates.push({ source: "global:__takosApp", module: globalMain });
  }

  for (const candidate of candidates) {
    const app = normalizeTakosApp(candidate.module);
    if (app) {
      appCache.set(appId, app);
      return app;
    }
  }

  throw new HttpError(404, "NOT_FOUND", "App module not found", { appId });
}

function createAuthenticatedFetch(c: any): AppEnv["fetch"] {
  const base = new URL(c.req.url).origin;
  const authHeader = c.req.header("authorization") ?? c.req.header("Authorization") ?? null;

  return async (path: string, init: RequestInit = {}) => {
    const url = path.startsWith("http")
      ? path
      : new URL(path.startsWith("/") ? path : `/${path}`, base).toString();

    const headers = new Headers(init.headers);
    if (authHeader && !headers.has("authorization")) {
      headers.set("authorization", authHeader);
    }

    return fetch(url, { ...init, headers });
  };
}

function createActivityPubAPI(env: Bindings): AppEnv["activitypub"] {
  return {
    send: async (activity: Activity) => {
      await deliverActivity(env as any, activity as any);
    },
    resolve: async (uri: string) => {
      const actor = await getOrFetchActor(uri, env as any);
      if (actor) return actor;
      return (await fetchRemoteObject(uri)) ?? null;
    },
  };
}

function createAiAPI(c: any, env: Bindings): AppEnv["ai"] {
  const resolveAiConfig = (): TakosConfig["ai"] | undefined => {
    const takosConfig = (c.get("takosConfig") as TakosConfig | undefined) ??
      (env as any).takosConfig;
    return takosConfig?.ai;
  };

  return {
    complete: async (prompt: string, options?: AiCompleteOptions) => {
      const aiConfig = resolveAiConfig();
      if (!aiConfig || aiConfig.enabled === false) {
        console.warn("AI is disabled for this node");
        return "";
      }

      try {
        const registry = buildAiProviderRegistry(aiConfig, env as any);
        const provider = registry.get(options?.provider);
        if (!provider) {
          console.warn("No AI provider configured");
          return "";
        }

        const model = options?.model ?? provider.model;
        if (!model) {
          console.warn("No model specified for AI completion");
          return "";
        }

        const result = await chatCompletion(provider, [
          { role: "user", content: prompt },
        ], {
          model,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
        });

        return result.choices[0]?.message?.content ?? "";
      } catch (error) {
        console.error("AI completion error:", error);
        return "";
      }
    },
    embed: async (text: string, options?: AiEmbedOptions) => {
      const aiConfig = resolveAiConfig();
      if (!aiConfig || aiConfig.enabled === false) {
        console.warn("AI is disabled for this node");
        return [];
      }

      try {
        const registry = buildAiProviderRegistry(aiConfig, env as any);
        const provider = registry.get(options?.provider);
        if (!provider) {
          console.warn("No AI provider configured for embedding");
          return [];
        }

        const result = await embed(provider, text, {
          model: options?.model,
          dimensions: options?.dimensions,
        });

        return result.embeddings[0]?.embedding ?? [];
      } catch (error) {
        console.error("AI embedding error:", error);
        return [];
      }
    },
  };
}

function buildAppEnv(c: any, appId: string, manifest: AppManifest | null): AppEnv {
  const userId = c.get("userId") || null;
  const handle = c.get("handle") || c.get("userHandle") || "";

  return {
    storage: createAppStorage(c.env, appId, userId),
    fetch: createAuthenticatedFetch(c),
    activitypub: createActivityPubAPI(c.env),
    ai: createAiAPI(c, c.env),
    auth: userId ? { userId, handle } : null,
    app: {
      id: appId,
      version: manifest?.version ?? "0.0.0",
    },
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
 * GET /-/apps/:appId/manifest.json
 *
 * Returns the app manifest for the specified app.
 * This endpoint is used by app-loader.ts to load app metadata.
 */
appApiRouter.get("/:appId/manifest.json", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  const stored = await loadAppManifest(env, appId);
  if (stored) {
    return c.json(stored);
  }

  // Fallback placeholder manifest (schema v2.0)
  const manifest: AppManifest = {
    schema_version: "2.0",
    id: appId,
    name: appId,
    version: "0.0.0",
    description: `App ${appId}`,
    basedOn: "default@0.0.0",
    modified: false,
    entry: {
      server: "dist/server.js",
      client: "dist/client.js",
      styles: "dist/styles.css",
    },
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
    throw new HttpError(400, "INVALID_INPUT", "File path required", { appId });
  }

  // Try to load from R2/VFS storage
  const bucket = resolveAppBucket(env);

  if (!bucket) {
    throw new HttpError(500, "CONFIGURATION_ERROR", "App storage not configured", { appId });
  }

  const fileKey = `apps/${appId}/dist/${distPath}`;

  let obj: any | null = null;
  try {
    obj = await bucket.get(fileKey);
  } catch (error) {
    console.error(`[app-api] Failed to serve dist file for ${appId}/${distPath}:`, error);
    if (error instanceof Response) throw error;
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "INTERNAL_ERROR", "Failed to load file", { appId, path: distPath });
  }

  if (!obj) {
    throw new HttpError(404, "NOT_FOUND", "File not found", { appId, path: distPath });
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
});

// Main handler for all app API routes
appApiRouter.all("/:appId/api/*", async (c) => {
  const appId = c.req.param("appId");
  const env = c.env;

  const app = await loadApp(appId, env);
  const manifest = await loadAppManifest(env, appId);
  const appEnv = buildAppEnv(c, appId, manifest);

  // Convert /-/apps/:appId/api/* -> /* for the app
  const url = new URL(c.req.url);
  const appPath = url.pathname.replace(`/-/apps/${appId}/api`, "") || "/";
  const appUrl = new URL(appPath + url.search, url.origin);
  const appRequest = new Request(appUrl, c.req.raw);

  try {
    return await app.fetch(appRequest, appEnv);
  } catch (error) {
    console.error(`[app-api] App fetch error for ${appId}:`, error);
    if (error instanceof Response) throw error;
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "HANDLER_EXECUTION_ERROR", "App handler execution failed", { appId });
  }
});

export { appApiRouter };
