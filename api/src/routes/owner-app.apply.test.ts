import { afterEach, describe, expect, it } from "vitest";
import ownerAppRoutes from "./owner-app";
import { getDefaultDataFactory, setBackendDataFactory } from "../data";
import { setWorkspaceLoader } from "../lib/app-workspace";

const authEnv = {
  AUTH_USERNAME: "admin",
  AUTH_PASSWORD: "secret",
  DEV_DB: {},
  DEV_MEDIA: {},
  DEV_KV: {},
};
const authHeader = `Basic ${Buffer.from("admin:secret").toString("base64")}`;
const defaultFactory = getDefaultDataFactory();

afterEach(() => {
  setBackendDataFactory(defaultFactory);
  setWorkspaceLoader(null);
});

describe("/admin/app/revisions/apply (workspace)", () => {
  it("builds and activates an app revision from a validated workspace", async () => {
    const manifest = {
      schema_version: "1.0",
      routes: [{ id: "route.home", method: "GET", path: "/", handler: "homeHandler" }],
      views: {
        screens: [{ id: "screen.home", route: "/", layout: { type: "Stack" } }],
        insert: [],
      },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };

    const revisions: Record<string, any> = {};
    let activeId: string | null = null;

    setWorkspaceLoader(async (id) =>
      id === "ws_test"
        ? {
            id: "ws_test",
            status: "validated",
            manifest,
            scriptRef: "bundle:demo",
            validatedAt: "2024-12-01T00:00:00Z",
            validationIssues: [],
          }
        : null,
    );

    setBackendDataFactory(
      () =>
        ({
          createAppRevision: async (input: any) => {
            const id = input.id ?? "rev_generated";
            const saved = { ...input, id };
            revisions[id] = saved;
            return saved;
          },
          getAppRevision: async (id: string) => revisions[id] ?? null,
          setActiveAppRevision: async (id: string) => {
            activeId = id;
          },
          getActiveAppRevision: async () => ({
            active_revision_id: activeId,
            updated_at: new Date().toISOString(),
            revision: activeId ? revisions[activeId] : null,
          }),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/apply",
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "ws_test",
          message: "Promote workspace",
          handlers: ["homeHandler"],
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.workspace?.id).toBe("ws_test");
    expect(json.data.active_revision_id).toBe(json.data.revision.id);
    const snapshot = JSON.parse(json.data.revision.manifest_snapshot);
    expect(snapshot.routes[0].id).toBe("route.home");
    expect(snapshot.views.screens[0].id).toBe("screen.home");
  });

  it("rejects a workspace that is not ready for apply", async () => {
    const manifest = {
      schema_version: "1.0",
      routes: [],
      views: { screens: [], insert: [] },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };

    setWorkspaceLoader(async (id) =>
      id === "ws_bad"
        ? {
            id: "ws_bad",
            status: "draft",
            manifest,
            scriptRef: "",
            validatedAt: null,
            validationIssues: [{ severity: "error", message: "missing script" }],
          }
        : null,
    );

    setBackendDataFactory(
      () =>
        ({
          createAppRevision: async () => null,
          getAppRevision: async () => null,
          setActiveAppRevision: async () => {},
          getActiveAppRevision: async () => ({
            active_revision_id: null,
            revision: null,
            updated_at: new Date().toISOString(),
          }),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/apply",
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws_bad" }),
      },
      authEnv,
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toBe("workspace_validation_failed");
  });
});

describe("/admin/app/revisions/apply/diff", () => {
  it("returns a diff between the workspace manifest and the active revision", async () => {
    const prodManifest = {
      schema_version: "1.0",
      routes: [],
      views: { screens: [], insert: [] },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };
    const workspaceManifest = {
      schema_version: "1.0",
      routes: [{ id: "route.home", method: "GET", path: "/", handler: "homeHandler" }],
      views: {
        screens: [{ id: "screen.home", route: "/", layout: { type: "Stack" } }],
        insert: [],
      },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };

    setWorkspaceLoader(async (id) =>
      id === "ws_diff"
        ? {
            id: "ws_diff",
            status: "validated",
            manifest: workspaceManifest,
            scriptRef: "bundle:v2",
            validatedAt: "2024-12-01T00:00:00Z",
            validationIssues: [],
          }
        : null,
    );

    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_current",
            updated_at: "2024-12-01T00:00:00Z",
            revision: {
              id: "rev_current",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify(prodManifest),
              script_snapshot_ref: "bundle:v1",
            },
          }),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/apply/diff",
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws_diff", handlers: ["homeHandler"] }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data?.active_revision_id).toBe("rev_current");
    expect(json.data?.diff?.sections?.routes?.added?.[0]?.id).toBe("route.home");
    expect(json.data?.diff?.script_snapshot?.changed).toBe(true);
    expect(json.data?.workspace?.id).toBe("ws_diff");
  });

  it("fails when there is no active revision to diff against", async () => {
    const workspaceManifest = {
      schema_version: "1.0",
      routes: [{ id: "route.home", method: "GET", path: "/", handler: "homeHandler" }],
      views: {
        screens: [{ id: "screen.home", route: "/", layout: { type: "Stack" } }],
        insert: [],
      },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };

    setWorkspaceLoader(async (id) =>
      id === "ws_missing"
        ? {
            id: "ws_missing",
            status: "validated",
            manifest: workspaceManifest,
            scriptRef: "bundle:v2",
            validatedAt: "2024-12-01T00:00:00Z",
            validationIssues: [],
          }
        : null,
    );

    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: null,
            revision: null,
            updated_at: "2024-12-01T00:00:00Z",
          }),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/apply/diff",
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: "ws_missing", handlers: ["homeHandler"] }),
      },
      authEnv,
    );

    expect(res.status).toBe(404);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(String(json.error || json.message || "")).toMatch(/active app revision/i);
  });
});

