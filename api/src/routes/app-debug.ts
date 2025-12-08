import { Hono } from "hono";
import {
  AppHandlerRegistry,
  createAppSandbox,
  createRunId,
  loadAppMainFromModule,
  type AppLogEntry,
  type AppRuntimeMode,
  type AppScriptModule,
} from "@takos/platform/app";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { getActivityPubAvailability, ok, releaseStore } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import type { DatabaseAPI, ListAppLogsOptions } from "../lib/types";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "../lib/workspace-store";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";

type DebugMode = "dev" | "prod-preview";

type RunRequestBody = {
  mode?: string;
  workspaceId?: string;
  handler?: string;
  input?: unknown;
  auth?: Record<string, unknown>;
};

const demoAppMain: AppScriptModule = {
  ping: (ctx: any, input: unknown) => {
    ctx.log("info", "demo ping invoked", { input });
    return ctx.json({
      ok: true,
      input,
      mode: ctx.mode,
      workspaceId: ctx.workspaceId ?? null,
    });
  },
};

const debugApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
debugApp.use("/-/app/debug/*", auth, requireHumanSession, requireWorkspacePlan);

function normalizeMode(value: unknown): DebugMode | null {
  if (typeof value !== "string") return "dev";
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "dev") return "dev";
  if (trimmed === "prod-preview" || trimmed === "prod_preview") return "prod-preview";
  return null;
}

function resolveRuntimeMode(mode: DebugMode): AppRuntimeMode {
  return mode === "dev" ? "dev" : "prod";
}

