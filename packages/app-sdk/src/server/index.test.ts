import { describe, it, expect, vi } from "vitest";
import {
  defineHandler,
  isHandler,
  extractHandlers,
  createHandlerRegistry,
  findHandler,
  extractHandlerMetadata,
  createStubHandlerContext,
} from "./index";
import type { Handler, HandlerContext } from "../types";

// =============================================================================
// defineHandler Tests
// =============================================================================

describe("defineHandler", () => {
  it("should create a handler with metadata", () => {
    const handler = defineHandler({
      method: "GET",
      path: "/stats",
      handler: async (ctx) => ctx.json({ count: 0 }),
    });

    expect(handler.__takosHandler).toBe(true);
    expect(handler.metadata.id).toBe("GET:/stats");
    expect(handler.metadata.method).toBe("GET");
    expect(handler.metadata.path).toBe("/stats");
    expect(handler.metadata.auth).toBe(true); // default auth
  });

  it("should normalize path with leading slash", () => {
    const handler = defineHandler({
      method: "POST",
      path: "items",
      handler: async (ctx) => ctx.json({}),
    });

    expect(handler.metadata.path).toBe("/items");
    expect(handler.metadata.id).toBe("POST:/items");
  });

  it("should remove trailing slash from path", () => {
    const handler = defineHandler({
      method: "GET",
      path: "/users/",
      handler: async (ctx) => ctx.json({}),
    });

    expect(handler.metadata.path).toBe("/users");
  });

  it("should keep root path as /", () => {
    const handler = defineHandler({
      method: "GET",
      path: "/",
      handler: async (ctx) => ctx.json({}),
    });

    expect(handler.metadata.path).toBe("/");
    expect(handler.metadata.id).toBe("GET:/");
  });

  it("should allow auth: false", () => {
    const handler = defineHandler({
      method: "GET",
      path: "/public",
      auth: false,
      handler: async (ctx) => ctx.json({}),
    });

    expect(handler.metadata.auth).toBe(false);
  });

  it("should execute handler function", async () => {
    const mockFn = vi.fn().mockResolvedValue({ success: true });
    const handler = defineHandler({
      method: "POST",
      path: "/action",
      handler: mockFn,
    });

    const ctx = createStubHandlerContext();
    const input = { value: "test" };
    await handler.handler(ctx, input);

    expect(mockFn).toHaveBeenCalledWith(ctx, input);
  });

  it("should support typed input and output", async () => {
    type CreateItemInput = { name: string; price: number };
    type CreateItemOutput = { id: string; name: string };

    const handler = defineHandler<CreateItemInput, CreateItemOutput>({
      method: "POST",
      path: "/items",
      handler: async (ctx, input) => {
        return { id: "123", name: input.name };
      },
    });

    const ctx = createStubHandlerContext();
    const result = await handler.handler(ctx, { name: "Test", price: 100 });

    expect(result).toEqual({ id: "123", name: "Test" });
  });
});

// =============================================================================
// isHandler Tests
// =============================================================================

describe("isHandler", () => {
  it("should return true for valid handler", () => {
    const handler = defineHandler({
      method: "GET",
      path: "/test",
      handler: async () => ({}),
    });

    expect(isHandler(handler)).toBe(true);
  });

  it("should return false for non-handler objects", () => {
    expect(isHandler({})).toBe(false);
    expect(isHandler(null)).toBe(false);
    expect(isHandler(undefined)).toBe(false);
    expect(isHandler("string")).toBe(false);
    expect(isHandler(123)).toBe(false);
    expect(isHandler({ __takosHandler: false })).toBe(false);
  });

  it("should return false for handler-like objects without marker", () => {
    const fakeHandler = {
      metadata: { id: "GET:/fake", method: "GET", path: "/fake", auth: true },
      handler: async () => ({}),
    };

    expect(isHandler(fakeHandler)).toBe(false);
  });
});

// =============================================================================
// extractHandlers Tests
// =============================================================================

describe("extractHandlers", () => {
  it("should extract handlers from module exports", () => {
    const getStats = defineHandler({
      method: "GET",
      path: "/stats",
      handler: async () => ({}),
    });

    const createItem = defineHandler({
      method: "POST",
      path: "/items",
      handler: async () => ({}),
    });

    const moduleExports = {
      getStats,
      createItem,
      notAHandler: { foo: "bar" },
      alsoNotHandler: "string",
      CONSTANT: 42,
    };

    const handlers = extractHandlers(moduleExports);

    expect(handlers).toHaveLength(2);
    expect(handlers).toContain(getStats);
    expect(handlers).toContain(createItem);
  });

  it("should return empty array for module with no handlers", () => {
    const moduleExports = {
      config: { name: "app" },
      util: () => {},
    };

    const handlers = extractHandlers(moduleExports);
    expect(handlers).toHaveLength(0);
  });
});