describe("/admin/app/revisions/:id/rollback", () => {
  it("rejects rollback when the target schema_version is incompatible with the active revision", async () => {
    let activeId = "rev-current";
    const revisions: Record<string, any> = {
      "rev-current": {
        id: "rev-current",
        schema_version: "2.0.0",
        manifest_snapshot: "{}",
        script_snapshot_ref: "current",
      },
      "rev-target": {
        id: "rev-target",
        schema_version: "1.0.0",
        manifest_snapshot: "{}",
        script_snapshot_ref: "target",
      },
    };

    setBackendDataFactory(
      () =>
        ({
          getAppRevision: async (id: string) => revisions[id] ?? null,
          setActiveAppRevision: async (id: string) => {
            activeId = id;
          },
          getActiveAppRevision: async () => ({
            active_revision_id: activeId,
            updated_at: new Date().toISOString(),
            revision: revisions[activeId],
          }),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/rev-target/rollback",
      { method: "POST", headers: { Authorization: authHeader } },
      authEnv,
    );

    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.ok).toBe(false);
    expect(String(json.error)).toContain("not compatible");
  });

  it("rolls back and reports schema compatibility warnings", async () => {
    let activeId = "rev-current";
    const revisions: Record<string, any> = {
      "rev-current": {
        id: "rev-current",
        schema_version: "1.0.0",
        manifest_snapshot: "{}",
        script_snapshot_ref: "current",
      },
      "rev-next": {
        id: "rev-next",
        schema_version: "1.1.0",
        manifest_snapshot: "{}",
        script_snapshot_ref: "next",
      },
    };

    setBackendDataFactory(
      () =>
        ({
          getAppRevision: async (id: string) => revisions[id] ?? null,
          setActiveAppRevision: async (id: string) => {
            activeId = id;
          },
          getActiveAppRevision: async () => ({
            active_revision_id: activeId,
            updated_at: new Date().toISOString(),
            revision: revisions[activeId],
          }),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/rev-next/rollback",
      { method: "POST", headers: { Authorization: authHeader } },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.active_revision_id).toBe("rev-next");
    expect((json.data.warnings || []).some((w: string) => w.includes("minor version differs"))).toBe(
      true,
    );
    expect(json.data.audit.schema_version.previous_active.from).toBe("1.0.0");
    expect(json.data.audit.schema_version.previous_active.to).toBe("1.1.0");
    expect(json.data.audit.to_revision_id).toBe("rev-next");
  });
});

describe("app revision audit logging", () => {
  it("records apply audit entries with schema check and workspace link and exposes them via listing", async () => {
    const manifest = {
      schema_version: "1.0",
      routes: [{ id: "route.home", method: "GET", path: "/", handler: "homeHandler" }],
      views: {
        screens: [{ id: "screen.home", route: "/", layout: { type: "Stack" } }],
        insert: [],
      },
      ap: { handlers: [] },
      data: { collections: {} },
      storage: { buckets: {} },
    };

    const revisions: Record<string, any> = {};
    let activeId: string | null = null;
    const audits: any[] = [];

    setWorkspaceLoader(async (id) =>
      id === "ws_audit"
        ? {
            id: "ws_audit",
            status: "validated",
            manifest,
            scriptRef: "bundle:audit",
            validatedAt: "2024-12-02T00:00:00Z",
            validationIssues: [],
          }
        : null,
    );

    setBackendDataFactory(
      () =>
        ({
          createAppRevision: async (input: any) => {
            const id = input.id ?? "rev_audit";
            const saved = { ...input, id };
            revisions[id] = saved;
            return saved;
          },
          getAppRevision: async (id: string) => revisions[id] ?? null,
          setActiveAppRevision: async (id: string) => {
            activeId = id;
          },
          getActiveAppRevision: async () => ({
            active_revision_id: activeId,
            updated_at: new Date().toISOString(),
            revision: activeId ? revisions[activeId] : null,
          }),
          recordAppRevisionAudit: async (entry: any) => {
            const record = {
              id: audits.length + 1,
              action: entry.action,
              revision_id: entry.revision_id,
              workspace_id: entry.workspace_id ?? null,
              result: entry.result ?? "success",
              details: entry.details ?? null,
              created_at: entry.created_at ?? new Date().toISOString(),
            };
            audits.push(record);
            return record;
          },
          listAppRevisionAudit: async (limit = 50) => audits.slice(0, limit),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/apply",
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: "ws_audit",
          message: "Audit apply",
          handlers: ["homeHandler"],
        }),
      },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.audit.workspace?.id).toBe("ws_audit");
    expect(json.data.audit.schema_version.platform.actual).toBe("1.0");
    expect(audits.length).toBe(1);
    expect(audits[0].workspace_id).toBe("ws_audit");
    expect(audits[0].details?.schema_version?.platform?.ok).toBe(true);

    const listRes = await ownerAppRoutes.request(
      "/admin/app/revisions/audit",
      { method: "GET", headers: { Authorization: authHeader } },
      authEnv,
    );
    const listJson: any = await listRes.json();
    expect(listJson.ok).toBe(true);
    expect(listJson.data.entries[0].workspace_id).toBe("ws_audit");
    expect(listJson.data.entries[0].details.schema_version.platform.actual).toBe("1.0");
  });

  it("records rollback audits with schema compatibility results", async () => {
    let activeId = "rev-current";
    const revisions: Record<string, any> = {
      "rev-current": {
        id: "rev-current",
        schema_version: "1.0.0",
        manifest_snapshot: "{}",
        script_snapshot_ref: "current",
      },
      "rev-next": {
        id: "rev-next",
        schema_version: "1.1.0",
        manifest_snapshot: "{}",
        script_snapshot_ref: "next",
      },
    };
    const audits: any[] = [];

    setBackendDataFactory(
      () =>
        ({
          getAppRevision: async (id: string) => revisions[id] ?? null,
          setActiveAppRevision: async (id: string) => {
            activeId = id;
          },
          getActiveAppRevision: async () => ({
            active_revision_id: activeId,
            updated_at: new Date().toISOString(),
            revision: revisions[activeId],
          }),
          recordAppRevisionAudit: async (entry: any) => {
            const record = {
              id: audits.length + 1,
              action: entry.action,
              revision_id: entry.revision_id,
              workspace_id: entry.workspace_id ?? null,
              result: entry.result ?? "success",
              details: entry.details ?? null,
              created_at: entry.created_at ?? new Date().toISOString(),
            };
            audits.push(record);
            return record;
          },
          listAppRevisionAudit: async (limit = 50) => audits.slice(0, limit),
        }) as any,
    );

    const res = await ownerAppRoutes.request(
      "/admin/app/revisions/rev-next/rollback",
      { method: "POST", headers: { Authorization: authHeader } },
      authEnv,
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(audits.length).toBe(1);
    expect(audits[0].revision_id).toBe("rev-next");
    expect(audits[0].details?.schema_version?.previous_active?.from).toBe("1.0.0");

    const listRes = await ownerAppRoutes.request(
      "/admin/app/revisions/audit",
      { method: "GET", headers: { Authorization: authHeader } },
      authEnv,
    );
    const listJson: any = await listRes.json();
    expect(listJson.ok).toBe(true);
    const entry = listJson.data.entries[0];
    expect(entry.revision_id).toBe("rev-next");
    expect(entry.details.schema_version.previous_active.to).toBe("1.1.0");
  });
});
