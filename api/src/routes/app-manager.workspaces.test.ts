import { afterEach, describe, expect, it, vi } from "vitest";
import appManagerRoutes from "./app-manager";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppWorkspaceRecord } from "../lib/types";

const defaultFactory = getDefaultDataFactory();

const testUser = { id: "testuser", handle: "testuser", display_name: "Test User" };
const jwtSecret = "secret";

const createDevDb = () =>
  ({
    prepare: () => ({
      bind: () => ({
        all: async () => ({ results: [] }),
        run: async () => ({}),
      }),
      all: async () => ({ results: [] }),
      run: async () => ({}),
    }),
  }) as any;

const buildEnv = (overrides?: Record<string, unknown>) => ({
  TAKOS_CONTEXT: "dev",
  DEV_DB: createDevDb(),
  DEV_MEDIA: {},
  DEV_KV: {},
  ...overrides,
});

const buildStore = () =>
  ({
    getUser: vi.fn().mockResolvedValue(testUser),
    getUserJwtSecret: vi.fn().mockResolvedValue(jwtSecret),
    setUserJwtSecret: vi.fn(),
    createSession: vi.fn(),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    deleteSession: vi.fn(),
    disconnect: vi.fn(),
  }) as any;

const authHeaders = async () => ({
  Authorization: `Bearer ${await createJWT(testUser.id, jwtSecret)}`,
  "content-type": "application/json",
});

const baseWorkspace: AppWorkspaceRecord = {
  id: "ws_123",
  base_revision_id: null,
  status: "draft",
  author_type: "human",
  author_name: testUser.display_name,
  created_at: "2025-01-01T00:00:00.000Z",
  updated_at: "2025-01-01T00:00:00.000Z",
};
const encoder = new TextEncoder();

const buildWorkspaceFile = (path: string, content: string) => ({
  workspace_id: baseWorkspace.id,
  path,
  content: encoder.encode(content),
  content_type: "application/json",
  created_at: baseWorkspace.created_at,
  updated_at: baseWorkspace.updated_at,
});