// =============================================================================
// createHandlerRegistry Tests
// =============================================================================

describe("createHandlerRegistry", () => {
  it("should create registry map from handlers", () => {
    const handler1 = defineHandler({
      method: "GET",
      path: "/a",
      handler: async () => ({}),
    });

    const handler2 = defineHandler({
      method: "POST",
      path: "/b",
      handler: async () => ({}),
    });

    const registry = createHandlerRegistry([handler1, handler2]);

    expect(registry.size).toBe(2);
    expect(registry.get("GET:/a")).toBe(handler1);
    expect(registry.get("POST:/b")).toBe(handler2);
  });

  it("should handle duplicate handler IDs with warning", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const handler1 = defineHandler({
      method: "GET",
      path: "/duplicate",
      handler: async () => ({ first: true }),
    });

    const handler2 = defineHandler({
      method: "GET",
      path: "/duplicate",
      handler: async () => ({ second: true }),
    });

    const registry = createHandlerRegistry([handler1, handler2]);

    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("Duplicate handler ID")
    );
    expect(registry.get("GET:/duplicate")).toBe(handler2);

    consoleWarn.mockRestore();
  });

  it("should create empty registry from empty array", () => {
    const registry = createHandlerRegistry([]);
    expect(registry.size).toBe(0);
  });
});

// =============================================================================
// findHandler Tests
// =============================================================================

describe("findHandler", () => {
  it("should find handler by method and path", () => {
    const getStats = defineHandler({
      method: "GET",
      path: "/stats",
      handler: async () => ({}),
    });

    const registry = createHandlerRegistry([getStats]);

    const found = findHandler(registry, "GET", "/stats");
    expect(found).toBe(getStats);
  });

  it("should normalize path when finding", () => {
    const handler = defineHandler({
      method: "GET",
      path: "/users",
      handler: async () => ({}),
    });

    const registry = createHandlerRegistry([handler]);

    // Without leading slash
    expect(findHandler(registry, "GET", "users")).toBe(handler);
    // With trailing slash
    expect(findHandler(registry, "GET", "/users/")).toBe(handler);
  });

  it("should return undefined for non-existent handler", () => {
    const registry = createHandlerRegistry([]);

    expect(findHandler(registry, "GET", "/nonexistent")).toBeUndefined();
  });

  it("should differentiate by method", () => {
    const getItems = defineHandler({
      method: "GET",
      path: "/items",
      handler: async () => ({ action: "list" }),
    });

    const postItems = defineHandler({
      method: "POST",
      path: "/items",
      handler: async () => ({ action: "create" }),
    });

    const registry = createHandlerRegistry([getItems, postItems]);

    expect(findHandler(registry, "GET", "/items")).toBe(getItems);
    expect(findHandler(registry, "POST", "/items")).toBe(postItems);
    expect(findHandler(registry, "DELETE", "/items")).toBeUndefined();
  });
});

// =============================================================================
// extractHandlerMetadata Tests
// =============================================================================

describe("extractHandlerMetadata", () => {
  it("should extract metadata from handlers", () => {
    const handlers = [
      defineHandler({
        method: "GET",
        path: "/a",
        auth: false,
        handler: async () => ({}),
      }),
      defineHandler({
        method: "POST",
        path: "/b",
        handler: async () => ({}),
      }),
    ];

    const metadata = extractHandlerMetadata(handlers);

    expect(metadata).toHaveLength(2);
    expect(metadata[0]).toEqual({
      id: "GET:/a",
      method: "GET",
      path: "/a",
      auth: false,
    });
    expect(metadata[1]).toEqual({
      id: "POST:/b",
      method: "POST",
      path: "/b",
      auth: true,
    });
  });

  it("should return empty array for no handlers", () => {
    expect(extractHandlerMetadata([])).toEqual([]);
  });
});

// =============================================================================
// createStubHandlerContext Tests
// =============================================================================

