import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("../middleware/auth", () => ({
  auth: async (_c: any, next: any) => next(),
}));

vi.mock("../services", () => ({
  createObjectService: () => ({
    create: vi.fn(async (_auth: any, input: any) => ({ id: "obj-1", ...input })),
    get: vi.fn(async () => null),
    query: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    getTimeline: vi.fn(async () => ({ items: [], nextCursor: null, hasMore: false })),
    getThread: vi.fn(async () => []),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => undefined),
  }),
}));

import objectsRoutes from "./objects";

describe("objects metering", () => {
  it("records DM usage when creating direct visibility objects", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-02T03:04:05.000Z"));

    const kvStore = new Map<string, string>();
    const kv = {
      get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
      put: vi.fn(async (key: string, value: string) => {
        kvStore.set(key, value);
      }),
    };

    const app = new Hono();
    app.use("*", async (c, next) => {
      c.set("user", { id: "test-user" });
      c.set("activeUserId", "test-user");
      await next();
    });
    app.route("/", objectsRoutes as any);

    const res = await app.request(
      "/objects",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "Note", visibility: "direct", content: "hi" }),
      },
      { APP_STATE: kv } as any,
    );

    expect(res.status).toBe(201);
    expect(kv.put).toHaveBeenCalled();
    expect(kvStore.get("usage:test-user:dm:2025-01-02")).toBe("1");

    vi.useRealTimers();
  });
});