describe("/-/app/workspaces", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
    vi.restoreAllMocks();
  });

  const withStore = (overrides: Record<string, unknown>) =>
    Object.assign(buildStore(), overrides);

  it("creates a draft workspace when authenticated", async () => {
    const createAppWorkspace = vi.fn(async (input: any) => ({
      ...baseWorkspace,
      id: input.id ?? "ws_new",
      base_revision_id: input.base_revision_id ?? null,
      status: input.status ?? "draft",
      author_type: input.author_type,
      author_name: input.author_name,
    }));

    setBackendDataFactory(() => withStore({ createAppWorkspace }));

    const res = await appManagerRoutes.request(
      "/-/app/workspaces",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ baseRevisionId: "rev_base" }),
      },
      buildEnv(),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.workspace?.status).toBe("draft");
    expect(createAppWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        base_revision_id: "rev_base",
        status: "draft",
        author_type: "human",
      }),
    );
  });

  it("lists workspaces with a clamped limit", async () => {
    const listAppWorkspaces = vi.fn(async () => [baseWorkspace]);
    setBackendDataFactory(() => withStore({ listAppWorkspaces }));

    const res = await appManagerRoutes.request(
      "/-/app/workspaces?limit=200",
      {
        method: "GET",
        headers: await authHeaders(),
      },
      buildEnv(),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.limit).toBe(100);
    expect(listAppWorkspaces).toHaveBeenCalledWith(100);
  });

  it("updates status from draft to validated", async () => {
    const getAppWorkspace = vi.fn(async () => baseWorkspace);
    const updateAppWorkspaceStatus = vi.fn(async (_id: string, status: string) => ({
      ...baseWorkspace,
      status,
    }));

    setBackendDataFactory(() =>
      withStore({
        getAppWorkspace,
        updateAppWorkspaceStatus,
      }),
    );

    const workspaceStore = {
      async listWorkspaceFiles() {
        return [buildWorkspaceFile("takos-app.json", JSON.stringify({ schema_version: "1.0.0" }))];
      },
    };

    const res = await appManagerRoutes.request(
      "/-/app/workspaces/ws_123/status",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ status: "validated" }),
      },
      { ...buildEnv(), workspaceStore },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.workspace?.status).toBe("validated");
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.every((issue: any) => issue?.severity !== "error")).toBe(true);
    expect(updateAppWorkspaceStatus).toHaveBeenCalledWith("ws_123", "validated");
  });

  it("returns validation issues when manifest is invalid", async () => {
    const getAppWorkspace = vi.fn(async () => baseWorkspace);
    const updateAppWorkspaceStatus = vi.fn();

    setBackendDataFactory(() =>
      withStore({
        getAppWorkspace,
        updateAppWorkspaceStatus,
      }),
    );

    const workspaceStore = {
      async listWorkspaceFiles() {
        return [buildWorkspaceFile("takos-app.json", "{}")];
      },
    };

    const res = await appManagerRoutes.request(
      "/-/app/workspaces/ws_123/status",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ status: "validated" }),
      },
      { ...buildEnv(), workspaceStore },
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.issues.some((issue: any) => String(issue.message).includes("schema_version"))).toBe(true);
    expect(updateAppWorkspaceStatus).not.toHaveBeenCalled();
  });

  it("rejects invalid status transitions", async () => {
    const getAppWorkspace = vi.fn(async () => baseWorkspace);
    const updateAppWorkspaceStatus = vi.fn();

    setBackendDataFactory(() =>
      withStore({
        getAppWorkspace,
        updateAppWorkspaceStatus,
      }),
    );

    const res = await appManagerRoutes.request(
      "/-/app/workspaces/ws_123/status",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ status: "ready" }),
      },
      buildEnv(),
    );

    expect(res.status).toBe(400);
    expect(updateAppWorkspaceStatus).not.toHaveBeenCalled();
  });

  it("forbids agent calls", async () => {
    setBackendDataFactory(() => withStore({}));

    const res = await appManagerRoutes.request(
      "/-/app/workspaces",
      {
        method: "GET",
        headers: {
          ...(await authHeaders()),
          "x-takos-agent-type": "system",
        },
      },
      buildEnv(),
    );

    expect(res.status).toBe(403);
  });

  it("saves and lists workspace files", async () => {
    const files: Record<string, any> = {};
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      async saveWorkspaceFile(workspaceId: string, path: string, content: string, content_type?: string) {
        files[path] = {
          workspace_id: workspaceId,
          path,
          content: new TextEncoder().encode(content),
          content_type: content_type ?? null,
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        };
        return files[path];
      },
      async listWorkspaceFiles() {
        return Object.values(files);
      },
    };

    setBackendDataFactory(() => withStore({}));

    const saveRes = await appManagerRoutes.request(
      `/-/app/workspaces/${baseWorkspace.id}/files`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ path: "takos-app.json", content: '{"hello":"world"}' }),
      },
      { ...buildEnv(), workspaceStore },
    );

    expect(saveRes.status).toBe(200);
    const saved: any = await saveRes.json();
    expect(saved.data?.file?.path).toBe("takos-app.json");
    expect(files["takos-app.json"]).toBeDefined();

    const listRes = await appManagerRoutes.request(
      `/-/app/workspaces/${baseWorkspace.id}/files`,
      {
        method: "GET",
        headers: await authHeaders(),
      },
      { ...buildEnv(), workspaceStore },
    );

    expect(listRes.status).toBe(200);
    const listed: any = await listRes.json();
    expect(listed.data?.files?.[0]?.path).toBe("takos-app.json");
    expect(listed.data?.files?.[0]?.content).toContain("hello");
  });

  it("enforces plan workspace limit", async () => {
    const listAppWorkspaces = vi.fn(async () => [baseWorkspace]);
    const createAppWorkspace = vi.fn();
    setBackendDataFactory(() => withStore({ listAppWorkspaces, createAppWorkspace }));

    const res = await appManagerRoutes.request(
      "/-/app/workspaces",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({}),
      },
      buildEnv({ PLAN: "free" }),
    );

    expect(res.status).toBe(403);
    expect(createAppWorkspace).not.toHaveBeenCalled();
  });

  it("rejects oversized workspace files for the active plan", async () => {
    const saveWorkspaceFile = vi.fn();
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      saveWorkspaceFile,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 0, totalSize: 0 })),
      statWorkspaceFile: vi.fn(async () => null),
    };

    setBackendDataFactory(() => withStore({}));

    const largeContent = "x".repeat(120 * 1024);
    const res = await appManagerRoutes.request(
      `/-/app/workspaces/${baseWorkspace.id}/files`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ path: "takos-app.json", content: largeContent }),
      },
      { ...buildEnv({ PLAN: "free" }), workspaceStore },
    );

    expect(res.status).toBe(413);
    expect(saveWorkspaceFile).not.toHaveBeenCalled();
  });

  it("stores compile cache entries with plan-aware TTL", async () => {
    const saveCompileCache = vi.fn(async (_workspaceId: string, _hash: string, content: string) => ({
      workspace_id: baseWorkspace.id,
      path: "__cache/esbuild/demo.js",
      content: encoder.encode(content),
      content_type: "application/javascript",
      created_at: baseWorkspace.created_at,
      updated_at: baseWorkspace.updated_at,
    }));
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      saveCompileCache,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 0, totalSize: 0 })),
      statWorkspaceFile: vi.fn(async () => null),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appManagerRoutes.request(
      `/-/app/workspaces/${baseWorkspace.id}/cache/esbuild/demo`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ content: "compiled" }),
      },
      { ...buildEnv({ PLAN: "pro" }), workspaceStore },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.cache?.path).toContain("demo");
    expect(saveCompileCache).toHaveBeenCalledWith(
      baseWorkspace.id,
      "demo",
      "compiled",
      expect.objectContaining({ cacheControl: expect.stringContaining("max-age") }),
    );
  });
});
