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
  const store = new Map<string, any>();
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
    put: vi.fn(async (key: string, value: any) => {
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
      if (url.pathname === "/users/me/following") {
        const headers = new Headers(init?.headers);
        expect(headers.get("authorization")).toBe("Bearer valid-token");
        return Response.json({ ok: true, data: [{ id: "followed-user" }] });
      }

      if (url.pathname !== "/objects/timeline") {
        return new Response("not found", { status: 404 });
      }
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer valid-token");
      expect(url.searchParams.get("limit")).toBe("2");
      expect(url.searchParams.get("actors")).toContain("test-user");
      expect(url.searchParams.get("actors")).toContain("followed-user");
      return Response.json({
        ok: true,
        data: {
          items: [
            { id: "obj-1", type: "Note", content: "hello", actor: "test-user" },
            { id: "obj-2", type: "Note", content: "world", actor: "followed-user" },
          ],
          nextCursor: null,
          hasMore: false,
        },
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
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("excludes blocked users from /api/timeline/home", async () => {
    bindings = createMockBindings();
    (bindings.APP_STATE.get as any).mockImplementation(async (key: string) => {
      if (key === "app:default:block:test-user:list") return ["followed-user"];
      return null;
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      if (url.pathname === "/users/me/following") {
        return Response.json({ ok: true, data: [{ id: "followed-user" }] });
      }
      if (url.pathname === "/objects/timeline") {
        expect(url.searchParams.get("actors")).toContain("test-user");
        expect(url.searchParams.get("actors")).not.toContain("followed-user");
        return Response.json({ ok: true, data: { items: [], nextCursor: null, hasMore: false } });
      }
      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/timeline/home?limit=2",
      { method: "GET", headers: { Authorization: "Bearer valid-token" } },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(Array.isArray(json.items)).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("serves /dm/threads via app-api router and uses core objects endpoints", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer valid-token");

      if (url.pathname === "/objects") {
        expect(url.searchParams.get("visibility")).toBe("direct");
        expect(url.searchParams.get("include_direct")).toBe("true");
        expect(url.searchParams.get("participant")).toBe("test-user");
        return Response.json({
          ok: true,
          data: {
            items: [
              {
                id: "obj-1",
                type: "Note",
                actor: "test-user",
                content: "hi",
                published: "2025-01-01T00:00:00.000Z",
                context: "thread-1",
                to: ["other-user"],
                cc: [],
                bto: [],
                bcc: [],
                "takos:participants": ["test-user", "other-user"],
              },
            ],
            nextCursor: null,
            hasMore: false,
          },
        });
      }

      if (url.pathname.startsWith("/objects/thread/")) {
        return Response.json({
          ok: true,
          data: [
            {
              id: "obj-1",
              type: "Note",
              actor: "test-user",
              content: "hi",
              published: "2025-01-01T00:00:00.000Z",
              context: "thread-1",
              to: ["other-user"],
              cc: [],
              bto: [],
              bcc: [],
              "takos:participants": ["test-user", "other-user"],
            },
          ],
        });
      }

      return new Response("not found", { status: 404 });
    });

    const res = await app.request(
      "/-/apps/default/api/dm/threads?limit=1",
      { method: "GET", headers: { Authorization: "Bearer valid-token" } },
      bindings,
    );

    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(Array.isArray(json.threads)).toBe(true);
    expect(json.threads).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalled();
  });
});
