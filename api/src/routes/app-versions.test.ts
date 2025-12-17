import { afterEach, describe, expect, it, vi } from "vitest";
import appVersionsRoutes from "./app-versions";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import type { AppWorkspaceRecord, WorkspaceSnapshotRecord } from "../lib/workspace-store";

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

const withPlan = (
  overrides: Record<string, unknown>,
  options: { features?: string[]; limits?: Record<string, unknown> },
) => ({
  ...overrides,
  TAKOS_PLAN: "test",
  TAKOS_PLAN_FEATURES: options.features?.join(",") ?? "",
  TAKOS_PLAN_LIMITS: options.limits ?? {},
});

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

describe("/-/dev/versions", () => {
  afterEach(() => {
    setBackendDataFactory(defaultFactory);
    vi.restoreAllMocks();
  });

  const withDataStore = (overrides: Record<string, unknown>) => Object.assign(buildStore(), overrides);

  it("lists workspace snapshots", async () => {
    const snapshots: WorkspaceSnapshotRecord[] = [
      {
        id: "snap_1",
        workspace_id: baseWorkspace.id,
        status: "draft",
        storage_key: "vfs-snapshots/ws_123/draft/1.json",
        size_bytes: 10,
        file_count: 1,
        created_at: "2025-01-01T00:00:00.000Z",
      },
    ];

    const workspaceStore: any = {
      getWorkspace: vi.fn(async (id: string) => (id === baseWorkspace.id ? baseWorkspace : null)),
      listWorkspaceSnapshots: vi.fn(async (_id: string, _opts?: any) => snapshots),
    };

    setBackendDataFactory(() => withDataStore({}));

    const res = await appVersionsRoutes.request(
      `/-/dev/versions/${baseWorkspace.id}/log?limit=10`,
      { method: "GET", headers: await authHeaders() },
      buildEnv(withPlan({ workspaceStore }, { features: ["app_customization"] })),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, data: { workspaceId: baseWorkspace.id } });
    expect(body.data.snapshots).toHaveLength(1);
  });

  it("diffs workspace snapshots by file hash", async () => {
    const workspaceStore: any = {
      getWorkspace: vi.fn(async (id: string) => (id === baseWorkspace.id ? baseWorkspace : null)),
      getWorkspaceSnapshotRecord: vi.fn(async (id: string) => ({
        id,
        workspace_id: baseWorkspace.id,
        status: "draft",
        storage_key: `k/${id}.json`,
        created_at: "2025-01-01T00:00:00.000Z",
      })),
      readWorkspaceSnapshotPayload: vi.fn(async (id: string) => {
        if (id === "snap_a") {
          return {
            workspaceId: baseWorkspace.id,
            status: "draft",
            createdAt: "2025-01-01T00:00:00.000Z",
            files: [
              { path: "a.txt", size: 1, contentHash: "h1", contentType: "text/plain", content: "YQ==" },
              { path: "b.txt", size: 1, contentHash: "h2", contentType: "text/plain", content: "Yg==" },
            ],
          };
        }
        return {
          workspaceId: baseWorkspace.id,
          status: "draft",
          createdAt: "2025-01-01T00:01:00.000Z",
          files: [
            { path: "b.txt", size: 2, contentHash: "h2_changed", contentType: "text/plain", content: "YmI=" },
            { path: "c.txt", size: 1, contentHash: "h3", contentType: "text/plain", content: "Yw==" },
          ],
        };
      }),
    };

    setBackendDataFactory(() => withDataStore({}));

    const res = await appVersionsRoutes.request(
      `/-/dev/versions/${baseWorkspace.id}/diff?from=snap_a&to=snap_b`,
      { method: "GET", headers: await authHeaders() },
      buildEnv(withPlan({ workspaceStore }, { features: ["app_customization"] })),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        workspaceId: baseWorkspace.id,
        summary: { added: 1, removed: 1, changed: 1 },
      },
    });
  });
});

