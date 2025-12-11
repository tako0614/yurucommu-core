import { describe, it, expect } from "vitest";
import { json, error, parseBody, parseQuery, matchPath } from "./index";
import type { TakosApp, AppEnv } from "../types";

// =============================================================================
// Helper Functions Tests
// =============================================================================

describe("json", () => {
  it("should create a JSON response with data", async () => {
    const response = json({ message: "ok", count: 42 });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({ message: "ok", count: 42 });
  });

  it("should accept custom status", async () => {
    const response = json({ id: "123" }, { status: 201 });

    expect(response.status).toBe(201);
  });

  it("should accept custom headers", async () => {
    const response = json({ data: [] }, {
      headers: { "X-Custom": "value" },
    });

    expect(response.headers.get("X-Custom")).toBe("value");
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("should handle arrays", async () => {
    const response = json([1, 2, 3]);

    const body = await response.json();
    expect(body).toEqual([1, 2, 3]);
  });

  it("should handle null and undefined", async () => {
    const nullResponse = json(null);
    const nullBody = await nullResponse.json();
    expect(nullBody).toBeNull();
  });
});

describe("error", () => {
  it("should create an error response", async () => {
    const response = error("Something went wrong");

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({ error: "Something went wrong" });
  });

  it("should accept custom status", async () => {
    const response = error("Not found", 404);

    expect(response.status).toBe(404);
  });

  it("should handle different error types", async () => {
    const unauthorized = error("Unauthorized", 401);
    const forbidden = error("Forbidden", 403);
    const serverError = error("Internal server error", 500);

    expect(unauthorized.status).toBe(401);
    expect(forbidden.status).toBe(403);
    expect(serverError.status).toBe(500);
  });
});

describe("parseBody", () => {
  it("should parse JSON body from request", async () => {
    const request = new Request("http://test.com/api", {
      method: "POST",
      body: JSON.stringify({ name: "Test", value: 123 }),
      headers: { "Content-Type": "application/json" },
    });

    const body = await parseBody<{ name: string; value: number }>(request);

    expect(body).toEqual({ name: "Test", value: 123 });
  });

  it("should work with typed generic", async () => {
    interface CreateInput {
      title: string;
      items: string[];
    }

    const request = new Request("http://test.com/api", {
      method: "POST",
      body: JSON.stringify({ title: "My List", items: ["a", "b", "c"] }),
      headers: { "Content-Type": "application/json" },
    });

    const body = await parseBody<CreateInput>(request);

    expect(body.title).toBe("My List");
    expect(body.items).toEqual(["a", "b", "c"]);
  });
});

describe("parseQuery", () => {
  it("should parse query parameters from request", () => {
    const request = new Request("http://test.com/api?foo=bar&baz=123");

    const query = parseQuery(request);

    expect(query).toEqual({ foo: "bar", baz: "123" });
  });

  it("should return empty object for no query params", () => {
    const request = new Request("http://test.com/api");

    const query = parseQuery(request);

    expect(query).toEqual({});
  });

  it("should handle multiple values (takes last)", () => {
    const request = new Request("http://test.com/api?key=first&key=second");

    const query = parseQuery(request);

    // URLSearchParams.forEach takes the last value for duplicate keys
    expect(query.key).toBe("second");
  });

  it("should decode URL-encoded values", () => {
    const request = new Request("http://test.com/api?name=Hello%20World&tag=%23test");

    const query = parseQuery(request);

    expect(query.name).toBe("Hello World");
    expect(query.tag).toBe("#test");
  });
});

describe("matchPath", () => {
  it("should match exact paths", () => {
    const params = matchPath("/users", "/users");

    expect(params).toEqual({});
  });

  it("should match paths with single param", () => {
    const params = matchPath("/users/:id", "/users/123");

    expect(params).toEqual({ id: "123" });
  });

  it("should match paths with multiple params", () => {
    const params = matchPath("/users/:userId/posts/:postId", "/users/abc/posts/xyz");

    expect(params).toEqual({ userId: "abc", postId: "xyz" });
  });

  it("should return null for non-matching paths", () => {
    expect(matchPath("/users", "/posts")).toBeNull();
    expect(matchPath("/users/:id", "/users")).toBeNull();
    expect(matchPath("/users/:id", "/users/123/extra")).toBeNull();
  });

  it("should decode URL-encoded param values", () => {
    const params = matchPath("/tags/:name", "/tags/hello%20world");

    expect(params).toEqual({ name: "hello world" });
  });

  it("should handle root path", () => {
    const params = matchPath("/", "/");

    expect(params).toEqual({});
  });

  it("should match nested paths", () => {
    const params = matchPath("/api/v1/users/:id", "/api/v1/users/456");

    expect(params).toEqual({ id: "456" });
  });
});

// =============================================================================
// Type Tests
// =============================================================================

describe("TakosApp type", () => {
  it("should allow creating a valid TakosApp", () => {
    const app: TakosApp = {
      async fetch(request: Request, env: AppEnv): Promise<Response> {
        return new Response("OK");
      },
    };

    expect(app.fetch).toBeTypeOf("function");
  });

  it("should work with synchronous fetch", () => {
    const app: TakosApp = {
      fetch(request: Request, env: AppEnv): Response {
        return new Response("Sync OK");
      },
    };

    expect(app.fetch).toBeTypeOf("function");
  });
});

// =============================================================================
// Integration Example
// =============================================================================

describe("Integration: Sample TakosApp", () => {
  it("should handle routes correctly", async () => {
    // Create a simple app
    const app: TakosApp = {
      async fetch(request: Request, env: AppEnv): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // GET /counter
        if (path === "/counter" && request.method === "GET") {
          const count = await env.storage.get<number>("count") ?? 0;
          return json({ count });
        }

        // POST /counter/increment
        if (path === "/counter/increment" && request.method === "POST") {
          if (!env.auth) {
            return error("Unauthorized", 401);
          }
          const count = (await env.storage.get<number>("count") ?? 0) + 1;
          await env.storage.set("count", count);
          return json({ count });
        }

        return error("Not found", 404);
      },
    };

    // Create mock env
    let storedCount = 5;
    const mockEnv: AppEnv = {
      storage: {
        get: async () => storedCount as any,
        set: async (key, value) => { storedCount = value as number; },
        delete: async () => {},
        list: async () => [],
      },
      fetch: async () => new Response("{}"),
      activitypub: {
        send: async () => {},
        resolve: async () => ({}),
      },
      ai: {
        complete: async () => "",
        embed: async () => [],
      },
      auth: { userId: "user-1", handle: "testuser" },
      app: { id: "test-app", version: "1.0.0" },
    };

    // Test GET /counter
    const getRequest = new Request("http://test.com/counter");
    const getResponse = await app.fetch(getRequest, mockEnv);
    const getData = await getResponse.json();
    expect(getData).toEqual({ count: 5 });

    // Test POST /counter/increment
    const postRequest = new Request("http://test.com/counter/increment", { method: "POST" });
    const postResponse = await app.fetch(postRequest, mockEnv);
    const postData = await postResponse.json();
    expect(postData).toEqual({ count: 6 });
    expect(storedCount).toBe(6);

    // Test unauthorized
    const unauthEnv = { ...mockEnv, auth: null };
    const unauthRequest = new Request("http://test.com/counter/increment", { method: "POST" });
    const unauthResponse = await app.fetch(unauthRequest, unauthEnv);
    expect(unauthResponse.status).toBe(401);

    // Test 404
    const notFoundRequest = new Request("http://test.com/unknown");
    const notFoundResponse = await app.fetch(notFoundRequest, mockEnv);
    expect(notFoundResponse.status).toBe(404);
  });
});
