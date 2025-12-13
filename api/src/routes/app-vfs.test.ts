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

  it("lists directory entries with files and directories", async () => {
    const listWorkspaceFiles = vi.fn(async () => {
      const files: WorkspaceFileRecord[] = [
        {
          workspace_id: baseWorkspace.id,
          path: "src/index.ts",
          content: encoder.encode("export const value = 1;"),
          content_type: "application/typescript",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "readme.md",
          content: encoder.encode("# hello"),
          content_type: "text/markdown",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
      ];
      return files;
    });

    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles,
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/dirs`,
      {
        method: "GET",
        headers: await authHeaders(),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.path).toBe("/");
    expect(json.data?.dirs?.some((dir: any) => dir.path === "src")).toBe(true);
    expect(json.data?.files?.some((file: any) => file.path === "readme.md")).toBe(true);
    expect(json.data?.entries?.some((entry: any) => entry.type === "dir" && entry.path === "src")).toBe(true);
    expect(json.data?.entries?.some((entry: any) => entry.type === "file" && entry.path === "readme.md")).toBe(true);
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

  it("copies files via /files/copy", async () => {
    const copyWorkspaceFile = vi.fn(async (_workspaceId: string, _from: string, _to: string) => ({
      workspace_id: baseWorkspace.id,
      path: "app/copied.ts",
      content: encoder.encode("export {}"),
      content_type: "application/typescript",
      size: 9,
      created_at: baseWorkspace.created_at,
      updated_at: baseWorkspace.updated_at,
    }));
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      getWorkspaceFile: vi.fn(async () => ({
        workspace_id: baseWorkspace.id,
        path: "app/source.ts",
        content: encoder.encode("export const x = 1;"),
        content_type: "application/typescript",
        size: 19,
        created_at: baseWorkspace.created_at,
        updated_at: baseWorkspace.updated_at,
      })),
      copyWorkspaceFile,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 1, totalSize: 10 })),
      statWorkspaceFile: vi.fn(async () => null),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/files/copy`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ from: "app/source.ts", to: "app/copied.ts" }),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.file?.path).toBe("app/copied.ts");
    expect(copyWorkspaceFile).toHaveBeenCalledWith(baseWorkspace.id, "app/source.ts", "app/copied.ts");
  });

  it("moves files via /files/move", async () => {
    const moveWorkspaceFile = vi.fn(async (_workspaceId: string, _from: string, _to: string) => ({
      workspace_id: baseWorkspace.id,
      path: "app/moved.ts",
      content: encoder.encode("export {}"),
      content_type: "application/typescript",
      size: 9,
      created_at: baseWorkspace.created_at,
      updated_at: baseWorkspace.updated_at,
    }));
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      getWorkspaceFile: vi.fn(async () => ({
        workspace_id: baseWorkspace.id,
        path: "app/source.ts",
        content: encoder.encode("export const x = 1;"),
        content_type: "application/typescript",
        size: 19,
        created_at: baseWorkspace.created_at,
        updated_at: baseWorkspace.updated_at,
      })),
      moveWorkspaceFile,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 2, totalSize: 20 })),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/files/move`,
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ from: "app/source.ts", to: "app/moved.ts" }),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.file?.path).toBe("app/moved.ts");
    expect(moveWorkspaceFile).toHaveBeenCalledWith(baseWorkspace.id, "app/source.ts", "app/moved.ts");
  });

  it("matches files via /glob", async () => {
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles: vi.fn(async () => [
        {
          workspace_id: baseWorkspace.id,
          path: "app/a.ts",
          content: encoder.encode("a"),
          content_type: "application/typescript",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/b.json",
          content: encoder.encode("{}"),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
      ]),
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 2, totalSize: 2 })),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/glob?pattern=app/*.ts`,
      { method: "GET", headers: await authHeaders() },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.files?.map((f: any) => f.path)).toEqual(["app/a.ts"]);
  });

  it("searches file contents via /search", async () => {
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles: vi.fn(async () => [
        {
          workspace_id: baseWorkspace.id,
          path: "app/a.ts",
          content: encoder.encode("hello world"),
          content_type: "application/typescript",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
      ]),
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 1, totalSize: 11 })),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/search?query=hello`,
      { method: "GET", headers: await authHeaders() },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.results?.[0]?.path).toBe("app/a.ts");
  });

  it("deletes directories via /dirs/{path}", async () => {
    const deleteDirectory = vi.fn(async () => ({ deletedFiles: 1, deletedDirectories: 2 }));
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      deleteDirectory,
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 0, totalSize: 0 })),
    };

    setBackendDataFactory(() => withStore({}));

    const res = await appVfs.request(
      `/-/dev/vfs/${baseWorkspace.id}/dirs/app?recursive=true`,
      { method: "DELETE", headers: await authHeaders() },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.deleted).toBe(true);
    expect(deleteDirectory).toHaveBeenCalledWith(baseWorkspace.id, "app", { recursive: true });
  });
});
