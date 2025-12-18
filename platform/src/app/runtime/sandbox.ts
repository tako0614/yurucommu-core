import { createTakosContext } from "./context";
import { AppHandlerRegistry } from "./registry";
import type {
  AiRuntime,
  AppAuthContext,
  AppResponse,
  AppRuntimeMode,
  AppLogSink,
  BindingResolver,
  HandlerExecutionResult,
  OutboundRuntime,
  ServiceRegistry,
  TakosContext,
} from "./types";

export type AppSandboxOptions = {
  registry: AppHandlerRegistry;
  mode?: AppRuntimeMode;
  workspaceId?: string;
  auth?: AppAuthContext;
  services?: ServiceRegistry;
  resolveDb?: BindingResolver<any>;
  resolveStorage?: BindingResolver<any>;
  ai?: AiRuntime;
  outbound?: OutboundRuntime;
  logSink?: AppLogSink;
};

export type RunHandlerOptions = {
  mode?: AppRuntimeMode;
  workspaceId?: string;
  auth?: AppAuthContext;
  services?: ServiceRegistry;
  runId?: string;
  input?: unknown;
};

export type SandboxRunResult =
  | (HandlerExecutionResult & { ok: true })
  | { ok: false; runId: string; error: Error };

export class AppSandbox {
  private readonly registry: AppHandlerRegistry;
  private readonly baseMode: AppRuntimeMode;
  private readonly baseWorkspaceId?: string;
  private readonly baseAuth?: AppAuthContext;
  private readonly baseServices: ServiceRegistry;
  private readonly resolveDb?: BindingResolver<any>;
  private readonly resolveStorage?: BindingResolver<any>;
  private readonly ai?: AiRuntime;
  private readonly outbound?: OutboundRuntime;
  private readonly logSink?: AppLogSink;

  constructor(options: AppSandboxOptions) {
    this.registry = options.registry;
    this.baseMode = options.mode ?? "prod";
    this.baseWorkspaceId = options.workspaceId;
    this.baseAuth = options.auth;
    this.baseServices = { ...(options.services ?? {}) };
    this.resolveDb = options.resolveDb;
    this.resolveStorage = options.resolveStorage;
    this.ai = options.ai;
    this.outbound = options.outbound;
    this.logSink = options.logSink;
  }

  listHandlers(): string[] {
    return this.registry.list();
  }

  async run(handlerName: string, input?: unknown, overrides: RunHandlerOptions = {}): Promise<SandboxRunResult> {
    const requestedMode = overrides.mode ?? this.baseMode;
    const mode: AppRuntimeMode = requestedMode === "dev" ? "dev" : "prod";
    const workspaceId = mode === "dev" ? overrides.workspaceId ?? this.baseWorkspaceId : undefined;
    const services = { ...this.baseServices, ...(overrides.services ?? {}) };
    const handler = this.registry.require(handlerName);

    const ctx = createTakosContext({
      mode,
      workspaceId,
      runId: overrides.runId,
      handlerName,
      auth: overrides.auth ?? this.baseAuth,
      services,
      resolveDb: this.resolveDb,
      resolveStorage: this.resolveStorage,
      ai: this.ai,
      outbound: this.outbound,
      logSink: this.logSink,
    });

    const payload = overrides.input !== undefined ? overrides.input : input;

    try {
      const output = await handler(ctx, payload);
      const response = normalizeHandlerResult(output, ctx);
      return { ok: true, runId: ctx.runId, response };
    } catch (error) {
      const normalized = normalizeError(error);
      ctx.log("error", normalized.message, { stack: normalized.stack });
      return { ok: false, runId: ctx.runId, error: normalized };
    }
  }
}

export function createAppSandbox(options: AppSandboxOptions): AppSandbox {
  return new AppSandbox(options);
}

function normalizeHandlerResult(output: unknown, ctx: TakosContext): AppResponse {
  if (isAppResponse(output)) {
    return output as AppResponse;
  }
  return ctx.json(output as unknown);
}

function isAppResponse(value: unknown): value is AppResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const anyValue = value as any;
  if (anyValue.type === "json" && typeof anyValue.status === "number") return true;
  if (anyValue.type === "error" && typeof anyValue.message === "string") return true;
  if (anyValue.type === "redirect" && typeof anyValue.location === "string") return true;
  return false;
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : "Unknown error");
}
