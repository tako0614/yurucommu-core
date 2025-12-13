import type { PublicAccountBindings as Bindings, TakosConfig } from "@takos/platform/server";
import { HttpError } from "@takos/platform/server";
import { deliverActivity } from "@takos/platform/activitypub/delivery";
import { getOrFetchActor, fetchRemoteObject } from "@takos/platform/activitypub/actor-fetch";
import { buildAiProviderRegistry, chatCompletion, embed } from "@takos/platform/server";
import type {
  Activity,
  AiCompleteOptions,
  AiEmbedOptions,
  AppEnv,
  AppManifest,
  TakosApp,
} from "@takos/app-sdk/server";
import type { AuthContext } from "./auth-context-model";

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

export function resolveAppBucket(env: Bindings): any | null {
  return (
    (env as any)?.APP_MANIFESTS ??
    (env as any)?.VFS_BUCKET ??
    (env as any)?.WORKSPACE_VFS ??
    (env as any)?.MEDIA ??
    null
  );
}

export async function loadStoredAppManifest(env: Bindings, appId: string): Promise<AppManifest | null> {
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
    console.warn(`[app-sdk-loader] Failed to load manifest from storage for ${appId}:`, error);
    return null;
  }
}

export async function loadTakosApp(appId: string, env: Bindings): Promise<TakosApp> {
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

function createAppStorage(env: Bindings, appId: string, userId: string | null) {
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
      const prefixLen = buildKey("").length;
      return result.keys.map((k: { name: string }) => k.name.slice(prefixLen));
    },
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
    const takosConfig = (c.get("takosConfig") as TakosConfig | undefined) ?? (env as any).takosConfig;
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

        const result = await chatCompletion(
          provider,
          [{ role: "user", content: prompt }],
          { model, temperature: options?.temperature, maxTokens: options?.maxTokens },
        );

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

export function buildTakosAppEnv(c: any, appId: string, manifest: AppManifest | null): AppEnv {
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;
  const userId = authContext?.isAuthenticated ? authContext.userId : null;
  const handle =
    (authContext?.user?.handle && authContext.user.handle.trim()) ||
    (typeof userId === "string" ? userId : "") ||
    "";

  return {
    storage: createAppStorage(c.env, appId, userId),
    fetch: createAuthenticatedFetch(c),
    activitypub: createActivityPubAPI(c.env),
    ai: createAiAPI(c, c.env),
    auth: userId
      ? {
          userId,
          handle,
          sessionId: authContext?.sessionId ?? null,
          plan: authContext?.plan,
          limits: authContext?.limits ?? authContext?.plan?.limits,
          isAuthenticated: authContext?.isAuthenticated ?? true,
        }
      : null,
    app: {
      id: appId,
      version: manifest?.version ?? "0.0.0",
    },
  };
}
