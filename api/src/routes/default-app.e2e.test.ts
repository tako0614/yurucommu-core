/**
 * E2E-style smoke tests for the default app executed via app-api.ts.
 *
 * This exercises the full chain:
 * /-/apps/:appId/api/* -> appApiRouter -> TakosApp.fetch -> env.fetch (Core API) -> Response
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mapErrorToResponse } from "../lib/observability";
import { appApiRouter } from "./app-api";
import defaultApp from "../../../app/default/src/server";

type MockR2Object = {
  text: () => Promise<string>;
  body: ReadableStream | null;
};

function createMockR2() {
  const files = new Map<string, MockR2Object>();
  return {
    _files: files,
    get: vi.fn(async (key: string) => files.get(key) ?? null),
  };
}

function createMockKV() {
  return {
    get: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => ({ keys: [] })),
  };
}

function createMockBindings() {
  const APP_MANIFESTS = createMockR2();
  APP_MANIFESTS._files.set("apps/default/manifest.json", {
    text: async () =>
      JSON.stringify({
        schema_version: "2.0",
        id: "default",
        name: "takos Default App",
        version: "1.0.0",
        entry: { server: "dist/server.js", client: "dist/client.js" },
      }),
    body: null,
  });

  return {
    DB: {} as any,
    KV: createMockKV(),
    APP_STATE: createMockKV(),
    MEDIA: createMockR2(),
    APP_MANIFESTS,
    APP_MODULES: {
      default: defaultApp,
    },
    INSTANCE_DOMAIN: "test.example.com",
  };
}

function createTestApp() {
  const app = new Hono();

  app.onError((error, c) => mapErrorToResponse(error, { env: c.env }));

  app.use("*", async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      if (token === "valid-token") {
        c.set("userId", "test-user");
        c.set("handle", "testuser");
      }
    }
    await next();
  });

  app.route("/-/apps", appApiRouter);
  return app;
}

describe("default app E2E smoke", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves /api/timeline/home via app-api router", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname !== "/objects/timeline") {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer valid-token");
      expect(url.searchParams.get("limit")).toBe("2");
      return Response.json({
        items: [
          { id: "obj-1", type: "Note", content: "hello", actor: "test-user" },
          { id: "obj-2", type: "Note", content: "world", actor: "test-user" },
        ],
        next_cursor: null,
      });
    });

    const res = await app.request(
      "/-/apps/default/api/timeline/home?limit=2",
      { method: "GET", headers: { Authorization: "Bearer valid-token" } },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.items).toHaveLength(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

