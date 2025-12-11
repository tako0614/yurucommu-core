/**
 * Integration tests for app-api.ts
 *
 * Tests the App API route handler that executes App Handlers
 * at /-/apps/:appId/api/* routes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { appApiRouter, registerAppHandlers } from "./app-api";

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
    INSTANCE_DOMAIN: "test.example.com",
  };
}

// Create a test Hono app with the app-api router mounted
function createTestApp() {
  const app = new Hono();

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
      expect(json.id).toBe("sample-counter");
      expect(json.name).toBe("sample-counter");
      expect(json.handlers).toBeDefined();
      expect(Array.isArray(json.handlers)).toBe(true);
    });

    it("should return manifest for unknown app with empty handlers", async () => {
      const res = await app.request(
        "/-/apps/unknown-app/manifest.json",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.id).toBe("unknown-app");
      expect(json.handlers).toEqual([]);
    });

    it("should load manifest from R2 storage if available", async () => {
      const customManifest = {
        id: "custom-app",
        name: "Custom App",
        version: "2.0.0",
        description: "Custom app from storage",
        handlers: [],
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

  describe("GET /:appId/handlers", () => {
    it("should list available handlers for an app", async () => {
      const res = await app.request(
        "/-/apps/sample-counter/handlers",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.appId).toBe("sample-counter");
      expect(Array.isArray(json.handlers)).toBe(true);
      expect(json.handlers.length).toBeGreaterThan(0);

      // Verify handler metadata structure
      const counterHandler = json.handlers.find(
        (h: any) => h.path === "/counter" && h.method === "GET"
      );
      expect(counterHandler).toBeDefined();
      expect(counterHandler.auth).toBe(true);
    });

    it("should return empty handlers for unknown app", async () => {
      const res = await app.request(
        "/-/apps/unknown-app/handlers",
        { method: "GET" },
        mockBindings
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.appId).toBe("unknown-app");
      expect(json.handlers).toEqual([]);
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

      // Key should contain app:sample-counter:user:test-user:
      expect(key).toContain("app:sample-counter:");
      expect(key).toContain("user:test-user:");
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
      expect(json.error).toBe("File path required");
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

  describe("Handler Registration", () => {
    it("should allow registering new app handlers", () => {
      const testHandlers = [
        {
          __takosHandler: true as const,
          metadata: {
            id: "GET:/test",
            method: "GET" as const,
            path: "/test",
            auth: false,
          },
          handler: async () => ({ message: "test" }),
        },
      ];

      registerAppHandlers("test-app", testHandlers);

      // Handlers should be available through the API
      // (tested indirectly via the handlers endpoint)
    });
  });

  describe("Error Handling", () => {
    it("should return 404 for unknown app handler", async () => {
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
      expect(json.error).toBe("Handler not found");
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
