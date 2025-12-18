import { Hono } from "hono";
import {
  createRunId,
  type AppLogEntry,
  type AppRuntimeMode,
} from "@takos/platform/app";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { getActivityPubAvailability, HttpError, ok, releaseStore } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import type { DatabaseAPI, ListAppLogsOptions } from "../lib/types";
import { ensureDefaultWorkspace, resolveWorkspaceEnv } from "../lib/workspace-store";
import { requireHumanSession, requireWorkspacePlan } from "../lib/workspace-guard";
import { mapErrorToResponse } from "../lib/observability";
import { ErrorCodes } from "../lib/error-codes";
import { createIsolatedAppRunner } from "../lib/app-worker-loader";
import { loadAppRegistryFromScript } from "../lib/app-script-loader";
import { inspectAppScriptCode } from "../lib/app-code-inspection";

type DebugMode = "dev" | "prod-preview";

type RunRequestBody = {
  mode?: string;
  workspaceId?: string;
  handler?: string;
  input?: unknown;
  auth?: Record<string, unknown>;
  scriptRef?: string;
};

const demoScriptCode = `
export const ping = (ctx, input) => {
  ctx.log("info", "demo ping invoked", { input });
  return ctx.json({
    ok: true,
    input,
    mode: ctx.mode,
    workspaceId: ctx.workspaceId ?? null,
  });
};
`.trim();

const debugApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();
debugApp.onError((error, c) =>
  mapErrorToResponse(error, {
    requestId: (c.get("requestId") as string | undefined) ?? undefined,
    env: c.env,
  }),
);
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

function boolFromEnv(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
}

function isDevEnv(env: any): boolean {
  const context = typeof env?.TAKOS_CONTEXT === "string" ? env.TAKOS_CONTEXT.trim().toLowerCase() : "";
  if (context === "dev") return true;
  const nodeEnv = typeof env?.NODE_ENV === "string" ? env.NODE_ENV.trim().toLowerCase() : "";
  return nodeEnv === "development";
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

function normalizeScriptRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
    throw new HttpError(400, ErrorCodes.INVALID_OPTION, "Invalid mode", { mode: payload.mode ?? null });
  }
  const runtimeMode = resolveRuntimeMode(mode);
  const workspaceId = normalizeWorkspaceId(payload.workspaceId);
  if (runtimeMode === "dev" && !workspaceId) {
    throw new HttpError(400, ErrorCodes.MISSING_REQUIRED_FIELD, "workspaceId is required", { field: "workspaceId" });
  }

  const handlerName = normalizeHandlerName(payload.handler);
  if (!handlerName) {
    throw new HttpError(400, ErrorCodes.MISSING_REQUIRED_FIELD, "handler is required", { field: "handler" });
  }

  const authSession = requireAuthenticated(c);
  if (!authSession) {
    throw new HttpError(401, ErrorCodes.UNAUTHORIZED, "Authentication required");
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
    throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Dev data isolation failed", {
      errors: workspaceEnv.isolation.errors,
    });
  }
  if (runtimeMode === "dev" && !workspaceEnv.store) {
    throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Workspace store unavailable");
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
    if (!(runEnv as any)?.LOADER) {
      throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Worker Loader (LOADER) is not configured");
    }
    if (!(runEnv as any)?.TAKOS_CORE) {
      throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "TAKOS_CORE service binding is not configured");
    }
    if (!(runEnv as any)?.TAKOS_APP_RPC_TOKEN) {
      throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "TAKOS_APP_RPC_TOKEN is not configured");
    }

    const scriptRef = normalizeScriptRef(payload.scriptRef);
    let scriptCode = demoScriptCode;
    let appMainSource = "demo";
    if (scriptRef) {
      const loaded = await loadAppRegistryFromScript({ scriptRef, env: runEnv as any });
      if (!loaded.code) {
        throw new HttpError(400, ErrorCodes.INVALID_OPTION, "scriptRef must be loadable as source code", { scriptRef });
      }
      scriptCode = loaded.code;
      appMainSource = loaded.source;
    }

    const allowDangerous =
      runtimeMode === "dev" &&
      isDevEnv(runEnv as any) &&
      boolFromEnv((runEnv as any)?.ALLOW_DANGEROUS_APP_PATTERNS);
    const allowedImportsRaw =
      typeof (runEnv as any)?.TAKOS_APP_ALLOWED_IMPORTS === "string"
        ? (runEnv as any).TAKOS_APP_ALLOWED_IMPORTS
        : "@takos/platform/app";
    const allowedImports = String(allowedImportsRaw)
      .split(/[,\s]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
    const inspection = inspectAppScriptCode(scriptCode, { allowedImports });
    if (inspection.length > 0 && !allowDangerous) {
      throw new HttpError(400, ErrorCodes.INVALID_OPTION, "App code inspection failed", {
        issues: inspection,
      });
    }

    if (runtimeMode === "dev") {
      const availability = getActivityPubAvailability(runEnv as any);
      pushLog({
        level: "info",
        message: "ActivityPub disabled for dev run",
        data: { availability },
      });
    }

    const started = performance.now();
    const runner = await createIsolatedAppRunner({
      env: runEnv as any,
      scriptCode,
    });
    const result = await runner.invoke(handlerName, payload.input, {
      mode: runtimeMode,
      workspaceId: runtimeMode === "dev" ? workspaceId : undefined,
      runId,
      auth: isRecord(payload.auth) ? (payload.auth as any) : undefined,
    });
    const durationMs = Number((performance.now() - started).toFixed(2));
    for (const entry of result.logs ?? []) {
      pushLog(entry);
    }

    await persistLogs(store, logs);

    if (!result.ok) {
      const message = result.error?.message ?? "App handler execution failed";
      if (result.error?.code === ErrorCodes.SANDBOX_TIMEOUT || result.error?.code === "SANDBOX_TIMEOUT") {
        throw new HttpError(408, ErrorCodes.SANDBOX_TIMEOUT, message, { runId, logs, handler: handlerName });
      }
      const status =
        message.includes("Unknown app handler")
          ? 404
          : 500;
      throw new HttpError(status, ErrorCodes.HANDLER_EXECUTION_ERROR, message, { runId, logs, handler: handlerName });
    }

    return ok(c, {
      handler: handlerName,
      appMainSource,
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
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(500, ErrorCodes.HANDLER_EXECUTION_ERROR, message, { runId, logs });
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
    throw new HttpError(401, ErrorCodes.UNAUTHORIZED, "Authentication required");
  }
  const options = parseLogQuery(c);
  const targetMode: AppRuntimeMode = options.mode ?? "dev";
  const workspaceEnv = resolveWorkspaceEnv({
    env: c.env as Bindings,
    mode: targetMode === "dev" ? "dev" : "prod",
    requireIsolation: targetMode === "dev",
  });
  if (workspaceEnv.isolation?.required && !workspaceEnv.isolation.ok) {
    throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Dev data isolation failed", {
      errors: workspaceEnv.isolation.errors,
    });
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
      throw new HttpError(503, ErrorCodes.SERVICE_UNAVAILABLE, "Log store unavailable");
    }
    const logs = await store.listAppLogEntries(options);
    return ok(c, { logs, filters: options });
  } finally {
    await releaseStore(store);
  }
});

export default debugApp;
