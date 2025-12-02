import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJWT } from "@takos/platform/server";
import appDebug from "./app-debug";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppLogEntry } from "@takos/platform/app";

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
      INSTANCE_OWNER_HANDLE: "owner",
      DEV_DB: {},
      DEV_MEDIA: {},
      DEV_KV: {},
      workspaceStore: createMockWorkspaceStore(),
    };
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

  it("rejects non-owner callers", async () => {
    const token = await createJWT("alice", secret, 3600);
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
      authEnv,
    );

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("owner_required");
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
