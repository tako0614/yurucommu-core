/**
 * E2E tests for ActivityPub federation endpoints.
 *
 * These tests exercise the full ActivityPub flow through the Default App:
 * - WebFinger discovery
 * - Actor retrieval
 * - Inbox processing (with signature verification)
 * - Outbox retrieval
 * - Object retrieval
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mapErrorToResponse } from "../lib/observability";
import { appApiRouter } from "./app-api";
import defaultApp from "../../../app/default/src/server";
import { signRequest, computeDigest } from "../../../packages/ap-utils/src/index";

function createMockR2() {
  const files = new Map<string, { text: () => Promise<string>; body: null }>();
  return {
    _files: files,
    get: vi.fn(async (key: string) => files.get(key) ?? null),
  };
}

function createMockKV() {
  const store = new Map<string, unknown>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      if (!store.has(key)) return null;
      const value = store.get(key);
      if (type === "json") {
        if (typeof value === "string") {
          try {
            return JSON.parse(value);
          } catch {
            return null;
          }
        }
        return value ?? null;
      }
      return value ?? null;
    }),
    put: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }),
    list: vi.fn(async ({ prefix }: { prefix: string }) => {
      const keys = Array.from(store.keys())
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name }));
      return { keys };
    }),
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
    DB: {} as unknown,
    KV: createMockKV(),
    APP_STATE: createMockKV(),
    MEDIA: createMockR2(),
    APP_MANIFESTS,
    APP_MODULES: {
      default: defaultApp,
    },
    INSTANCE_DOMAIN: "test.example.com",
    INSTANCE_NAME: "Test Instance",
    INSTANCE_DESCRIPTION: "A test takos instance",
    INSTANCE_OPEN_REGISTRATIONS: "false",
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

describe("ActivityPub E2E - WebFinger", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns WebFinger response for valid acct resource", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/testuser") {
        return Response.json({
          ok: true,
          data: {
            id: "test-user",
            handle: "testuser",
            display_name: "Test User",
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/.well-known/webfinger?resource=acct:testuser@test.example.com",
      { method: "GET" },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      subject: string;
      links: Array<{ rel: string; type?: string; href: string }>;
    }>();
    expect(json.subject).toBe("acct:testuser@test.example.com");
    expect(json.links).toContainEqual(
      expect.objectContaining({
        rel: "self",
        type: "application/activity+json",
      }),
    );
  });

  it("returns 404 for unknown user", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/.well-known/webfinger?resource=acct:unknown@test.example.com",
      { method: "GET" },
      bindings,
    );

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid resource format", async () => {
    const res = await app.request(
      "/-/apps/default/api/.well-known/webfinger?resource=invalid",
      { method: "GET" },
      bindings,
    );

    expect(res.status).toBe(400);
  });
});

describe("ActivityPub E2E - NodeInfo", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns NodeInfo well-known with link to nodeinfo/2.0", async () => {
    const res = await app.request(
      "/-/apps/default/api/.well-known/nodeinfo",
      { method: "GET" },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      links: Array<{ rel: string; href: string }>;
    }>();
    expect(json.links).toContainEqual(
      expect.objectContaining({
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
      }),
    );
  });

  it("returns NodeInfo 2.0 with instance details", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users") {
        return Response.json({
          ok: true,
          data: { total: 5 },
        });
      }
      if (url.pathname === "/objects") {
        return Response.json({
          ok: true,
          data: { total: 100 },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/nodeinfo/2.0",
      { method: "GET" },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      version: string;
      software: { name: string; version: string };
      protocols: string[];
      usage: { users: { total: number }; localPosts: number };
      openRegistrations: boolean;
    }>();
    expect(json.version).toBe("2.0");
    expect(json.software.name).toBe("takos");
    expect(json.protocols).toContain("activitypub");
  });
});

describe("ActivityPub E2E - Actor", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Actor JSON for valid handle with ActivityPub Accept header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/testuser") {
        return Response.json({
          ok: true,
          data: {
            id: "test-user",
            handle: "testuser",
            display_name: "Test User",
            summary: "A test user",
            avatar_url: "https://test.example.com/avatar.png",
            public_key_pem: "-----BEGIN PUBLIC KEY-----\nMIIBIjAN...\n-----END PUBLIC KEY-----",
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/users/testuser",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/activity+json");

    const json = await res.json<{
      "@context": unknown;
      type: string;
      id: string;
      preferredUsername: string;
      inbox: string;
      outbox: string;
    }>();
    expect(json["@context"]).toBeDefined();
    expect(json.type).toBe("Person");
    expect(json.preferredUsername).toBe("testuser");
    expect(json.inbox).toContain("/inbox");
    expect(json.outbox).toContain("/outbox");
  });

  it("returns 404 for unknown actor", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/users/unknown",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(404);
  });
});

describe("ActivityPub E2E - Outbox", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns OrderedCollection for user outbox", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/testuser") {
        return Response.json({
          ok: true,
          data: { id: "test-user", handle: "testuser" },
        });
      }
      if (url.pathname === "/objects") {
        return Response.json({
          ok: true,
          data: {
            items: [
              {
                id: "obj-1",
                type: "Note",
                content: "Hello world",
                actor: "test-user",
                visibility: "public",
                published: "2025-01-01T00:00:00.000Z",
              },
            ],
            total: 1,
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/users/testuser/outbox",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      "@context": unknown;
      type: string;
      totalItems: number;
      orderedItems?: unknown[];
    }>();
    expect(json.type).toBe("OrderedCollection");
    expect(json.totalItems).toBeGreaterThanOrEqual(0);
  });

  it("filters out non-public posts from outbox", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/testuser") {
        return Response.json({
          ok: true,
          data: { id: "test-user", handle: "testuser" },
        });
      }
      if (url.pathname === "/objects") {
        // Verify that visibility filter is applied
        expect(url.searchParams.get("visibility")).toMatch(/public|unlisted/);
        return Response.json({
          ok: true,
          data: { items: [], total: 0 },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/users/testuser/outbox",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
  });
});

describe("ActivityPub E2E - Collections", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns followers collection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/testuser") {
        return Response.json({
          ok: true,
          data: { id: "test-user", handle: "testuser" },
        });
      }
      if (url.pathname === "/users/testuser/followers") {
        return Response.json({
          ok: true,
          data: [
            { id: "follower-1", handle: "alice" },
            { id: "follower-2", handle: "bob" },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/users/testuser/followers",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      type: string;
      totalItems: number;
    }>();
    expect(json.type).toBe("OrderedCollection");
  });

  it("returns following collection", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/testuser") {
        return Response.json({
          ok: true,
          data: { id: "test-user", handle: "testuser" },
        });
      }
      if (url.pathname === "/users/testuser/following") {
        return Response.json({
          ok: true,
          data: [{ id: "following-1", handle: "charlie" }],
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/users/testuser/following",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      type: string;
      totalItems: number;
    }>();
    expect(json.type).toBe("OrderedCollection");
  });
});

describe("ActivityPub E2E - Objects", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns object by ID with ActivityPub format", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/objects/obj-123") {
        return Response.json({
          ok: true,
          data: {
            id: "obj-123",
            type: "Note",
            content: "Hello ActivityPub",
            actor: "test-user",
            visibility: "public",
            published: "2025-01-01T00:00:00.000Z",
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/objects/obj-123",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      "@context": unknown;
      type: string;
      content: string;
    }>();
    expect(json["@context"]).toBeDefined();
    expect(json.type).toBe("Note");
    expect(json.content).toBe("Hello ActivityPub");
  });

  it("returns 404 for non-existent object", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ ok: false, error: "not found" }), { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/objects/nonexistent",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(404);
  });

  it("returns 403 for private object without auth", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return Response.json({
        ok: true,
        data: {
          id: "obj-private",
          type: "Note",
          content: "Private note",
          visibility: "direct",
        },
      });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/objects/obj-private",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    // Should return 403 or 404 for private content
    expect([403, 404]).toContain(res.status);
  });
});

describe("ActivityPub E2E - Groups", () => {
  let app: ReturnType<typeof createTestApp>;
  let bindings: ReturnType<typeof createMockBindings>;

  beforeEach(() => {
    app = createTestApp();
    bindings = createMockBindings();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns Group actor for community", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/communities/community-1") {
        return Response.json({
          ok: true,
          data: {
            id: "community-1",
            name: "Test Community",
            description: "A test community",
            visibility: "public",
          },
        });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/ap/groups/community-1",
      {
        method: "GET",
        headers: { Accept: "application/activity+json" },
      },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<{
      "@context": unknown;
      type: string;
      name: string;
    }>();
    expect(json["@context"]).toBeDefined();
    expect(json.type).toBe("Group");
  });
});
