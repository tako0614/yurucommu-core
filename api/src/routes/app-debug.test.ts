import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJWT } from "@takos/platform/server";
import appDebug from "./app-debug";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppLogEntry } from "@takos/platform/app";
import appRpcRoutes from "./app-rpc";

const bearer = (token: string) => `Bearer ${token}`;

const createMockWorkspaceStore = () => {
  const workspaces = new Map<string, any>();
  const files = new Map<string, any>();
  return {
    getWorkspace: async (id: string) => workspaces.get(id) ?? null,
    listWorkspaces: async () => Array.from(workspaces.values()),
    upsertWorkspace: async (workspace: any) => {
      const record = {
        id: workspace.id,
        base_revision_id: workspace.base_revision_id ?? null,
        status: workspace.status ?? "draft",
        author_type: workspace.author_type ?? "human",
        author_name: workspace.author_name ?? null,
        created_at: workspace.created_at ?? new Date().toISOString(),
        updated_at: workspace.updated_at ?? new Date().toISOString(),
      };
      workspaces.set(record.id, record);
      return record;
    },
    updateWorkspaceStatus: async (id: string, status: string) => {
      const existing = workspaces.get(id);
      if (!existing) return null;
      const next = { ...existing, status, updated_at: new Date().toISOString() };
      workspaces.set(id, next);
      return next;
    },
    saveWorkspaceFile: async (workspaceId: string, path: string, content: any, contentType?: string | null) => {
      const bytes =
        typeof content === "string"
          ? new TextEncoder().encode(content)
          : content instanceof Uint8Array
            ? content
            : new Uint8Array(content as ArrayBuffer);
      const record = {
        workspace_id: workspaceId,
        path,
        content: bytes,
        content_type: contentType ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      files.set(`${workspaceId}:${path}`, record);
      return record;
    },
    getWorkspaceFile: async (workspaceId: string, path: string) =>
      files.get(`${workspaceId}:${path}`) ?? null,
    listWorkspaceFiles: async (workspaceId: string) =>
      Array.from(files.values()).filter((file) => file.workspace_id === workspaceId),
  };
};

const encodeDataUrl = (code: string): string =>
  `data:application/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`;

const encodeInlineRef = (code: string): string =>
  `inline:${Buffer.from(code, "utf8").toString("base64")}`;

const collectExportedHandlers = (module: Record<string, unknown>): Map<string, any> => {
  const handlers = new Map<string, any>();
  for (const [key, value] of Object.entries(module)) {
    if (key === "default" || key === "__esModule") continue;
    if (typeof value === "function") handlers.set(key, value);
  }
  const defaultExport = (module as any).default;
  if (defaultExport && typeof defaultExport === "object" && !Array.isArray(defaultExport)) {
    for (const [key, value] of Object.entries(defaultExport as Record<string, unknown>)) {
      if (typeof value === "function") handlers.set(key, value);
    }
  }
  return handlers;
};

const createMockWorkerLoader = () =>
  ({
    get: (_id: string, getCode: () => Promise<any>) => {
      let cached: { handlers: Map<string, any> } | null = null;
      return {
        getEntrypoint: () => ({
          fetch: async (request: Request) => {
            if (!cached) {
              const code = await getCode();
              const appMain = code?.modules?.["app-main.js"]?.js ?? code?.modules?.["app-main.js"];
              const mod = (await import(encodeDataUrl(String(appMain)))) as any;
              cached = { handlers: collectExportedHandlers(mod) };
            }
            const payload = (await request.json().catch(() => null)) as any;
            if (payload?.action === "invoke") {
              const fn = cached.handlers.get(payload.handler);
              if (!fn) {
                return new Response(JSON.stringify({ ok: false, runId: payload.context?.runId ?? "run", error: { message: "Unknown app handler" }, logs: [] }), {
                  status: 404,
                  headers: { "content-type": "application/json" },
                });
              }
              const ctx: any = {
                mode: payload.context?.mode ?? "dev",
                workspaceId: payload.context?.workspaceId,
                runId: payload.context?.runId ?? "run",
                auth: payload.context?.auth ?? null,
                log: () => {},
                json: (body: any) => ({ type: "json", status: 200, body }),
              };
              const out = await fn(ctx, payload.input);
              const response = out && typeof out === "object" && typeof out.type === "string" ? out : ctx.json(out);
              return new Response(JSON.stringify({ ok: true, runId: ctx.runId, response, logs: [] }), {
                status: 200,
                headers: { "content-type": "application/json" },
              });
            }
            return new Response(JSON.stringify({ ok: false, error: { message: "unknown action" } }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          },
        }),
      };
    },
  }) as any;

describe("app debug routes", () => {
  const defaultFactory = getDefaultDataFactory();
  const sharedLogs: AppLogEntry[] = [];
  const secret = "jwt-secret";
  let lastLogQuery: any = null;
  let authEnv: any;

  const dataFactory = () =>
    ({
      getUser: async (id: string) => ({ id }),
      getUserJwtSecret: async () => secret,
      setUserJwtSecret: async () => {},
      appendAppLogEntries: async (entries: AppLogEntry[]) => {
        sharedLogs.push(...entries);
      },
      listAppLogEntries: async (options?: any) => {
        lastLogQuery = options;
        return sharedLogs;
      },
      disconnect: async () => {},
    }) as any;

  beforeEach(() => {
    sharedLogs.length = 0;
    lastLogQuery = null;
    authEnv = {
      DEV_DB: {},
      DEV_MEDIA: {},
      DEV_KV: {},
      workspaceStore: createMockWorkspaceStore(),
      LOADER: createMockWorkerLoader(),
      TAKOS_APP_RPC_TOKEN: "test-token",
    };
    authEnv.TAKOS_CORE = { fetch: (req: Request) => appRpcRoutes.fetch(req, authEnv as any, {} as any) };
    setBackendDataFactory(() => dataFactory());
  });

  afterEach(() => {
    setBackendDataFactory(defaultFactory);
  });

  it("runs a handler in dev sandbox and persists logs", async () => {
    const token = await createJWT("owner", secret, 3600);
    const res = await appDebug.request(
      "/-/app/debug/run",
      {
        method: "POST",
        headers: {
          Authorization: bearer(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "dev",
          workspaceId: "ws_demo",
          handler: "ping",
          input: { hello: "world" },
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.handler).toBe("ping");
    expect(Array.isArray(json.data.logs)).toBe(true);
    expect(sharedLogs.length).toBeGreaterThan(0);
    const runIds = new Set(sharedLogs.map((log) => log.runId));
    expect(runIds.size).toBe(1);
    expect(runIds.has(json.data.runId)).toBe(true);
    expect(sharedLogs.every((log) => log.mode === "dev")).toBe(true);
    expect(sharedLogs.every((log) => log.workspaceId === "ws_demo")).toBe(true);
    expect(sharedLogs.some((log) => log.message.includes("ActivityPub disabled"))).toBe(true);
    expect(sharedLogs.some((log) => log.workspaceId === "ws_demo")).toBe(true);
  });

  it("rejects unauthenticated callers", async () => {
    const res = await appDebug.request(
      "/-/app/debug/run",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "dev",
          workspaceId: "ws_demo",
          handler: "ping",
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(401);
  });

  it("rejects debug run when scriptRef fails code inspection", async () => {
    const token = await createJWT("owner", secret, 3600);
    const res = await appDebug.request(
      "/-/app/debug/run",
      {
        method: "POST",
        headers: {
          Authorization: bearer(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "dev",
          workspaceId: "ws_demo",
          handler: "ping",
          scriptRef: encodeInlineRef('export const ping = (ctx) => { eval(\"1\"); return ctx.json({ ok: true }); };'),
        }),
      },
      { ...authEnv, TAKOS_CONTEXT: "dev" },
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(String(json.code ?? "")).toBe("INVALID_OPTION");
    expect(String(json.message ?? "")).toMatch(/inspection/i);
  });

  it("allows dangerous patterns in dev when explicitly enabled", async () => {
    const token = await createJWT("owner", secret, 3600);
    const res = await appDebug.request(
      "/-/app/debug/run",
      {
        method: "POST",
        headers: {
          Authorization: bearer(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "dev",
          workspaceId: "ws_demo",
          handler: "ping",
          scriptRef: encodeInlineRef('export const ping = (ctx) => { eval(\"1\"); return ctx.json({ ok: true }); };'),
        }),
      },
      { ...authEnv, TAKOS_CONTEXT: "dev", ALLOW_DANGEROUS_APP_PATTERNS: "1" },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
  });

  it("does not allow inspection override in prod-preview mode", async () => {
    const token = await createJWT("owner", secret, 3600);
    const res = await appDebug.request(
      "/-/app/debug/run",
      {
        method: "POST",
        headers: {
          Authorization: bearer(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "prod-preview",
          handler: "ping",
          scriptRef: encodeInlineRef('export const ping = (ctx) => { eval(\"1\"); return ctx.json({ ok: true }); };'),
        }),
      },
      { ...authEnv, TAKOS_CONTEXT: "dev", ALLOW_DANGEROUS_APP_PATTERNS: "1" },
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(String(json.code ?? "")).toBe("INVALID_OPTION");
    expect(String(json.message ?? "")).toMatch(/inspection/i);
  });

  it("blocks debug route when plan lacks app customization", async () => {
    const token = await createJWT("owner", secret, 3600);
    const res = await appDebug.request(
      "/-/app/debug/run",
      {
        method: "POST",
        headers: {
          Authorization: bearer(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          mode: "dev",
          workspaceId: "ws_demo",
          handler: "ping",
        }),
      },
      { ...authEnv, TAKOS_PLAN: "test", TAKOS_PLAN_FEATURES: "basic_sns", TAKOS_PLAN_LIMITS: {} },
    );

    expect(res.status).toBe(402);
  });

  it("returns stored logs with filters applied", async () => {
    sharedLogs.push(
      {
        timestamp: new Date().toISOString(),
        mode: "dev",
        workspaceId: "ws_demo",
        runId: "run-test",
        handler: "ping",
        level: "info",
        message: "hello",
      },
      {
        timestamp: new Date().toISOString(),
        mode: "prod",
        runId: "run-prod",
        handler: "ping",
        level: "info",
        message: "prod log",
      },
    );
    const token = await createJWT("owner", secret, 3600);
    const res = await appDebug.request(
      "/-/app/debug/logs?workspaceId=ws_demo&handler=ping&mode=dev",
      {
        method: "GET",
        headers: { Authorization: bearer(token) },
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data.logs)).toBe(true);
    expect(json.data.logs.length).toBeGreaterThan(0);
    expect(lastLogQuery?.workspaceId).toBe("ws_demo");
    expect(lastLogQuery?.handler).toBe("ping");
    expect(lastLogQuery?.mode).toBe("dev");
  });
});