describe("createStubHandlerContext", () => {
  it("should create context with default values", () => {
    const ctx = createStubHandlerContext();

    expect(ctx.auth.userId).toBe("test-user");
    expect(ctx.auth.handle).toBe("test@example.com");
    expect(ctx.params).toEqual({});
    expect(ctx.query).toEqual({});
  });

  it("should have working core services stubs", async () => {
    const ctx = createStubHandlerContext();

    expect(await ctx.core.posts.list()).toEqual([]);
    expect(await ctx.core.posts.get("1")).toEqual({});
    expect(await ctx.core.posts.create({})).toEqual({});
    await expect(ctx.core.posts.delete("1")).resolves.toBeUndefined();

    expect(await ctx.core.users.get("1")).toEqual({});
    await expect(ctx.core.users.follow("1")).resolves.toBeUndefined();
    await expect(ctx.core.users.unfollow("1")).resolves.toBeUndefined();

    expect(await ctx.core.storage.get("key")).toBeNull();
    await expect(ctx.core.storage.delete("key")).resolves.toBeUndefined();

    expect(await ctx.core.ai.complete("prompt")).toBe("");
    expect(await ctx.core.ai.embed("text")).toEqual([]);
  });

  it("should have working app storage stubs", async () => {
    const ctx = createStubHandlerContext();

    expect(await ctx.storage.get("key")).toBeNull();
    await expect(ctx.storage.set("key", "value")).resolves.toBeUndefined();
    await expect(ctx.storage.delete("key")).resolves.toBeUndefined();
    expect(await ctx.storage.list("prefix")).toEqual([]);
  });

  it("should create JSON response", () => {
    const ctx = createStubHandlerContext();

    const response = ctx.json({ message: "ok" });

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("should create JSON response with custom status", () => {
    const ctx = createStubHandlerContext();

    const response = ctx.json({ data: [] }, { status: 201 });

    expect(response.status).toBe(201);
  });

  it("should create error response", () => {
    const ctx = createStubHandlerContext();

    const response = ctx.error("Not found", 404);

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");
  });

  it("should allow overriding default values", () => {
    const ctx = createStubHandlerContext({
      auth: { userId: "custom-user", handle: "custom@test.com" },
      params: { id: "123" },
      query: { filter: "active" },
    });

    expect(ctx.auth.userId).toBe("custom-user");
    expect(ctx.auth.handle).toBe("custom@test.com");
    expect(ctx.params.id).toBe("123");
    expect(ctx.query.filter).toBe("active");
  });

  it("should allow partial overrides", () => {
    const ctx = createStubHandlerContext({
      params: { postId: "456" },
    });

    // Overridden
    expect(ctx.params.postId).toBe("456");
    // Defaults preserved
    expect(ctx.auth.userId).toBe("test-user");
    expect(ctx.query).toEqual({});
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("Handler Integration", () => {
  it("should work end-to-end: define, register, find, execute", async () => {
    // Define handlers
    const getUser = defineHandler({
      method: "GET",
      path: "/users/:id",
      handler: async (ctx) => {
        const user = await ctx.core.users.get(ctx.params.id);
        return ctx.json(user);
      },
    });

    const createPost = defineHandler({
      method: "POST",
      path: "/posts",
      handler: async (ctx, input: { content: string }) => {
        const post = await ctx.core.posts.create({ text: input.content });
        return ctx.json(post, { status: 201 });
      },
    });

    // Create registry
    const registry = createHandlerRegistry([getUser, createPost]);

    // Find and execute GET handler
    const foundGet = findHandler(registry, "GET", "/users/:id");
    expect(foundGet).toBeDefined();

    const getCtx = createStubHandlerContext({
      params: { id: "user-123" },
      core: {
        ...createStubHandlerContext().core,
        users: {
          get: vi.fn().mockResolvedValue({ id: "user-123", name: "Alice" }),
          follow: vi.fn(),
          unfollow: vi.fn(),
        },
      },
    });

    const getResult = await foundGet!.handler(getCtx, {});
    expect(getResult).toBeInstanceOf(Response);
    expect(getCtx.core.users.get).toHaveBeenCalledWith("user-123");

    // Find and execute POST handler
    const foundPost = findHandler(registry, "POST", "/posts");
    expect(foundPost).toBeDefined();

    const postCtx = createStubHandlerContext({
      core: {
        ...createStubHandlerContext().core,
        posts: {
          list: vi.fn(),
          get: vi.fn(),
          create: vi.fn().mockResolvedValue({ id: "post-1", text: "Hello" }),
          delete: vi.fn(),
        },
      },
    });

    const postResult = await foundPost!.handler(postCtx, { content: "Hello" });
    expect(postResult).toBeInstanceOf(Response);
    expect(postResult.status).toBe(201);
    expect(postCtx.core.posts.create).toHaveBeenCalledWith({ text: "Hello" });
  });
});
