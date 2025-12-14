import { afterEach, describe, expect, it } from "vitest";
import { AppHandlerRegistry, type AppManifest } from "@takos/platform/app";
import {
  clearManifestRouterCache,
  createManifestRouter,
  isManifestRoutingEnabled,
  matchesManifestRoute,
  resolveManifestRouter,
  setActiveManifestLoader,
} from "./manifest-routing";
import { setBackendDataFactory, getDefaultDataFactory } from "../data";
import { setAppScriptLoader } from "./app-script-loader";

const createMockD1 = () => {
  const tables = new Map<string, Map<string, any>>();

  const getTable = (sql: string): string | null => {
    const match =
      sql.match(/FROM\s+"([^"]+)"/i) ??
      sql.match(/INTO\s+"([^"]+)"/i) ??
      sql.match(/UPDATE\s+"([^"]+)"/i) ??
      sql.match(/TABLE IF NOT EXISTS\s+"([^"]+)"/i);
    return match?.[1] ?? null;
  };

  const db: any = {
    prepare(sql: string) {
      const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();
      const table = getTable(sql);
      let bound: any[] = [];
      const stmt: any = {
        bind: (...args: any[]) => {
          bound = args;
          return stmt;
        },
        run: async () => {
          if (normalized.startsWith("CREATE TABLE IF NOT EXISTS")) {
            if (table && !tables.has(table)) tables.set(table, new Map());
            return { success: true };
          }
          if (normalized.startsWith("INSERT INTO")) {
            if (!table) throw new Error("missing table");
            if (!tables.has(table)) tables.set(table, new Map());
            const [id, data, createdAt, updatedAt] = bound;
            tables.get(table)!.set(String(id), {
              id: String(id),
              data,
              created_at: createdAt,
              updated_at: updatedAt,
            });
            return { meta: { changes: 1 } };
          }
          throw new Error(`Unsupported SQL for run(): ${sql}`);
        },
        all: async () => {
          if (!table) throw new Error("missing table");
          const store = tables.get(table) ?? new Map();
          if (normalized.startsWith("SELECT \"ID\", \"DATA\"")) {
            return { results: Array.from(store.values()) };
          }
          throw new Error(`Unsupported SQL for all(): ${sql}`);
        },
        first: async () => null,
      };
      return stmt;
    },
  };

  return db;
};

const baseManifest: Omit<AppManifest, "routes"> = {
  schemaVersion: "1.0",
  version: "1.0.0",
  views: { screens: [], insert: [] },
  ap: { handlers: [] },
  data: { collections: {} },
  storage: { buckets: {} },
};

const noopAuth = async (_c: any, next: () => Promise<void>) => next();

afterEach(() => {
  clearManifestRouterCache();
  setBackendDataFactory(getDefaultDataFactory());
  setAppScriptLoader(null);
  setActiveManifestLoader(null);
});

