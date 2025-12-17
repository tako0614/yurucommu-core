import { afterEach, describe, expect, it, vi } from "vitest";
import appValidate from "./app-validate";
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

describe("/-/dev/validate", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
    vi.restoreAllMocks();
  });

  it("validates a workspace manifest and caches the status", async () => {
    const kvGet = vi.fn(async (key: string, type?: string) => {
      if (type === "json") return null;
      return null;
    });
    const kvPut = vi.fn(async () => null);

    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles: vi.fn(async () => [
        {
          workspace_id: baseWorkspace.id,
          path: "manifest.json",
          content: encoder.encode(
            JSON.stringify({
              schema_version: "1.10",
              version: "1.0.0",
              layout: { base_dir: "app" },
            }),
          ),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/routes/routes.json",
          content: encoder.encode(JSON.stringify({ schema_version: "1.10", routes: [] })),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/views/screens.json",
          content: encoder.encode(
            JSON.stringify({
              schema_version: "1.10",
              screens: [{ id: "screen.one", route: "/one", layout: {} }],
            }),
          ),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/views/inserts.json",
          content: encoder.encode(
            JSON.stringify({
              schema_version: "1.10",
              insert: [{ screen: "screen.one", position: "sidebar", node: {} }],
            }),
          ),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/ap/handlers.json",
          content: encoder.encode(JSON.stringify({ handlers: [] })),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/data/collections.json",
          content: encoder.encode(JSON.stringify({ collections: {} })),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
        {
          workspace_id: baseWorkspace.id,
          path: "app/storage/buckets.json",
          content: encoder.encode(JSON.stringify({ buckets: {} })),
          content_type: "application/json",
          created_at: baseWorkspace.created_at,
          updated_at: baseWorkspace.updated_at,
        },
      ]),
      getWorkspaceFile: vi.fn(),
      saveWorkspaceFile: vi.fn(),
      upsertWorkspace: vi.fn(),
    };

    setBackendDataFactory(() => buildStore());

    const env = buildEnv({
      TAKOS_PLAN: "test",
      TAKOS_PLAN_FEATURES: "app_customization",
      TAKOS_PLAN_LIMITS: {},
      DEV_KV: { get: kvGet, put: kvPut },
      workspaceStore,
    });

    const res = await appValidate.request(
      `/-/dev/validate/${baseWorkspace.id}`,
      { method: "POST", headers: await authHeaders() },
      env,
    );

    const json: any = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.issues)).toBe(true);
    expect(json.validated_at).toBeTruthy();
    expect(kvPut).toHaveBeenCalled();
  });

  it("returns not_validated when status is missing", async () => {
    const kvGet = vi.fn(async () => null);
    const kvPut = vi.fn(async () => null);

    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles: vi.fn(async () => []),
      getWorkspaceFile: vi.fn(),
      saveWorkspaceFile: vi.fn(),
      upsertWorkspace: vi.fn(),
    };

    setBackendDataFactory(() => buildStore());

    const res = await appValidate.request(
      `/-/dev/validate/${baseWorkspace.id}/status`,
      { method: "GET", headers: await authHeaders() },
      buildEnv({
        TAKOS_PLAN: "test",
        TAKOS_PLAN_FEATURES: "app_customization",
        TAKOS_PLAN_LIMITS: {},
        DEV_KV: { get: kvGet, put: kvPut },
        workspaceStore,
      }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("not_validated");
  });

  it("returns not_validated when KV is not configured", async () => {
    const workspaceStore = {
      async getWorkspace(id: string) {
        return id === baseWorkspace.id ? baseWorkspace : null;
      },
      listWorkspaceFiles: vi.fn(async () => []),
      getWorkspaceFile: vi.fn(),
      saveWorkspaceFile: vi.fn(),
      upsertWorkspace: vi.fn(),
    };

    setBackendDataFactory(() => buildStore());

    const res = await appValidate.request(
      `/-/dev/validate/${baseWorkspace.id}/status`,
      { method: "GET", headers: await authHeaders() },
      buildEnv({
        TAKOS_PLAN: "test",
        TAKOS_PLAN_FEATURES: "app_customization",
        TAKOS_PLAN_LIMITS: {},
        DEV_KV: undefined,
        workspaceStore,
      }),
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.status).toBe("not_validated");
  });
});
