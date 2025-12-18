import type {
  AiRuntime,
  AppAuthContext,
  AppErrorResponse,
  AppJsonResponse,
  AppLogEntry,
  AppLogLevel,
  AppLogSink,
  AppRedirectResponse,
  AppResponseHeaders,
  AppResponseInit,
  AppRuntimeMode,
  BindingResolver,
  BindingResolverInfo,
  OutboundRuntime,
  ServiceRegistry,
  TakosContext,
} from "./types";
import { chatCompletion, embed } from "../../ai/provider-adapters";

export type CreateTakosContextOptions = {
  mode: AppRuntimeMode;
  workspaceId?: string;
  runId?: string;
  handlerName?: string;
  auth?: AppAuthContext;
  services?: ServiceRegistry;
  resolveDb?: BindingResolver<any>;
  resolveStorage?: BindingResolver<any>;
  ai?: AiRuntime;
  outbound?: OutboundRuntime;
  logSink?: AppLogSink;
};

export function createTakosContext(options: CreateTakosContextOptions): TakosContext {
  const mode: AppRuntimeMode = options.mode === "dev" ? "dev" : "prod";
  const workspaceId = mode === "dev" ? options.workspaceId : undefined;
  const runId = options.runId ?? createRunId();
  const bindingInfo: BindingResolverInfo = { mode, workspaceId };

  const services = { ...(options.services ?? {}) };
  const baseAi = (options.ai ?? { providers: null }) as AiRuntime;
  const ai =
    typeof (baseAi as any).openai === "object" && (baseAi as any).openai
      ? baseAi
      : ({
          ...baseAi,
          openai: {
            chat: {
              completions: {
                create: async (params: any) => {
                  if (params?.stream) {
                    throw new Error("streaming is not supported in ctx.ai.openai");
                  }
                  const registry = baseAi.providers;
                  if (!registry) {
                    throw new Error("AI providers are not configured for this runtime");
                  }
                  const provider = registry.get();
                  if (!provider) {
                    throw new Error("No AI provider configured");
                  }

                  const messages = Array.isArray(params?.messages)
                    ? params.messages.map((m: any) => ({ role: m.role, content: m.content }))
                    : [];

                  const result = await chatCompletion(provider as any, messages as any, {
                    model: params?.model,
                    temperature: params?.temperature,
                    maxTokens: params?.max_tokens,
                    stream: false,
                    tools: params?.tools,
                    toolChoice: params?.tool_choice,
                    responseFormat: params?.response_format,
                  });

                  return {
                    id: result.id,
                    choices: result.choices.map((choice) => ({
                      index: choice.index,
                      message: choice.message as any,
                      finish_reason: choice.finishReason ?? "stop",
                    })),
                    usage: result.usage
                      ? {
                          prompt_tokens: result.usage.promptTokens,
                          completion_tokens: result.usage.completionTokens,
                          total_tokens: result.usage.totalTokens,
                        }
                      : undefined,
                  };
                },
              },
            },
            embeddings: {
              create: async (params: any) => {
                const registry = baseAi.providers;
                if (!registry) {
                  throw new Error("AI providers are not configured for this runtime");
                }
                const provider = registry.get();
                if (!provider) {
                  throw new Error("No AI provider configured");
                }

                const result = await embed(provider as any, params?.input ?? "", { model: params?.model });
                return {
                  data: result.embeddings.map((entry) => ({ index: entry.index, embedding: entry.embedding })),
                  usage: result.usage
                    ? { prompt_tokens: result.usage.promptTokens, total_tokens: result.usage.totalTokens }
                    : undefined,
                };
              },
            },
          },
        } as AiRuntime);
  const log = createLogEmitter({
    mode,
    workspaceId,
    runId,
    handlerName: options.handlerName,
    sink: options.logSink,
  });

  const responses = createResponseHelpers();

  return {
    mode,
    workspaceId,
    runId,
    handler: options.handlerName,
    auth: options.auth,
    services,
    db: createBindingAccessor("database", options.resolveDb, bindingInfo),
    storage: createBindingAccessor("storage", options.resolveStorage, bindingInfo),
    ai,
    outbound: options.outbound,
    log,
    json: responses.json,
    error: responses.error,
    redirect: responses.redirect,
  };
}

export function createRunId(): string {
  const g = globalThis as Record<string, any>;
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return `run_${Math.random().toString(36).slice(2, 10)}`;
}

function createBindingAccessor<T>(
  kind: "database" | "storage",
  resolver: BindingResolver<T> | undefined,
  info: BindingResolverInfo,
): (name: string) => T {
  return (name: string) => {
    if (!resolver) {
      throw new Error(`No ${kind} resolver configured for App runtime`);
    }
    const normalized = typeof name === "string" ? name.trim() : "";
    if (!normalized) {
      throw new Error(`${kind} name is required`);
    }
    return resolver(normalized, info);
  };
}

function createLogEmitter(options: {
  mode: AppRuntimeMode;
  workspaceId?: string;
  runId: string;
  handlerName?: string;
  sink?: AppLogSink;
}): (level: AppLogLevel, message: string, data?: Record<string, unknown>) => void {
  return (level: AppLogLevel, message: string, data?: Record<string, unknown>) => {
    if (!options.sink) return;
    const entry: AppLogEntry = {
      timestamp: new Date().toISOString(),
      mode: options.mode,
      workspaceId: options.workspaceId,
      runId: options.runId,
      handler: options.handlerName,
      level,
      message,
      data,
    };
    try {
      options.sink(entry);
    } catch (error) {
      console.error("App runtime log sink failed", error);
    }
  };
}

type InitLike = number | AppResponseInit | undefined;

function normalizeStatus(status: number | undefined, fallback: number): number {
  if (typeof status === "number" && Number.isFinite(status) && status > 0) {
    return Math.trunc(status);
  }
  return fallback;
}

function parseInit(init: InitLike, fallback: number): { status: number; headers?: AppResponseHeaders } {
  if (typeof init === "number") {
    return { status: normalizeStatus(init, fallback) };
  }
  const status = normalizeStatus(init?.status, fallback);
  const headers = init?.headers ? { ...init.headers } : undefined;
  return { status, headers };
}

function createResponseHelpers() {
  return {
    json<T>(body: T, init: AppResponseInit = {}): AppJsonResponse<T> {
      const parsed = parseInit(init, 200);
      return {
        type: "json",
        status: parsed.status,
        headers: parsed.headers,
        body,
      };
    },
    error(message: string, init: InitLike = 400): AppErrorResponse {
      const parsed = parseInit(init, 400);
      return {
        type: "error",
        status: parsed.status,
        headers: parsed.headers,
        message,
      };
    },
    redirect(location: string, init: InitLike = 302): AppRedirectResponse {
      const parsed = parseInit(init, 302);
      const target = location?.toString?.().trim?.() ?? "";
      if (!target) {
        throw new Error("redirect location is required");
      }
      return {
        type: "redirect",
        status: parsed.status,
        headers: parsed.headers,
        location: target,
      };
    },
  };
}
