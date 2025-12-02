import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJWT } from "@takos/platform/server";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import appPreview from "./app-preview";

const request = (
  path: string,
  body: Record<string, any>,
  env: Record<string, any> = {},
  headers?: Record<string, string>,
) =>
  appPreview.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      body: JSON.stringify(body),
    },
    env,
  );

const containsText = (node: any, text: string): boolean => {
  if (!node || typeof node !== "object") return false;
  if (node?.props?.text === text) return true;
  if (Array.isArray(node.children)) {
    return node.children.some((child) => containsText(child, text));
  }
  return false;
};

const testManifest = {
  id: "ws_test",
  name: "Workspace Preview",
  views: {
    screens: [
      {
        id: "screen.home",
        layout: {
          type: "Column",
          props: { id: "root" },
          children: [
            {
              type: "Column",
              props: { id: "main" },
              children: [{ type: "Text", props: { text: "Hello Preview" } }],
            },
          ],
        },
      },
    ],
    insert: [],
  },
};

const ownerHandle = "owner";
const secret = "jwt-secret";
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

const authEnv = {
  INSTANCE_OWNER_HANDLE: ownerHandle,
  TAKOS_CONTEXT: "dev",
  DEV_DB: createDevDb(),
  DEV_MEDIA: {},
  DEV_KV: {},
};
const bearer = (token: string) => `Bearer ${token}`;

const createWorkspaceEnv = (manifest = testManifest) => ({
  ...authEnv,
  workspaceStore: {
    async getWorkspaceFile(workspaceId: string, path: string) {
      return {
        workspace_id: workspaceId,
        path,
        content: new TextEncoder().encode(JSON.stringify(manifest)),
        content_type: "application/json",
        created_at: "",
        updated_at: "",
      };
    },
    async getWorkspace(workspaceId: string) {
      return {
        id: workspaceId,
        base_revision_id: null,
        status: "validated",
        author_type: "human",
        author_name: "tester",
        created_at: "",
        updated_at: "",
      };
    },
    async listWorkspaceFiles() {
      return [];
    },
    async listWorkspaces() {
      return [];
    },
    async upsertWorkspace() {
      return null;
    },
    async updateWorkspaceStatus() {
      return null;
    },
    async saveWorkspaceFile() {
      return null;
    },
  },
});

const createStore = (overrides: Record<string, any> = {}) =>
  ({
    getUser: async (id: string) => ({ id }),
    getUserJwtSecret: async () => secret,
    setUserJwtSecret: async () => {},
    getActiveAppRevision: async () => null,
    disconnect: async () => {},
    ...overrides,
  }) as any;

const defaultFactory = getDefaultDataFactory();
let ownerToken = "";

const authedRequest = (
  path: string,
  body: Record<string, any>,
  env?: Record<string, any>,
  headers?: Record<string, string>,
) => request(path, body, env ?? authEnv, { Authorization: bearer(ownerToken), ...(headers ?? {}) });

beforeEach(async () => {
  ownerToken = await createJWT(ownerHandle, secret, 3600);
  setBackendDataFactory(() => createStore());
});

afterEach(() => {
  ownerToken = "";
  setBackendDataFactory(defaultFactory);
});

