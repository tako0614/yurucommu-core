import { describe, expect, it } from "vitest";
import type { AppManifest } from "./types";
import { mountManifestRoutes } from "./manifest-router";

const baseManifest: Omit<AppManifest, "routes"> = {
  schemaVersion: "1.0",
  version: "1.0.0",
  views: { screens: [], insert: [] },
  ap: { handlers: [] },
  data: { collections: {} },
  storage: { buckets: {} },
};

const makeManifest = (routes: AppManifest["routes"]): AppManifest => ({
  ...baseManifest,
  routes,
});

describe("mountManifestRoutes", () => {
  it("mounts routes from manifest and invokes handlers", async () => {
    const manifest = makeManifest([
      { id: "hello", method: "GET", path: "/hello", handler: "helloHandler" },
    ]);
    const handlers = {
      helloHandler: (c: any) => c.text("hi"),
    };

    const result = mountManifestRoutes({ manifest, handlers, basePath: "/v1" });
    expect(result.issues).toHaveLength(0);

    const res = await result.app.request("/v1/hello", { method: "GET" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("hi");
  });

  it("applies auth middleware when route requires auth", async () => {
    let authCalls = 0;
    const manifest = makeManifest([
      { id: "secure", method: "GET", path: "/secure", handler: "secureHandler", auth: true },
    ]);
    const handlers = {
      secureHandler: (c: any) => c.json({ authed: !!c.get("user") }),
    };
    const authMiddleware = async (c: any, next: () => Promise<void>) => {
      authCalls += 1;
      c.set("user", { id: "user-1" });
      await next();
    };

    const result = mountManifestRoutes({ manifest, handlers, authMiddleware });
    expect(result.issues).toHaveLength(0);

    const res = await result.app.request("/secure", { method: "GET" });
    expect(res.status).toBe(200);
    expect(authCalls).toBe(1);
    expect(await res.json()).toEqual({ authed: true });
  });

  it("reports missing handlers and leaves route unmounted", async () => {
    const manifest = makeManifest([
      { id: "missing", method: "GET", path: "/missing", handler: "notThere" },
    ]);

    const result = mountManifestRoutes({ manifest, handlers: {} });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("handler_not_found");

    const res = await result.app.request("/missing", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("reports missing auth middleware for protected routes", async () => {
    const manifest = makeManifest([
      { id: "protected", method: "GET", path: "/protected", handler: "secureHandler", auth: true },
    ]);
    const handlers = {
      secureHandler: (c: any) => c.text("ok"),
    };

    const result = mountManifestRoutes({ manifest, handlers });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("auth_middleware_missing");

    const res = await result.app.request("/protected", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("reports invalid handler values", async () => {
    const manifest = makeManifest([
      { id: "broken", method: "GET", path: "/broken", handler: "brokenHandler" },
    ]);
    const handlers = {
      brokenHandler: "notAFunction" as any,
    };

    const result = mountManifestRoutes({ manifest, handlers });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("handler_not_function");

    const res = await result.app.request("/broken", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("rejects reserved routes at runtime", async () => {
    const manifest = makeManifest([
      { id: "login", method: "GET", path: "/login", handler: "loginHandler" },
    ]);
    const handlers = {
      loginHandler: (c: any) => c.text("nope"),
    };

    const result = mountManifestRoutes({ manifest, handlers });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("reserved_route");

    const res = await result.app.request("/login", { method: "GET" });
    expect(res.status).toBe(404);
  });

  it("rejects core route overlaps at runtime", async () => {
    const manifest = makeManifest([
      { id: "user_profile", method: "GET", path: "/@alice", handler: "userHandler" },
    ]);
    const handlers = {
      userHandler: (c: any) => c.text("nope"),
    };

    const result = mountManifestRoutes({ manifest, handlers });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].type).toBe("core_route");

    const res = await result.app.request("/@alice", { method: "GET" });
    expect(res.status).toBe(404);
  });
});