function normalizeWorkspaceId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeHandlerName(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeSince(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeForLog(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  if (value instanceof Error) {
    return value.message;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

const requireAuthenticated = (
  c: any,
): { user: any } | null => {
  const sessionUser = (c.get("sessionUser") as any) || (c.get("user") as any);
  if (!sessionUser?.id) {
    return null;
  }
  return { user: sessionUser };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

type LogContext = Pick<AppLogEntry, "mode" | "runId" | "workspaceId" | "handler">;

type PartialLogEntry = Partial<AppLogEntry> & Pick<AppLogEntry, "level" | "message">;

function applyLogContext(entry: PartialLogEntry, context: LogContext): AppLogEntry {
  return {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    mode: context.mode,
    workspaceId: context.workspaceId,
    runId: context.runId,
    handler: entry.handler ?? context.handler,
    level: entry.level ?? "info",
    message: entry.message ?? "",
    ...(entry.data === undefined ? {} : { data: entry.data }),
  };
}

function captureConsole(push: (entry: PartialLogEntry) => void): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    push({ level: "info", message: args.map(serializeForLog).join(" ") });
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    push({ level: "info", message: args.map(serializeForLog).join(" ") });
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    push({ level: "warn", message: args.map(serializeForLog).join(" ") });
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    push({ level: "error", message: args.map(serializeForLog).join(" ") });
  };
  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    push({ level: "debug", message: args.map(serializeForLog).join(" ") });
  };
  return () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  };
}

async function loadAppRegistry(options: {
  env: Bindings;
  mode: AppRuntimeMode;
  workspaceId?: string;
}): Promise<{ registry: AppHandlerRegistry; source: string }> {
  const candidates: Array<{ source: string; module: AppScriptModule | null | undefined }> = [];
  const globalModule = (globalThis as any).__takosAppMain;
  if (globalModule) {
    candidates.push({ source: "global:__takosAppMain", module: globalModule });
  }
  const envModule = (options.env as any).APP_MAIN_MODULE;
  if (envModule && typeof envModule === "object") {
    candidates.push({ source: "env:APP_MAIN_MODULE", module: envModule });
  }

  for (const candidate of candidates) {
    if (!candidate.module) continue;
    try {
      const loaded = await loadAppMainFromModule(candidate.module, candidate.source);
      return { registry: loaded.registry, source: candidate.source };
    } catch (error) {
      console.error(`failed to load app-main from ${candidate.source}`, error);
    }
  }

  const loadedDemo = await loadAppMainFromModule(demoAppMain, "demo");
  return { registry: loadedDemo.registry, source: "demo" };
}

async function persistLogs(store: DatabaseAPI | null, logs: AppLogEntry[]): Promise<void> {
  if (!store?.appendAppLogEntries) return;
  if (!logs.length) return;
  try {
    await store.appendAppLogEntries(logs);
  } catch (error) {
    console.error("[app-debug] failed to persist logs", error);
  }
}

function parseLogQuery(c: any): ListAppLogsOptions {
  const mode = normalizeMode(c.req.query("mode"));
  const handler = normalizeHandlerName(c.req.query("handler"));
  const workspaceId = normalizeWorkspaceId(c.req.query("workspaceId"));
  const since = normalizeSince(c.req.query("since"));
  const limitRaw = c.req.query("limit");
  const limit = limitRaw ? Number.parseInt(String(limitRaw), 10) : undefined;
  return {
    mode: mode ? resolveRuntimeMode(mode) : undefined,
    workspaceId: workspaceId || undefined,
    handler: handler || undefined,
    since: since ?? undefined,
    limit,
  };
}

debugApp.post("/-/app/debug/run", async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as RunRequestBody;
  const mode = normalizeMode(payload.mode);
  if (!mode) {
    return c.json({ ok: false, error: "invalid_mode" }, 400);
  }
  const runtimeMode = resolveRuntimeMode(mode);
  const workspaceId = normalizeWorkspaceId(payload.workspaceId);
  if (runtimeMode === "dev" && !workspaceId) {
    return c.json({ ok: false, error: "workspaceId_required" }, 400);
  }

  const handlerName = normalizeHandlerName(payload.handler);
  if (!handlerName) {
    return c.json({ ok: false, error: "handler_required" }, 400);
  }

  const authSession = requireAuthenticated(c);
  if (!authSession) {
    return c.json({ ok: false, error: "authentication_required" }, 403);
  }

  const logs: AppLogEntry[] = [];
  const runId = createRunId();
  const logContext: LogContext = {
    mode: runtimeMode,
    workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
    runId,
    handler: handlerName,
  };
  const pushLog = (entry: PartialLogEntry) => {
    logs.push(applyLogContext(entry, logContext));
  };
  const restoreConsole = captureConsole(pushLog);

  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as Bindings,
    mode: runtimeMode === "dev" ? "dev" : "prod",
    requireIsolation: runtimeMode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return c.json(
      { ok: false, error: "dev_data_isolation_failed", details: workspaceEnv.isolation.errors },
      503,
    );
  }
  if (runtimeMode === "dev" && !workspaceEnv.store) {
    return c.json({ ok: false, error: "workspace_store_unavailable" }, 503);
  }

  const runEnv: Bindings = {
    ...(workspaceEnv.env as any),
    ...(runtimeMode === "dev"
      ? {
          TAKOS_CONTEXT: "dev",
          APP_CONTEXT: "dev",
          APP_MODE: "dev",
          EXECUTION_CONTEXT: "dev",
          ACTIVITYPUB_ENABLED: "false",
        }
      : {}),
  };
  if (runtimeMode === "dev") {
    await ensureDefaultWorkspace(workspaceEnv.store);
  }

  let store: DatabaseAPI | null = null;
  try {
    store = makeData(runEnv as any, c);
    const { registry, source } = await loadAppRegistry({
      env: runEnv,
      mode: runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
    });

    const handler = registry.get(handlerName);
    if (!handler) {
      return c.json({ ok: false, error: `handler_not_found:${handlerName}` }, 404);
    }

    if (runtimeMode === "dev") {
      const availability = getActivityPubAvailability(runEnv as any);
      pushLog({
        level: "info",
        message: "ActivityPub disabled for dev run",
        data: { availability },
      });
    }

    const sandbox = createAppSandbox({
      registry,
      mode: runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      logSink: (entry) => pushLog(entry),
      resolveDb: () => (runEnv as any).DB,
      resolveStorage: () => (runEnv as any).MEDIA,
    });

    const started = performance.now();
    const result = await sandbox.run(handlerName, payload.input, {
      runId,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      auth: isRecord(payload.auth) ? payload.auth as any : undefined,
    });
    const durationMs = Number((performance.now() - started).toFixed(2));

    await persistLogs(store, logs);

    if (!result.ok) {
      return c.json(
        {
          ok: false,
          error: result.error?.message ?? "handler_failed",
          runId,
          logs,
        },
        500,
      );
    }

    return ok(c, {
      handler: handlerName,
      appMainSource: source,
      mode,
      runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      runId: result.runId,
      durationMs,
      logs,
      response: result.response,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "handler_failed";
    pushLog({
      level: "error",
      message,
      data: error instanceof Error && error.stack ? { stack: error.stack } : undefined,
    });
    await persistLogs(store, logs);
    return c.json({ ok: false, error: message, runId, logs }, 500);
  } finally {
    restoreConsole();
    if (store) {
      await releaseStore(store);
    }
  }
});

debugApp.get("/-/app/debug/logs", async (c) => {
  const authSession = requireAuthenticated(c);
  if (!authSession) {
    return c.json({ ok: false, error: "authentication_required" }, 403);
  }
  const options = parseLogQuery(c);
  const targetMode: AppRuntimeMode = options.mode ?? "dev";
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as Bindings,
    mode: targetMode === "dev" ? "dev" : "prod",
    requireIsolation: targetMode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    return c.json(
      { ok: false, error: "dev_data_isolation_failed", details: workspaceEnv.isolation.errors },
      503,
    );
  }
  const envForLogs: Bindings = {
    ...(workspaceEnv.env as any),
    ...(targetMode === "dev"
      ? {
          TAKOS_CONTEXT: "dev",
          APP_CONTEXT: "dev",
          APP_MODE: "dev",
          EXECUTION_CONTEXT: "dev",
          ACTIVITYPUB_ENABLED: "false",
        }
      : {}),
  };
  const store = makeData(envForLogs as any, c);
  try {
    if (!store.listAppLogEntries) {
      return c.json({ ok: false, error: "log_store_unavailable" }, 501);
    }
    const logs = await store.listAppLogEntries(options);
    return ok(c, { logs, filters: options });
  } finally {
    await releaseStore(store);
  }
});

export default debugApp;
