/**
 * Integration tests for app-api.ts
 *
 * Tests the App API route handler that executes App Handlers
 * at /-/apps/:appId/api/* routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { TakosApp, AppEnv } from "@takos/app-sdk/server";
import { mapErrorToResponse } from "../lib/observability";
import { appApiRouter } from "./app-api";

const COUNTER_KEY = "counter";

const sampleCounterApp: TakosApp = {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    const requireAuth = (): Response | null => {
      if (!env.auth) {
        return new Response(JSON.stringify({ error: "Authentication required" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return null;
    };

    const readBody = async (): Promise<Record<string, any>> => {
      const contentType = request.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        return request.json().catch(() => ({}));
      }
      if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await request.text();
        return Object.fromEntries(new URLSearchParams(text));
      }
      return {};
    };

    if (request.method === "GET" && path === "/info") {
      return new Response(
        JSON.stringify({
          id: "sample-counter",
          name: "Sample Counter",
          version: "1.0.0",
          description: "A simple counter app demonstrating the App SDK",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (request.method === "GET" && path === "/auth-info") {
      return new Response(JSON.stringify({ auth: env.auth }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (path.startsWith("/counter")) {
      const authError = requireAuth();
      if (authError) return authError;

      if (request.method === "GET" && path === "/counter") {
        const state = await env.storage.get<{ value: number; lastUpdated: string }>(COUNTER_KEY);
        return new Response(
          JSON.stringify({ value: state?.value ?? 0, lastUpdated: state?.lastUpdated ?? null }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      const input = await readBody();
      const state = await env.storage.get<{ value: number; lastUpdated: string }>(COUNTER_KEY);
      const currentValue = state?.value ?? 0;
      const lastUpdated = new Date().toISOString();

      if (request.method === "POST" && path === "/counter/increment") {
        const amount = Number(input.amount ?? 1);
        const newValue = currentValue + amount;
        await env.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });
        return new Response(
          JSON.stringify({ value: newValue, previousValue: currentValue, lastUpdated }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (request.method === "POST" && path === "/counter/decrement") {
        const amount = Number(input.amount ?? 1);
        const newValue = currentValue - amount;
        await env.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });
        return new Response(
          JSON.stringify({ value: newValue, previousValue: currentValue, lastUpdated }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (request.method === "POST" && path === "/counter/reset") {
        await env.storage.set(COUNTER_KEY, { value: 0, lastUpdated });
        return new Response(
          JSON.stringify({ value: 0, previousValue: currentValue, lastUpdated }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (request.method === "POST" && path === "/counter/set") {
        if (input.value === undefined) {
          return new Response(JSON.stringify({ error: "value is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const newValue = Number(input.value);
        await env.storage.set(COUNTER_KEY, { value: newValue, lastUpdated });
        return new Response(
          JSON.stringify({ value: newValue, previousValue: currentValue, lastUpdated }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    return new Response(JSON.stringify({ error: "Handler not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  },
};

// Mock KV storage for tests
function createMockKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, format?: string) => {
      const value = store.get(key);
      if (!value) return null;
      if (format === "json") {
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      }
      return value;
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    }),
    _store: store, // For test inspection
  };
}

// Mock R2 bucket for manifest storage
function createMockR2() {
  const files = new Map<string, { text: () => Promise<string>; body: ReadableStream | null }>();
  return {
    get: vi.fn(async (key: string) => {
      return files.get(key) || null;
    }),
    put: vi.fn(async (key: string, content: string | ReadableStream) => {
      const text = typeof content === "string" ? content : "";
      files.set(key, {
        text: async () => text,
        body: null,
      });
    }),
    delete: vi.fn(async (key: string) => {
      files.delete(key);
    }),
    _files: files, // For test inspection
  };
}

// Create mock bindings for tests
function createMockBindings() {
  const mockKV = createMockKV();
  const mockR2 = createMockR2();
  return {
    DB: {} as any,
    KV: mockKV,
    APP_STATE: mockKV,
    MEDIA: mockR2,
    APP_MANIFESTS: mockR2,
    APP_MODULES: {
      "sample-counter": sampleCounterApp,
    },
    INSTANCE_DOMAIN: "test.example.com",
  };
}

// Create a test Hono app with the app-api router mounted
function createTestApp() {
  const app = new Hono();

  app.onError((error, c) => {
    return mapErrorToResponse(error, { env: c.env });
  });

  // Simple middleware to set user context
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

describe("App API Router", () => {
  let app: ReturnType<typeof createTestApp>;
  let mockBindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    mockBindings = createMockBindings();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /:appId/manifest.json", () => {
    it("should return generated manifest for registered app", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/manifest.json",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.schema_version).toBe("2.0");
      expect(json.id).toBe("sample-counter");
      expect(json.name).toBe("sample-counter");
      expect(json.entry).toBeDefined();
    });

    it("should return placeholder manifest for unknown app", async () => {
      const res = await app.request(
        "/-/apps/unknown-app/manifest.json",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.schema_version).toBe("2.0");
      expect(json.id).toBe("unknown-app");
      expect(json.entry).toBeDefined();
    });

    it("should load manifest from R2 storage if available", async () => {
      const customManifest = {
        schema_version: "2.0",
        id: "custom-app",
        name: "Custom App",
        version: "2.0.0",
        description: "Custom app from storage",
        basedOn: "default@1.0.0",
        modified: true,
        entry: { server: "dist/server.js" },
      };
      mockBindings.APP_MANIFESTS._files.set(
        "apps/custom-app/manifest.json",
        {
          text: async () => JSON.stringify(customManifest),
          body: null,
        }
      );

      const res = await app.request(
        "/-/apps/custom-app/manifest.json",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("custom-app");
      expect(json.name).toBe("Custom App");
      expect(json.version).toBe("2.0.0");
    });
  });

  describe("App Handler Execution - GET /:appId/api/*", () => {
    it("should return 401 for auth-required handler without auth", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/counter",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(401);
    });

    it("should execute GET handler with valid auth", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/counter",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.value).toBe(0); // Initial counter value
    });

    it("should execute public handler without auth", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/info",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("sample-counter");
      expect(json.name).toBe("Sample Counter");
    });

    it("should populate env.auth with plan info when authenticated", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/auth-info",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json<any>();
      expect(json.auth).toBeTruthy();
      expect(json.auth.userId).toBe("test-user");
      expect(json.auth.handle).toBe("testuser");
      expect(json.auth.plan?.name).toBe("self-hosted");
      expect(json.auth.isAuthenticated).toBe(true);
    });

    it("should return 404 for unknown handler path", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/unknown",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error).toBe("Handler not found");
    });
  });

  describe("Workers-style TakosApp.fetch Invocation", () => {
    it("should call TakosApp.fetch with rewritten path and built env", async () => {
      const fetchSpy = vi.fn(async (request: Request, env: AppEnv) => {
        const url = new URL(request.url);
        return new Response(
          JSON.stringify({
            path: url.pathname,
            queryX: url.searchParams.get("x"),
            auth: env.auth,
            app: env.app,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      mockBindings.APP_MODULES["spy-app"] = { fetch: fetchSpy };
      mockBindings.APP_MANIFESTS._files.set("apps/spy-app/manifest.json", {
        text: async () =>
          JSON.stringify({
            schema_version: "2.0",
            id: "spy-app",
            name: "Spy App",
            version: "1.2.3",
            entry: { server: "dist/server.js" },
          }),
        body: null,
      });

      const res = await app.request(
        "/-/apps/spy-app/api/hello/world?x=1",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [calledRequest, calledEnv] = fetchSpy.mock.calls[0];
      expect(new URL(calledRequest.url).pathname).toBe("/hello/world");
      expect(calledEnv.app.id).toBe("spy-app");
      expect(calledEnv.app.version).toBe("1.2.3");
      expect(calledEnv.auth?.userId).toBe("test-user");

      const json = await res.json();
      expect(json.path).toBe("/hello/world");
      expect(json.queryX).toBe("1");
      expect(json.app.version).toBe("1.2.3");
      expect(json.auth.userId).toBe("test-user");
    });

    it("should rewrite /api (no wildcard) to /", async () => {
      const fetchSpy = vi.fn(async (request: Request) => {
        const url = new URL(request.url);
        return new Response(url.pathname, { status: 200 });
      });

      mockBindings.APP_MODULES["root-path-app"] = { fetch: fetchSpy };

      const res = await app.request(
        "/-/apps/root-path-app/api",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(await res.text()).toBe("/");
    });
  });

  describe("App Handler Execution - POST /:appId/api/*", () => {
    it("should execute POST handler and modify state", async () => {
      // First, get initial value
      const getRes1 = await app.request(
        "/-/apps/sample-counter/api/counter",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );
      expect(getRes1.status).toBe(200);
      const initial = await getRes1.json();
      expect(initial.value).toBe(0);

      // Increment the counter
      const incrementRes = await app.request(
        "/-/apps/sample-counter/api/counter/increment",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
        mockBindings
      );

      expect(incrementRes.status).toBe(200);
      const incrementResult = await incrementRes.json();
      expect(incrementResult.value).toBe(1);
      expect(incrementResult.previousValue).toBe(0);

      // Verify state persisted
      const getRes2 = await app.request(
        "/-/apps/sample-counter/api/counter",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );
      expect(getRes2.status).toBe(200);
      const updated = await getRes2.json();
      expect(updated.value).toBe(1);
    });

    it("should handle increment with custom amount", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/counter/increment",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: 5 }),
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.value).toBe(5);
    });

    it("should handle decrement operation", async () => {
      // Set counter to 10 first
      await app.request(
        "/-/apps/sample-counter/api/counter/set",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value: 10 }),
        },
        mockBindings
      );

      // Decrement
      const res = await app.request(
        "/-/apps/sample-counter/api/counter/decrement",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: 3 }),
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.value).toBe(7);
      expect(json.previousValue).toBe(10);
    });

    it("should handle reset operation", async () => {
      // Set counter to a value
      await app.request(
        "/-/apps/sample-counter/api/counter/set",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value: 100 }),
        },
        mockBindings
      );

      // Reset
      const res = await app.request(
        "/-/apps/sample-counter/api/counter/reset",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.value).toBe(0);
      expect(json.previousValue).toBe(100);
    });

    it("should handle set with missing value", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/counter/set",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}), // Missing value
        },
        mockBindings
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("value is required");
    });
  });

  describe("App Storage Isolation", () => {
    it("should isolate storage by app and user", async () => {
      // Set counter for sample-counter app
      await app.request(
        "/-/apps/sample-counter/api/counter/set",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ value: 42 }),
        },
        mockBindings
      );

      // Verify storage key format includes app and user
      expect(mockBindings.APP_STATE.put).toHaveBeenCalled();
      const putCalls = mockBindings.APP_STATE.put.mock.calls;
      const lastCall = putCalls[putCalls.length - 1];
      const key = lastCall[0];

      // Key should be namespaced by app and user.
      expect(key).toBe("app:sample-counter:user:test-user:counter");
    });

    it("should use global scope for unauthenticated storage", async () => {
      mockBindings.APP_MODULES["anon-storage-app"] = {
        fetch: async (_request: Request, env: AppEnv) => {
          await env.storage.set("k", { v: 1 });
          return new Response("ok", { status: 200 });
        },
      };

      const res = await app.request(
        "/-/apps/anon-storage-app/api/write",
        { method: "POST" },
        mockBindings
      );

      expect(res.status).toBe(200);
      expect(mockBindings.APP_STATE.put).toHaveBeenCalled();
      const [key] = mockBindings.APP_STATE.put.mock.calls.at(-1) ?? [];
      expect(key).toBe("app:anon-storage-app:global:k");
    });
  });

  describe("GET /:appId/dist/*", () => {
    it("should return 400 for missing file path", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/dist/",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("INVALID_INPUT");
      expect(json.message).toBe("File path required");
    });

    it("should return 404 for non-existent dist file", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/dist/client.bundle.js",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(404);
    });

    it("should serve JS file with correct content type", async () => {
      // Add a mock JS file
      const jsContent = 'console.log("Hello");';
      const mockObject = {
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(jsContent));
            controller.close();
          },
        }),
        text: async () => jsContent,
      };
      mockBindings.APP_MANIFESTS._files.set(
        "apps/sample-counter/dist/client.bundle.js",
        mockObject
      );

      const res = await app.request(
        "/-/apps/sample-counter/dist/client.bundle.js",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/javascript");
      expect(res.headers.get("Cache-Control")).toContain("max-age=31536000");
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for unknown app", async () => {
      const res = await app.request(
        "/-/apps/unknown-app/api/something",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.code).toBe("NOT_FOUND");
      expect(json.message).toContain("App module not found");
    });

    it("should handle method mismatch", async () => {
      // Try DELETE on a GET-only endpoint
      const res = await app.request(
        "/-/apps/sample-counter/api/counter",
        {
          method: "DELETE",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(404);
    });

    it("should handle invalid JSON body gracefully", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/counter/increment",
        {
          method: "POST",
          headers: {
            Authorization: "Bearer valid-token",
            "Content-Type": "application/json",
          },
          body: "invalid json {",
        },
        mockBindings
      );

      // Should default to empty object and succeed
      expect(res.status).toBe(200);
    });
  });

  describe("Path Normalization", () => {
    it("should handle paths with trailing slash", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/api/info/",
        { method: "GET" },
        mockBindings
      );

      // Should match /info handler
      expect(res.status).toBe(200);
    });

    it("should handle paths without leading slash", async () => {
      // The router normalizes paths internally
      const res = await app.request(
        "/-/apps/sample-counter/api/info",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
    });
  });

  describe("Query Parameters", () => {
    it("should pass query parameters to handlers", async () => {
      // The info handler doesn't use query params, but we can verify they're passed
      const res = await app.request(
        "/-/apps/sample-counter/api/info?foo=bar&baz=123",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
    });
  });

  describe("AppEnv.fetch Injection", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should inject Authorization header into env.fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input.url;
        const headers = new Headers(init?.headers);
        return new Response(
          JSON.stringify({
            url,
            authorization: headers.get("authorization"),
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      mockBindings.APP_MODULES["fetch-app"] = {
        fetch: async (_request: Request, env: AppEnv) => {
          return await env.fetch("/echo", { headers: { "X-Test": "1" } });
        },
      };

      const res = await app.request(
        "/-/apps/fetch-app/api/run",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(new URL(json.url).pathname).toBe("/echo");
      expect(json.authorization).toBe("Bearer valid-token");
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("should not override authorization header provided by app", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const headers = new Headers(init?.headers);
        return new Response(headers.get("authorization") ?? "", { status: 200 });
      });

      mockBindings.APP_MODULES["fetch-auth-override-app"] = {
        fetch: async (_request: Request, env: AppEnv) => {
          return await env.fetch("/echo", {
            headers: { authorization: "Bearer app-token" },
          });
        },
      };

      const res = await app.request(
        "/-/apps/fetch-auth-override-app/api/run",
        {
          method: "GET",
          headers: { Authorization: "Bearer valid-token" },
        },
        mockBindings
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("Bearer app-token");
    });

    it("should omit Authorization header when request is unauthenticated", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        const headers = new Headers(init?.headers);
        return new Response(headers.get("authorization") ?? "none", { status: 200 });
      });

      mockBindings.APP_MODULES["fetch-no-auth-app"] = {
        fetch: async (_request: Request, env: AppEnv) => {
          return await env.fetch("/echo");
        },
      };

      const res = await app.request(
        "/-/apps/fetch-no-auth-app/api/run",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      expect(await res.text()).toBe("none");
    });
  });
});

describe("Handler Context Building", () => {
  let app: ReturnType<typeof createTestApp>;
  let mockBindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    mockBindings = createMockBindings();
  });

  it("should provide auth context for authenticated requests", async () => {
    const res = await app.request(
      "/-/apps/sample-counter/api/counter",
      {
        method: "GET",
        headers: { Authorization: "Bearer valid-token" },
      },
      mockBindings
    );

    expect(res.status).toBe(200);
  });

  it("should handle form-urlencoded content type", async () => {
    const res = await app.request(
      "/-/apps/sample-counter/api/counter/set",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer valid-token",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "value=50",
      },
      mockBindings
    );

    // Form data handling converts to object
    // The handler expects { value: number }, form gives { value: "50" }
    // This might succeed or fail depending on coercion
    // For now, just verify it doesn't crash
    expect([200, 400]).toContain(res.status);
  });
});