describe("/-/app/preview/screen", () => {
  it("fails when dev isolation bindings are missing", async () => {
    const res = await authedRequest(
      "/-/app/preview/screen",
      {
        workspaceId: "ws_missing",
        screenId: "screen.home",
        viewMode: "json",
      },
      { INSTANCE_OWNER_HANDLE: ownerHandle, TAKOS_CONTEXT: "dev" },
    );

    expect(res.status).toBe(503);
    const json: any = await res.json();
    expect(json.error).toBe("dev_data_isolation_failed");
  });

  it("returns a resolved tree for a workspace manifest", async () => {
    const res = await authedRequest("/-/app/preview/screen", {
      workspaceId: "ws_test",
      screenId: "screen.home",
      viewMode: "json",
    }, createWorkspaceEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.resolvedTree?.type).toBeDefined();
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(Array.isArray(json.contractWarnings)).toBe(true);
  });

  it("rejects unsupported image preview requests", async () => {
    const res = await authedRequest("/-/app/preview/screen", {
      workspaceId: "ws_test",
      screenId: "screen.home",
      viewMode: "image",
    }, createWorkspaceEnv());

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).toBe("view_mode_not_supported");
  });

  it("requires an owner session", async () => {
    const missingAuth = await request(
      "/-/app/preview/screen",
      {
        workspaceId: "ws_test",
        screenId: "screen.home",
        viewMode: "json",
      },
      createWorkspaceEnv(),
    );
    expect(missingAuth.status).toBe(401);

    const nonOwnerToken = await createJWT("alice", secret, 3600);
    const nonOwner = await request(
      "/-/app/preview/screen",
      {
        workspaceId: "ws_test",
        screenId: "screen.home",
        viewMode: "json",
      },
      createWorkspaceEnv(),
      { Authorization: bearer(nonOwnerToken) },
    );
    expect(nonOwner.status).toBe(403);
  });

  it("loads the active prod manifest when mode is prod", async () => {
    setBackendDataFactory(
      () =>
        createStore({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_prod",
            revision: { id: "rev_prod", manifest_snapshot: JSON.stringify(testManifest) },
          }),
        }) as any,
    );

    const res = await authedRequest("/-/app/preview/screen", {
      mode: "prod",
      screenId: "screen.home",
      viewMode: "json",
    }, authEnv);

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.workspaceId).toBe(testManifest.id);
    expect(containsText(json.resolvedTree, "Hello Preview")).toBe(true);
  });

  it("uses the prod manifest when workspaceId is prod to make before/after comparisons easy", async () => {
    setBackendDataFactory(
      () =>
        createStore({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_prod",
            revision: { id: "rev_prod", manifest_snapshot: JSON.stringify(testManifest) },
          }),
        }) as any,
    );

    const res = await authedRequest("/-/app/preview/screen", {
      workspaceId: "prod",
      screenId: "screen.home",
    }, authEnv);

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.mode).toBe("prod");
    expect(json.workspaceId).toBe(testManifest.id);
    expect(containsText(json.resolvedTree, "Hello Preview")).toBe(true);
  });

  it("accepts previews mode as a workspace preview alias", async () => {
    const res = await authedRequest("/-/app/preview/screen", {
      mode: "previews",
      workspaceId: "ws_test",
      screenId: "screen.home",
    }, createWorkspaceEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.mode).toBe("dev");
    expect(json.workspaceId).toBe("ws_test");
    expect(containsText(json.resolvedTree, "Hello Preview")).toBe(true);
  });
});

describe("/-/app/preview/screen-with-patch", () => {
  it("applies patches before resolving preview without persisting", async () => {
    const res = await authedRequest("/-/app/preview/screen-with-patch", {
      workspaceId: "ws_test",
      screenId: "screen.home",
      viewMode: "json",
      patches: [
        {
          op: "add",
          path: "/views/insert/-",
          value: {
            screen: "screen.home",
            position: "main",
            order: 99,
            node: {
              type: "Text",
              props: { text: "Patched from test" },
            },
          },
        },
      ],
    }, createWorkspaceEnv());

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.patchesApplied).toBe(1);
    expect(containsText(json.resolvedTree, "Patched from test")).toBe(true);

    const base = await authedRequest(
      "/-/app/preview/screen",
      {
        workspaceId: "ws_test",
        screenId: "screen.home",
        viewMode: "json",
      },
      createWorkspaceEnv(),
    );
    const baseJson: any = await base.json();
    expect(containsText(baseJson.resolvedTree, "Patched from test")).toBe(false);
  });

  it("rejects invalid patch payloads", async () => {
    const res = await authedRequest("/-/app/preview/screen-with-patch", {
      workspaceId: "ws_test",
      screenId: "screen.home",
      viewMode: "json",
      patches: [{ op: "replace", path: "/views/screens/0/layout" }],
    }, createWorkspaceEnv());

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
  });

  it("requires an owner session", async () => {
    const unauthorized = await request(
      "/-/app/preview/screen-with-patch",
      {
        workspaceId: "ws_test",
        screenId: "screen.home",
        viewMode: "json",
        patches: [],
      },
      createWorkspaceEnv(),
    );

    expect(unauthorized.status).toBe(401);

    const nonOwnerToken = await createJWT("guest", secret, 3600);
    const forbidden = await request(
      "/-/app/preview/screen-with-patch",
      {
        workspaceId: "ws_test",
        screenId: "screen.home",
        viewMode: "json",
        patches: [],
      },
      createWorkspaceEnv(),
      { Authorization: bearer(nonOwnerToken) },
    );

    expect(forbidden.status).toBe(403);
  });
});
