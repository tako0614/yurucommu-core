import { afterEach, describe, expect, it, vi } from "vitest";
import appCompile from "./app-compile";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppWorkspaceRecord } from "../lib/workspace-store";

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
  DEV_KV: {
    get: vi.fn(async () => null),
    put: vi.fn(async () => null),
  },
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

describe("/-/dev/compile", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
    vi.restoreAllMocks();
  });

  it("compiles (TS fallback) and stores compile cache", async () => {
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
      getWorkspaceFile: vi.fn(async (_id: string, path: string) => {
        if (path.startsWith("__cache/esbuild/")) return null;
        return {
          workspace_id: baseWorkspace.id,
          path,
          content: encoder.encode("export const x: number = 1;"),
          content_type: "application/typescript",
          content_hash: "hash",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        };
      }),
      saveCompileCache,
      saveWorkspaceFile: vi.fn(),
      listWorkspaceFiles: vi.fn(async () => []),
      getWorkspaceUsage: vi.fn(async () => ({ fileCount: 0, totalSize: 0 })),
      upsertWorkspace: vi.fn(),
    };

    setBackendDataFactory(() => buildStore());

    const res = await appCompile.request(
      "/-/dev/compile",
      {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ workspaceId: baseWorkspace.id, entryPath: "app/main.ts", sourcemap: false }),
      },
      buildEnv({ PLAN: "pro", workspaceStore }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.data?.compiled?.code).toContain("export");
    expect(saveCompileCache).toHaveBeenCalled();
  });
});