describe("manifest routing", () => {
  it("resolves handlers from the App Script registry", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      hello: (c: any) => c.json({ ok: true }),
    });

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_test",
      source: "test",
    });

    const response = await router.app.request("/hello", { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(matchesManifestRoute(router, "GET", "/hello")).toBe(true);
    expect(matchesManifestRoute(router, "POST", "/hello")).toBe(false);
  });

  it("matches embedded path params when checking manifest routing", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "tag", method: "GET", path: "/tag/@:name", handler: "tag" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      tag: (c: any) => c.json({ ok: true }),
    });

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_embed_param",
      source: "test",
    });

    expect(matchesManifestRoute(router, "GET", "/tag/@alice")).toBe(true);
  });

  it("never routes manifest handlers for core paths", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "actor_override", method: "GET", path: "/@alice", handler: "noop" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      noop: (c: any) => c.json({ ok: true }),
    });

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_core_block",
      source: "test",
    });

    expect(matchesManifestRoute(router, "GET", "/@alice")).toBe(false);
  });

  it("invokes auth middleware for protected routes", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [
        { id: "secure", method: "GET", path: "/secure", handler: "secure", auth: true },
      ],
    };
    const registry = AppHandlerRegistry.fromModule({
      secure: (ctx: any) => ctx.json({ authed: !!ctx.auth?.userId }),
    });

    let authCalls = 0;
    const authMiddleware = async (c: any, next: () => Promise<void>) => {
      authCalls += 1;
      c.set("user", { id: "user-1" });
      await next();
    };

    const router = createManifestRouter({
      manifest,
      registry,
      authMiddleware,
      revisionId: "rev_auth",
      source: "test",
    });

    const response = await router.app.request("/secure", { method: "GET" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authed: true });
    expect(authCalls).toBe(1);
    expect(matchesManifestRoute(router, "GET", "/secure")).toBe(true);
  });

  it("provides ctx.db(app:*) for manifest handlers (Collection API)", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [{ id: "db", method: "GET", path: "/db", handler: "db" }],
    };
    const registry = AppHandlerRegistry.fromModule({
      db: async (ctx: any) => {
        const notes = ctx.db("app:notes");
        const created = await notes.create({ title: "hello" });
        return ctx.json({ id: created.id, title: created.title });
      },
    });

    const router = createManifestRouter({
      manifest,
      registry,
      revisionId: "rev_db",
      source: "test",
    });

    const env: any = { DB: createMockD1() };
    const execCtx: any = { waitUntil: () => {}, passThroughOnException: () => {} };
    const res = await router.app.fetch(new Request("https://example.test/db"), env, execCtx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ title: "hello" });
    expect(typeof body.id).toBe("string");
  });

  it("honors the opt-in flag from environment variables", () => {
    expect(isManifestRoutingEnabled({ APP_ROUTES_FROM_MANIFEST: "1" })).toBe(true);
    expect(isManifestRoutingEnabled({ USE_APP_MANIFEST_ROUTES: "true" })).toBe(true);
    expect(isManifestRoutingEnabled({ APP_ROUTES_FROM_MANIFEST: "off" })).toBe(false);
  });

  it("refuses to mount when manifest validation fails", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_invalid",
            revision: {
              id: "rev_invalid",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "login_override", method: "GET", path: "/login", handler: "noop" }],
              }),
              script_snapshot_ref: "inline:noop",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { noop: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
    }));

    const router = await resolveManifestRouter({} as any, noopAuth as any);
    expect(router).toBeNull();
  });

  it("mounts when active revision and handlers are valid", async () => {
    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_ok",
            revision: {
              id: "rev_ok",
              schema_version: "1.0",
              manifest_snapshot: JSON.stringify({
                ...baseManifest,
                routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
              }),
              script_snapshot_ref: "inline:hello",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
    }));

    const router = await resolveManifestRouter({} as any, noopAuth as any);
    expect(router).not.toBeNull();
    const res = await router!.app.request("/hello", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("loads manifest snapshot from manifest_snapshot_ref stored in R2/VFS", async () => {
    const manifest: AppManifest = {
      ...baseManifest,
      schemaVersion: "1.10",
      routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
    };

    const bucket = {
      async get(key: string) {
        if (key === "manifests/prod.json") {
          return { text: async () => JSON.stringify(manifest) };
        }
        return null;
      },
      async list() {
        return { objects: [] };
      },
    };

    setBackendDataFactory(
      () =>
        ({
          getActiveAppRevision: async () => ({
            active_revision_id: "rev_r2",
            revision: {
              id: "rev_r2",
              schema_version: "1.10",
              manifest_snapshot_ref: "r2:manifests/prod.json",
              script_snapshot_ref: "inline:hello",
            },
          }),
        }) as any,
    );
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "test-inline",
    }));

    const router = await resolveManifestRouter({ APP_MANIFESTS: bucket } as any, noopAuth as any);
    expect(router).not.toBeNull();
    expect(router?.source).toBe("r2:manifests/prod.json");
    const res = await router!.app.request("/hello", { method: "GET" });
    expect(res.status).toBe(200);
  });

  it("supports custom manifest loader for child worker/RPC scenarios", async () => {
    const manifest: AppManifest = {
      ...baseManifest,
      schemaVersion: "1.10",
      routes: [{ id: "hello", method: "GET", path: "/hello", handler: "hello" }],
    };

    setActiveManifestLoader(async () => ({
      snapshot: {
        revisionId: "rev_custom",
        manifest,
        source: "rpc",
        scriptRef: "inline:hello",
      },
      issues: [],
    }));
    setAppScriptLoader(async () => ({
      module: { hello: () => ({ type: "json", status: 200, body: { ok: true } }) } as any,
      source: "custom-inline",
    }));

    const router = await resolveManifestRouter({} as any, noopAuth as any);
    expect(router).not.toBeNull();
    expect(router?.revisionId).toBe("rev_custom");
    expect(router?.source).toBe("rpc");
  });
});
