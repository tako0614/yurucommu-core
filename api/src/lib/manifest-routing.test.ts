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

  it("invokes auth middleware for protected routes", async () => {
    clearManifestRouterCache();
    const manifest: AppManifest = {
      ...baseManifest,
      routes: [
        { id: "secure", method: "GET", path: "/secure", handler: "secure", auth: true },
      ],
    };
    const registry = AppHandlerRegistry.fromModule({
      secure: (c: any) => c.json({ authed: !!c.get("user") }),
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
