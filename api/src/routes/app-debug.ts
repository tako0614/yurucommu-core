import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { ok, releaseStore } from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { makeData } from "../data";
import type { DatabaseAPI } from "../lib/types";

type DebugMode = "dev" | "prod-preview";
type DebugLogLevel = "debug" | "info" | "warn" | "error";

type DebugLogEntry = {
  level: DebugLogLevel;
  message: string;
  timestamp: string;
  details?: Record<string, unknown>;
  workspaceId?: string;
};

type DebugHandlerContext = {
  env: Bindings;
  user: any;
  workspaceId: string;
  mode: DebugMode;
  context: Record<string, unknown>;
  store: DatabaseAPI;
  log: (level: DebugLogLevel, message: string, details?: Record<string, unknown>) => void;
};

type DebugHandler = (context: DebugHandlerContext, input: unknown) => Promise<unknown> | unknown;

const debugApp = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

function pushLog(
  logs: DebugLogEntry[],
  level: DebugLogLevel,
  message: unknown,
  details?: Record<string, unknown>,
  workspaceId?: string,
): void {
  logs.push({
    level,
    message: serializeForLog(message),
    timestamp: new Date().toISOString(),
    workspaceId,
    ...(details ? { details } : {}),
  });
}

function captureConsole(logs: DebugLogEntry[], workspaceId?: string): () => void {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (...args: unknown[]) => {
    original.log(...args);
    pushLog(
      logs,
      "info",
      args.map(serializeForLog).join(" "),
      undefined,
      workspaceId,
    );
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    pushLog(
      logs,
      "info",
      args.map(serializeForLog).join(" "),
      undefined,
      workspaceId,
    );
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    pushLog(
      logs,
      "warn",
      args.map(serializeForLog).join(" "),
      undefined,
      workspaceId,
    );
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    pushLog(
      logs,
      "error",
      args.map(serializeForLog).join(" "),
      undefined,
      workspaceId,
    );
  };
  console.debug = (...args: unknown[]) => {
    original.debug(...args);
    pushLog(
      logs,
      "debug",
      args.map(serializeForLog).join(" "),
      undefined,
      workspaceId,
    );
  };
  return () => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    console.debug = original.debug;
  };
}

function isAdminUser(user: any, env: Bindings): boolean {
  return !!env.AUTH_USERNAME && user?.id === env.AUTH_USERNAME;
}

function normalizeMode(value: unknown): DebugMode | null {
  if (typeof value !== "string") return "dev";
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "dev") return "dev";
  if (trimmed === "prod-preview" || trimmed === "prod_preview") return "prod-preview";
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const handlers: Record<string, DebugHandler> = {
  ping: async (ctx, input) => {
    ctx.log("info", "ping handler invoked");
    return {
      ok: true,
      input,
      workspaceId: ctx.workspaceId,
      userId: ctx.user?.id ?? null,
      timestamp: new Date().toISOString(),
    };
  },
  whoami: async (ctx) => {
    const userId = ctx.user?.id;
    if (!userId) {
      throw new Error("user not authenticated");
    }
    const user = await ctx.store.getUser(userId);
    ctx.log("info", "user loaded", { userId });
    return { user };
  },
  recentPosts: async (ctx, input) => {
    const userId = ctx.user?.id;
    if (!userId) throw new Error("user not authenticated");
    const requestedLimit =
      typeof input === "object" && input && "limit" in (input as any)
        ? Number((input as any).limit) || 10
        : 10;
    const limit = Math.max(1, Math.min(50, requestedLimit));
    const posts = await ctx.store.listGlobalPostsForUser(userId);
    ctx.log("info", "fetched recent posts", { count: posts.length });
    return posts.slice(0, limit);
  },
};

debugApp.post("/admin/app/debug/run", auth, async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const mode = normalizeMode(payload.mode);
  if (mode !== "dev") {
    return c.json({ ok: false, error: "only dev mode is supported for handler debug runs" }, 400);
  }
  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId.trim() : "";
  if (!workspaceId) {
    return c.json({ ok: false, error: "workspaceId is required in dev mode" }, 400);
  }
  const handlerName = typeof payload.handler === "string" ? payload.handler.trim() : "";
  if (!handlerName) {
    return c.json({ ok: false, error: "handler is required" }, 400);
  }
  const handler = handlers[handlerName];
  if (!handler) {
    return c.json({ ok: false, error: `handler not found: ${handlerName}` }, 404);
  }
  const user = c.get("user");
  if (!isAdminUser(user, c.env as Bindings)) {
    return c.json({ ok: false, error: "forbidden" }, 403);
  }

  const logs: DebugLogEntry[] = [];
  const restoreConsole = captureConsole(logs, workspaceId);
  let store: DatabaseAPI | null = null;

  try {
    store = makeData(c.env as any, c);
    const ctx: DebugHandlerContext = {
      env: c.env as Bindings,
      user,
      workspaceId,
      mode,
      context: isRecord(payload.context) ? (payload.context as Record<string, unknown>) : {},
      store,
      log: (level, message, details) => pushLog(logs, level, message, details, workspaceId),
    };

    const started = performance.now();
    const result = await handler(ctx, payload.input);
    const durationMs = Number((performance.now() - started).toFixed(2));
    pushLog(logs, "info", `handler ${handlerName} completed`, { durationMs }, workspaceId);
    return ok(c, {
      handler: handlerName,
      mode,
      workspaceId,
      durationMs,
      logs,
      result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "handler failed";
    const details =
      error instanceof Error && error.stack ? { stack: error.stack } : undefined;
    pushLog(logs, "error", message, details, workspaceId);
    return c.json({ ok: false, error: message, logs }, 500);
  } finally {
    restoreConsole();
    if (store) {
      await releaseStore(store);
    }
  }
});

export default debugApp;
