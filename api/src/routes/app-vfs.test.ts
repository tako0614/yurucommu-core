import { afterEach, describe, expect, it, vi } from "vitest";
import appVfs from "./app-vfs";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppWorkspaceRecord, WorkspaceFileRecord } from "../lib/workspace-store";

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

describe("/-/dev/vfs", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
    vi.restoreAllMocks();
  });

  const withStore = (overrides: Record<string, unknown>) =>
    Object.assign(buildStore(), overrides);

  it("requires a plan with app customization feature", async () => {
    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      "/-/dev/vfs/ws_123/files/app-main.ts",
      {
        method: "GET",
        headers: await authHeaders(),
      },
      buildEnv({ PLAN: "free" }),
    );

    expect(res.status).toBe(402);
  });

  it("lists workspace files and usage", async () => {
    const listWorkspaceFiles = vi.fn(async (_id: string, _prefix?: string) => {
      const file: WorkspaceFileRecord = {
        workspace_id: baseWorkspace.id,
        path: "takos-app.json",
        content: encoder.encode('{"name":"demo"}'),
        content_type: "application/json",
        created_at: baseWorkspace.created_at,
        updated_at: baseWorkspace.updated_at,
      };
      return [file];
    });

    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 1, totalSize: 123 })),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/files`,
      {
        method: "GET",
        headers: await authHeaders(),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.files).toHaveLength(1);
    expect(json.data?.files[0].path).toBe("takos-app.json");
    expect(json.data?.files[0].content).toContain("demo");
    expect(json.data?.usage?.fileCount).toBe(1);
  });

  it("stores esbuild compile cache with plan-aware cache-control", async () => {
    const saveCompileCache = vi.fn(async () => ({
      workspace_id: baseWorkspace.id,
      path: "__cache/esbuild/demo.js",
      content: encoder.encode("compiled"),
      content_type: "application/javascript",
      size: 8,
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

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/cache/esbuild/demo`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ content: "compiled" }),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.cache?.path).toContain("demo");
    expect(json.data?.cache_control).toContain("max-age");
    expect(saveCompileCache).toHaveBeenCalledWith(
      baseWorkspace.id,
      "demo",
      "compiled",
      expect.objectContaining({ cacheControl: expect.stringContaining("max-age") }),
    );
  });

  it("rejects compile cache writes that exceed plan limits with structured error", async () => {
    const saveCompileCache = vi.fn();
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      saveCompileCache,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 0, totalSize: 0 })),
      statWorkspaceFile: vi.fn(async () => null),
    };

    setBackendDataFactory(() => withStore({}));
    const oversized = "x".repeat(1_500_000); // > pro plan vfsMaxFileSize

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/cache/esbuild/demo`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ content: oversized }),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(413);
    const json: any = await res.json();
    expect(json.code).toBe("FILE_TOO_LARGE");
    expect(json.message).toMatch(/plan/i);
    expect(saveCompileCache).not.toHaveBeenCalled();
  });
});
