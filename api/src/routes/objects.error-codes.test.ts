import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../middleware/auth", () => ({
  auth: async (_c: any, next: any) => next(),
  optionalAuth: async (_c: any, next: any) => next(),
}));

vi.mock("../services", () => ({
  createObjectService: () => ({
    get: vi.fn(async () => null),
    query: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    getTimeline: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    getThread: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
  }),
}));

import objectsRoutes from "./objects";

describe("objects route error codes", () => {
  it("returns OBJECT_NOT_FOUND for missing object", async () => {
    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", { id: "test-user" });
      c.set("activeUserId", "test-user");
      await next();
    });
    app.route("/", objectsRoutes as any);

    const res = await app.request("/objects/missing", {}, { DB: {} } as any);
    expect(res.status).toBe(404);
    const body = await res.json<any>();
    expect(body.code).toBe("OBJECT_NOT_FOUND");
    expect(body.status).toBe(404);
  });
});

