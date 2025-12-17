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
  it("should create an error response with standard format", async () => {
    const response = error("Something went wrong");

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Something went wrong",
    });
  });

  it("should accept custom status and derive error code", async () => {
    const response = error("Not found", 404);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({
      status: 404,
      code: "NOT_FOUND",
      message: "Not found",
    });
  });

  it("should accept custom error code", async () => {
    const response = error("User not found", 404, "USER_NOT_FOUND");

    const body = await response.json();
    expect(body).toEqual({
      status: 404,
      code: "USER_NOT_FOUND",
      message: "User not found",
    });
  });

  it("should accept details object", async () => {
    const response = error("Validation failed", 400, "VALIDATION_ERROR", {
      field: "email",
      reason: "invalid format",
    });

    const body = await response.json();
    expect(body).toEqual({
      status: 400,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      details: { field: "email", reason: "invalid format" },
    });
  });

  it("should handle different error types with default codes", async () => {
    const unauthorized = error("Unauthorized", 401);
    const forbidden = error("Forbidden", 403);
    const serverError = error("Internal server error", 500);

    expect(unauthorized.status).toBe(401);
    expect((await unauthorized.json()).code).toBe("UNAUTHORIZED");

    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).code).toBe("FORBIDDEN");

    expect(serverError.status).toBe(500);
    expect((await serverError.json()).code).toBe("INTERNAL_ERROR");
  });

  it("should use generic ERROR code for unknown status", async () => {
    const response = error("Custom error", 418);

    const body = await response.json();
    expect(body.code).toBe("ERROR");
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

  it("should reject invalid JSON", async () => {
    const request = new Request("http://test.com/api", {
      method: "POST",
      body: "invalid json {",
      headers: { "Content-Type": "application/json" },
    });

    await expect(parseBody(request)).rejects.toThrow();
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

  it("should treat trailing slashes as equivalent", () => {
    expect(matchPath("/users", "/users/")).toEqual({});
    expect(matchPath("/users/", "/users")).toEqual({});
    expect(matchPath("/users/:id", "/users/123/")).toEqual({ id: "123" });
  });

  it("should ignore repeated slashes", () => {
    expect(matchPath("/users/:id", "/users//123")).toEqual({ id: "123" });
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
    // Create a simple app using new AppEnv structure (v3.0)
    const app: TakosApp = {
      async fetch(request: Request, env: AppEnv): Promise<Response> {
        const url = new URL(request.url);
        const path = url.pathname;

        // GET /counter
        if (path === "/counter" && request.method === "GET") {
          const count = await env.core.storage.get<number>("count") ?? 0;
          return json({ count });
        }

        // POST /counter/increment
        if (path === "/counter/increment" && request.method === "POST") {
          if (!env.auth) {
            return error("Unauthorized", 401);
          }
          const count = (await env.core.storage.get<number>("count") ?? 0) + 1;
          await env.core.storage.set("count", count);
          return json({ count });
        }

        return error("Not found", 404);
      },
    };

    // Create mock env with v3.0 structure
    let storedCount = 5;
    const mockEnv: AppEnv = {
      core: {
        storage: {
          get: async () => storedCount as any,
          set: async (key, value) => { storedCount = value as number; },
          delete: async () => {},
          list: async () => [],
        },
        ai: {
          chat: {
            completions: {
              create: async () => ({
                id: "test-completion",
                choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
              }),
            },
          },
          embeddings: {
            create: async () => ({
              data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
            }),
          },
        },
        objects: {
          get: async () => null,
          create: async (data) => ({ id: "obj-1", type: "Note", created_at: new Date().toISOString(), ...data }),
          update: async () => null,
          delete: async () => false,
          list: async () => ({ items: [] }),
        },
        actors: {
          get: async () => null,
          getByHandle: async () => null,
          follow: async () => {},
          unfollow: async () => {},
          getFollowers: async () => ({ items: [] }),
          getFollowing: async () => ({ items: [] }),
        },
        notifications: {
          list: async () => [],
          markAsRead: async () => {},
          markAllAsRead: async () => {},
        },
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

  it("should use core.ai for AI operations", async () => {
    const app: TakosApp = {
      async fetch(request: Request, env: AppEnv): Promise<Response> {
        // Use OpenAI-compatible AI API
        const completion = await env.core.ai.chat.completions.create({
          model: "gpt-4",
          messages: [{ role: "user", content: "Hello" }],
        });
        return json({ response: completion.choices[0].message.content });
      },
    };

    const mockEnv: AppEnv = {
      core: {
        storage: {
          get: async () => null,
          set: async () => {},
          delete: async () => {},
          list: async () => [],
        },
        ai: {
          chat: {
            completions: {
              create: async () => ({
                id: "test-completion",
                choices: [{ message: { role: "assistant", content: "Hi there!" }, finish_reason: "stop" }],
              }),
            },
          },
          embeddings: {
            create: async () => ({
              data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
            }),
          },
        },
        objects: {
          get: async () => null,
          create: async (data) => ({ id: "obj-1", type: "Note", created_at: new Date().toISOString(), ...data }),
          update: async () => null,
          delete: async () => false,
          list: async () => ({ items: [] }),
        },
        actors: {
          get: async () => null,
          getByHandle: async () => null,
          follow: async () => {},
          unfollow: async () => {},
          getFollowers: async () => ({ items: [] }),
          getFollowing: async () => ({ items: [] }),
        },
        notifications: {
          list: async () => [],
          markAsRead: async () => {},
          markAllAsRead: async () => {},
        },
      },
      auth: { userId: "user-1", handle: "testuser" },
      app: { id: "test-app", version: "1.0.0" },
    };

    const request = new Request("http://test.com/chat");
    const response = await app.fetch(request, mockEnv);
    const data = await response.json();
    expect(data).toEqual({ response: "Hi there!" });
  });

  it("should use core.objects for object operations", async () => {
    const createdObjects: any[] = [];

    const app: TakosApp = {
      async fetch(request: Request, env: AppEnv): Promise<Response> {
        // Create a new post using ObjectService
        const post = await env.core.objects.create({
          type: "Note",
          content: "Hello, world!",
          visibility: "public",
        });
        return json({ post });
      },
    };

    const mockEnv: AppEnv = {
      core: {
        storage: {
          get: async () => null,
          set: async () => {},
          delete: async () => {},
          list: async () => [],
        },
        ai: {
          chat: {
            completions: {
              create: async () => ({
                id: "test-completion",
                choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }],
              }),
            },
          },
          embeddings: {
            create: async () => ({
              data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
            }),
          },
        },
        objects: {
          get: async () => null,
          create: async (data) => {
            const obj = { id: "post-123", type: "Note", created_at: new Date().toISOString(), ...data };
            createdObjects.push(obj);
            return obj;
          },
          update: async () => null,
          delete: async () => false,
          list: async () => ({ items: [] }),
        },
        actors: {
          get: async () => null,
          getByHandle: async () => null,
          follow: async () => {},
          unfollow: async () => {},
          getFollowers: async () => ({ items: [] }),
          getFollowing: async () => ({ items: [] }),
        },
        notifications: {
          list: async () => [],
          markAsRead: async () => {},
          markAllAsRead: async () => {},
        },
      },
      auth: { userId: "user-1", handle: "testuser" },
      app: { id: "test-app", version: "1.0.0" },
    };

    const request = new Request("http://test.com/posts", { method: "POST" });
    const response = await app.fetch(request, mockEnv);
    const data = await response.json();

    expect(data.post.id).toBe("post-123");
    expect(data.post.type).toBe("Note");
    expect(data.post.content).toBe("Hello, world!");
    expect(createdObjects.length).toBe(1);
  });
});
