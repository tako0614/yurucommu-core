import type { PublicAccountBindings as Bindings, TakosConfig } from "@takos/platform/server";
import { HttpError } from "@takos/platform/server";
import { buildAiProviderRegistry, chatCompletion, chatCompletionStream, embed } from "@takos/platform/server";
import type {
  AppEnv,
  AppManifest,
  TakosApp,
} from "@takos/app-sdk/server";

/**
 * OpenAI SDK compatible AI interface (inline type for build compatibility).
 * Supports both streaming and non-streaming responses.
 */

/** Non-streaming completion response */
interface ChatCompletionResponse {
  id: string;
  choices: Array<{
    index?: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/** Streaming completion chunk */
interface ChatCompletionChunk {
  id: string;
  choices: Array<{
    index?: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

/** Async iterable stream for streaming responses */
interface ChatCompletionStream extends AsyncIterable<ChatCompletionChunk> {
  /** Get the raw ReadableStream */
  toReadableStream(): ReadableStream<Uint8Array>;
}

/** Completion request params */
interface ChatCompletionParams {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

interface OpenAICompatibleClient {
  chat: {
    completions: {
      /**
       * Create a chat completion.
       * Returns ChatCompletionStream when stream: true, ChatCompletionResponse otherwise.
       */
      create(params: ChatCompletionParams): Promise<ChatCompletionResponse | ChatCompletionStream>;
    };
  };
  embeddings: {
    create: (params: {
      model: string;
      input: string | string[];
    }) => Promise<{
      data: Array<{ embedding: number[]; index: number }>;
      usage?: { prompt_tokens: number; total_tokens: number };
    }>;
  };
}
import type { AuthContext } from "./auth-context-model";
import { buildCoreServices } from "./core-services";
import { createAppCollectionFactory } from "./app-collections";
import { ErrorCodes } from "./error-codes";

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

  throw new HttpError(404, ErrorCodes.NOT_FOUND, "App module not found", { appId });
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

function createUnauthenticatedFetchFromEnv(env: Bindings): AppEnv["fetch"] {
  const domain = (env as any)?.INSTANCE_DOMAIN;
  const origin =
    typeof domain === "string" && domain.trim() ? `https://${domain.trim()}` : "http://localhost";

  return async (path: string, init: RequestInit = {}) => {
    const url = path.startsWith("http")
      ? path
      : new URL(path.startsWith("/") ? path : `/${path}`, origin).toString();
    return fetch(url, init);
  };
}

/**
 * Storage options for set operation.
 */
interface StorageSetOptions {
  /** TTL in seconds (optional) */
  expirationTtl?: number;
}

/**
 * Create per-user KV storage for App.
 * Key structure: `app:${appId}:user:${userId}:${key}` (authenticated)
 *            or: `app:${appId}:global:${key}` (unauthenticated)
 *
 * v3.0: Supports per-user isolation and TTL.
 */
function createAppStorage(env: Bindings, appId: string, userId?: string | null) {
  const buildKey = (key: string): string => {
    if (userId) {
      return `app:${appId}:user:${userId}:${key}`;
    }
    return `app:${appId}:global:${key}`;
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

    set: async (key: string, value: unknown, options?: StorageSetOptions): Promise<void> => {
      if (!kv) {
        console.warn("APP_STATE KV binding not available");
        return;
      }
      const fullKey = buildKey(key);
      const putOptions: { expirationTtl?: number } = {};
      if (options?.expirationTtl && options.expirationTtl > 0) {
        putOptions.expirationTtl = options.expirationTtl;
      }
      await kv.put(fullKey, JSON.stringify(value), putOptions);
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

/**
 * Create OpenAI SDK compatible AI API.
 * This allows Apps to use LangChain or OpenAI SDK directly with env.core.ai.
 */
function createOpenAICompatibleAiAPI(c: any, env: Bindings): OpenAICompatibleClient {
  const resolveAiConfig = (): TakosConfig["ai"] | undefined => {
    const takosConfig = (c.get?.("takosConfig") as TakosConfig | undefined) ?? (env as any).takosConfig;
    return takosConfig?.ai;
  };

  const getRegistry = () => {
    const aiConfig = resolveAiConfig();
    if (!aiConfig || aiConfig.enabled === false) {
      return null;
    }
    return buildAiProviderRegistry(aiConfig, env as any);
  };

  return {
    chat: {
      completions: {
        create: async (params: ChatCompletionParams): Promise<ChatCompletionResponse | ChatCompletionStream> => {
          const registry = getRegistry();
          if (!registry) {
            throw new Error("AI is disabled for this node");
          }

          const provider = registry.get();
          if (!provider) {
            throw new Error("No AI provider configured");
          }

          const messages = params.messages.map((m) => ({
            role: m.role as "user" | "assistant" | "system",
            content: m.content,
          }));

          const options = {
            model: params.model,
            temperature: params.temperature,
            maxTokens: params.max_tokens,
          };

          // Streaming mode
          if (params.stream === true) {
            const streamResult = await chatCompletionStream(provider, messages, options);
            const rawStream = streamResult.stream;

            // Create an async iterable that parses SSE chunks
            const asyncIterable: ChatCompletionStream = {
              [Symbol.asyncIterator]: async function* () {
                const reader = rawStream.getReader();
                const decoder = new TextDecoder();
                let buffer = "";

                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                      if (!line.startsWith("data: ")) continue;
                      const data = line.slice(6).trim();
                      if (data === "[DONE]") return;

                      try {
                        const chunk = JSON.parse(data);
                        yield {
                          id: chunk.id || streamResult.id,
                          choices: chunk.choices?.map((c: any, i: number) => ({
                            index: c.index ?? i,
                            delta: c.delta || {},
                            finish_reason: c.finish_reason ?? null,
                          })) || [],
                        } as ChatCompletionChunk;
                      } catch {
                        // Skip invalid JSON
                      }
                    }
                  }
                } finally {
                  reader.releaseLock();
                }
              },
              toReadableStream: () => rawStream,
            };

            return asyncIterable;
          }

          // Non-streaming mode
          const result = await chatCompletion(provider, messages, options);

          return {
            id: `chatcmpl-${Date.now()}`,
            choices: result.choices.map((choice, index) => ({
              index,
              message: {
                role: choice.message?.role ?? "assistant",
                content: choice.message?.content ?? "",
              },
              finish_reason: "stop",
            })),
            usage: result.usage
              ? {
                  prompt_tokens: result.usage.promptTokens ?? 0,
                  completion_tokens: result.usage.completionTokens ?? 0,
                  total_tokens: result.usage.totalTokens ?? 0,
                }
              : undefined,
          };
        },
      },
    },
    embeddings: {
      create: async (params: { model: string; input: string | string[] }) => {
        const registry = getRegistry();
        if (!registry) {
          throw new Error("AI is disabled for this node");
        }

        const provider = registry.get();
        if (!provider) {
          throw new Error("No AI provider configured for embedding");
        }

        const inputs = Array.isArray(params.input) ? params.input : [params.input];
        const results: Array<{ embedding: number[]; index: number }> = [];

        for (let i = 0; i < inputs.length; i++) {
          const result = await embed(provider, inputs[i], { model: params.model });
          results.push({
            embedding: result.embeddings[0]?.embedding ?? [],
            index: i,
          });
        }

        return {
          data: results,
          usage: { prompt_tokens: 0, total_tokens: 0 },
        };
      },
    },
  };
}

/**
 * Build AppAuthContext from AuthContext
 */
function buildAppAuthCtx(authContext: AuthContext | null) {
  return {
    userId: authContext?.userId ?? null,
    sessionId: authContext?.sessionId ?? null,
    isAuthenticated: authContext?.isAuthenticated ?? false,
    plan: authContext?.plan ?? { name: "free", limits: {}, features: [] },
    limits: authContext?.limits ?? authContext?.plan?.limits ?? {},
  };
}

/**
 * Create a simplified ObjectService wrapper that auto-injects ctx.
 * This provides an SDK-compatible API without requiring ctx as first argument.
 */
function createSimplifiedObjectService(coreObjects: any, authContext: AuthContext | null) {
  const ctx = buildAppAuthCtx(authContext);

  return {
    get: async (id: string) => {
      return coreObjects.get(ctx, id);
    },
    create: async (data: Record<string, unknown>) => {
      return coreObjects.create(ctx, data);
    },
    update: async (id: string, data: Record<string, unknown>) => {
      return coreObjects.update(ctx, id, data);
    },
    delete: async (id: string) => {
      await coreObjects.delete(ctx, id);
      return true;
    },
    list: async (options?: { actor_id?: string; type?: string; limit?: number; cursor?: string }) => {
      const result = await coreObjects.query(ctx, {
        actor_id: options?.actor_id,
        type: options?.type,
        limit: options?.limit,
        cursor: options?.cursor,
      });
      return {
        items: result.items ?? result.objects ?? [],
        nextCursor: result.nextCursor ?? result.cursor ?? null,
      };
    },
    // Expose raw service for advanced use
    _raw: coreObjects,
    _ctx: ctx,
  };
}

/**
 * Create a simplified ActorService wrapper that auto-injects ctx.
 * Provides an SDK-compatible API for actor/user operations.
 */
function createSimplifiedActorService(coreActors: any, authContext: AuthContext | null) {
  const ctx = buildAppAuthCtx(authContext);

  return {
    /**
     * Get actor by ID
     */
    get: async (actorId: string) => {
      return coreActors.get(ctx, actorId);
    },
    /**
     * Get actor by handle (@username or username@domain)
     */
    getByHandle: async (handle: string) => {
      return coreActors.getByHandle(ctx, handle);
    },
    /**
     * Search actors
     */
    search: async (query: string, options?: { limit?: number; offset?: number }) => {
      return coreActors.search(ctx, query, options);
    },
    /**
     * Follow an actor
     */
    follow: async (targetId: string) => {
      return coreActors.follow(ctx, targetId);
    },
    /**
     * Unfollow an actor
     */
    unfollow: async (targetId: string) => {
      return coreActors.unfollow(ctx, targetId);
    },
    /**
     * List followers
     */
    listFollowers: async (options?: { limit?: number; offset?: number; actorId?: string }) => {
      return coreActors.listFollowers(ctx, options);
    },
    /**
     * List following
     */
    listFollowing: async (options?: { limit?: number; offset?: number; actorId?: string }) => {
      return coreActors.listFollowing(ctx, options);
    },
    // Expose raw service for advanced use
    _raw: coreActors,
    _ctx: ctx,
  };
}

/**
 * Create a simplified NotificationService wrapper that auto-injects ctx.
 * Provides an SDK-compatible API for notification operations.
 */
function createSimplifiedNotificationService(coreNotifications: any, authContext: AuthContext | null) {
  const ctx = buildAppAuthCtx(authContext);

  return {
    /**
     * List notifications
     */
    list: async (options?: { since?: string }) => {
      return coreNotifications.list(ctx, options);
    },
    /**
     * Mark notification as read
     */
    markRead: async (id: string) => {
      return coreNotifications.markRead(ctx, id);
    },
    /**
     * Send notification (if available)
     */
    send: coreNotifications.send
      ? async (input: {
          recipientId: string;
          type: string;
          actorId?: string | null;
          refType?: string | null;
          refId?: string | null;
          message?: string | null;
          data?: Record<string, unknown> | null;
        }) => {
          return coreNotifications.send(ctx, input);
        }
      : undefined,
    // Expose raw service for advanced use
    _raw: coreNotifications,
    _ctx: ctx,
  };
}

export function buildTakosAppEnv(c: any, appId: string, manifest: AppManifest | null): AppEnv {
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;
  const userId = authContext?.isAuthenticated ? authContext.userId : null;
  const handle =
    (authContext?.user?.handle && authContext.user.handle.trim()) ||
    (typeof userId === "string" ? userId : "") ||
    "";

  let core: AppEnv["core"] | undefined;
  const workspaceId =
    (c.get?.("workspaceId") as string | undefined) ??
    (c.env as any)?.APP_WORKSPACE_ID ??
    (c.env as any)?.WORKSPACE_ID ??
    null;
  try {
    const coreServices = buildCoreServices(c.env as Bindings);
    core = {
      ...coreServices,
      // Add OpenAI SDK compatible AI API
      ai: createOpenAICompatibleAiAPI(c, c.env),
      // Wrap ObjectService with simplified API (ctx auto-injected)
      objects: createSimplifiedObjectService(coreServices.objects, authContext),
      // Wrap ActorService with simplified API (ctx auto-injected)
      actors: coreServices.actors
        ? createSimplifiedActorService(coreServices.actors, authContext)
        : undefined,
      // Wrap NotificationService with simplified API (ctx auto-injected)
      notifications: coreServices.notifications
        ? createSimplifiedNotificationService(coreServices.notifications, authContext)
        : undefined,
    } as any;
    (core as any).db = createAppCollectionFactory(c.env as Bindings, appId, workspaceId);
  } catch (error) {
    core = undefined;
    console.warn("[app-sdk-loader] Failed to build core services for AppEnv:", error);
  }

  return {
    core,
    DB: (c.env as any)?.DB,
    KV: (c.env as any)?.KV,
    STORAGE: (c.env as any)?.STORAGE ?? (c.env as any)?.MEDIA,
    INSTANCE_DOMAIN: (c.env as any)?.INSTANCE_DOMAIN,
    JWT_SECRET: (c.env as any)?.JWT_SECRET,
    takosConfig: (c.get("takosConfig") as any) ?? (c.env as any)?.takosConfig,
    workspaceId: workspaceId ?? undefined,
    storage: createAppStorage(c.env, appId, userId),
    fetch: createAuthenticatedFetch(c),
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

export function buildTakosScheduledAppEnv(
  env: Bindings,
  appId: string,
  manifest: AppManifest | null,
): AppEnv {
  let core: AppEnv["core"] | undefined;
  const workspaceId = (env as any)?.APP_WORKSPACE_ID ?? (env as any)?.WORKSPACE_ID ?? null;
  const mockContext = { get: () => null, env };
  try {
    const coreServices = buildCoreServices(env as Bindings);
    core = {
      ...coreServices,
      // Add OpenAI SDK compatible AI API
      ai: createOpenAICompatibleAiAPI(mockContext, env),
      // Wrap ObjectService with simplified API (system context for scheduled)
      objects: createSimplifiedObjectService(coreServices.objects, null),
      // Wrap ActorService with simplified API (system context for scheduled)
      actors: coreServices.actors
        ? createSimplifiedActorService(coreServices.actors, null)
        : undefined,
      // Wrap NotificationService with simplified API (system context for scheduled)
      notifications: coreServices.notifications
        ? createSimplifiedNotificationService(coreServices.notifications, null)
        : undefined,
    } as any;
    (core as any).db = createAppCollectionFactory(env as Bindings, appId, workspaceId);
  } catch (error) {
    core = undefined;
    console.warn("[app-sdk-loader] Failed to build core services for scheduled AppEnv:", error);
  }

  return {
    core,
    DB: (env as any)?.DB,
    KV: (env as any)?.KV,
    STORAGE: (env as any)?.STORAGE ?? (env as any)?.MEDIA,
    INSTANCE_DOMAIN: (env as any)?.INSTANCE_DOMAIN,
    JWT_SECRET: (env as any)?.JWT_SECRET,
    takosConfig: (env as any)?.takosConfig,
    workspaceId: workspaceId ?? undefined,
    storage: createAppStorage(env, appId, null), // No user in scheduled context
    fetch: createUnauthenticatedFetchFromEnv(env),
    auth: null,
    app: {
      id: appId,
      version: manifest?.version ?? "0.0.0",
    },
  };
}
