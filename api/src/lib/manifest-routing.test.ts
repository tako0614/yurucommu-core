import { describe, expect, it } from "vitest";
import { AppHandlerRegistry, type AppManifest } from "@takos/platform/app";
import {
  clearManifestRouterCache,
  createManifestRouter,
  isManifestRoutingEnabled,
  matchesManifestRoute,
} from "./manifest-routing";

const baseManifest: Omit<AppManifest, "routes"> = {
  schemaVersion: "1.0",
  version: "1.0.0",
  views: { screens: [], insert: [] },
  ap: { handlers: [] },
  data: { collections: {} },
  storage: { buckets: {} },
};

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
});
