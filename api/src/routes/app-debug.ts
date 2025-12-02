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
import { ok, releaseStore } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import type { DatabaseAPI, ListAppLogsOptions } from "../lib/types";

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

function isAdminUser(user: any, env: Bindings): boolean {
  return !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function captureConsole(
  logs: AppLogEntry[],
  base: Pick<AppLogEntry, "mode" | "runId" | "workspaceId" | "handler">,
): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  const push = (level: AppLogEntry["level"], args: unknown[]) => {
    logs.push({
      ...base,
      timestamp: new Date().toISOString(),
      level,
      message: args.map(serializeForLog).join(" "),
    });
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    push("info", args);
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    push("info", args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    push("warn", args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    push("error", args);
  };
  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    push("debug", args);
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

debugApp.post("/admin/app/debug/run", auth, async (c) => {
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

  const user = c.get("user");
  if (!isAdminUser(user, c.env as Bindings)) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }

  const logs: AppLogEntry[] = [];
  const runId = createRunId();
  const restoreConsole = captureConsole(logs, {
    mode: runtimeMode,
    workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
    runId,
    handler: handlerName,
  });

  let store: DatabaseAPI | null = null;
  try {
    store = makeData(c.env as any, c);
    const { registry, source } = await loadAppRegistry({
      env: c.env as Bindings,
      mode: runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
    });

    const handler = registry.get(handlerName);
    if (!handler) {
      return c.json({ ok: false, error: `handler_not_found:${handlerName}` }, 404);
    }

    const sandbox = createAppSandbox({
      registry,
      mode: runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      logSink: (entry) => {
        logs.push(entry);
      },
      resolveDb: () => (runtimeMode === "dev" ? (c.env as any).DEV_DB ?? (c.env as any).DB : (c.env as any).DB),
      resolveStorage: () =>
        runtimeMode === "dev" ? (c.env as any).DEV_MEDIA ?? (c.env as any).MEDIA : (c.env as any).MEDIA,
    });

    const started = performance.now();
    const result = await sandbox.run(handlerName, payload.input, {
      runId,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      auth: isRecord(payload.auth) ? payload.auth : undefined,
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
    logs.push({
      timestamp: new Date().toISOString(),
      mode: runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      runId,
      handler: handlerName,
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

debugApp.get("/admin/app/debug/logs", auth, async (c) => {
  const user = c.get("user");
  if (!isAdminUser(user, c.env as Bindings)) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }
  const store = makeData(c.env as any, c);
  try {
    if (!store.listAppLogEntries) {
      return c.json({ ok: false, error: "log_store_unavailable" }, 501);
    }
    const options = parseLogQuery(c);
    const logs = await store.listAppLogEntries(options);
    return ok(c, { logs, filters: options });
  } finally {
    await releaseStore(store);
  }
});

export default debugApp;
