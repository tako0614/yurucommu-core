import { describe, expect, it, vi } from "vitest";

vi.mock("./core-services", () => {
  return {
    buildCoreServices: () => {
      return {
        objects: {},
        actors: {
          get: vi.fn(async (_ctx: any, actorId: string) => ({ id: actorId })),
          getByHandle: vi.fn(async (_ctx: any, handle: string) => ({ id: `actor:${handle}` })),
          search: vi.fn(async (_ctx: any, query: string) => ({
            actors: [{ id: `actor:${query}` }],
            next_offset: 12,
          })),
          follow: vi.fn(async () => undefined),
          unfollow: vi.fn(async () => undefined),
          listFollowers: vi.fn(async (_ctx: any, params: any) => ({
            actors: [{ id: `follower:${params.actorId}` }],
            next_offset: params.offset + 5,
          })),
          listFollowing: vi.fn(async (_ctx: any, params: any) => ({
            actors: [{ id: `following:${params.actorId}` }],
            next_cursor: "cursor_2",
          })),
        },
        notifications: {
          list: vi.fn(async () => [{ id: "n1" }, { id: "n2" }]),
          markRead: vi.fn(async (_ctx: any, id: string) => ({ id })),
        },
      };
    },
  };
});

vi.mock("./app-collections", () => {
  return {
    createAppCollectionFactory: () => ({}),
  };
});

describe("app-sdk-loader core service wrappers", () => {
  it("wraps ActorService methods to be ctx-less and cursor-based", async () => {
    const { buildTakosAppEnv } = await import("./app-sdk-loader");

    const authContext = {
      userId: "user123",
      sessionId: "session456",
      isAuthenticated: true,
      user: { handle: "testuser" },
      plan: { name: "pro", limits: {}, features: [] },
      limits: {},
    };

    const c: any = {
      env: {},
      req: { url: "http://localhost/", header: () => null },
      get: (key: string) => (key === "authContext" ? authContext : null),
    };

    const env = buildTakosAppEnv(c, "default", { version: "1.0.0" } as any);
    expect(env.core).toBeTruthy();

    const actors: any = (env.core as any).actors;
    const raw = actors._raw;

    await actors.getByHandle("alice");
    expect(raw.getByHandle).toHaveBeenCalledTimes(1);
    expect(raw.getByHandle.mock.calls[0]?.[0]).toMatchObject({ userId: "user123" });
    expect(raw.getByHandle.mock.calls[0]?.[1]).toBe("alice");

    const followers = await actors.getFollowers("actor_1", { limit: 5, cursor: "10" });
    expect(raw.listFollowers).toHaveBeenCalledWith(expect.anything(), { actorId: "actor_1", limit: 5, offset: 10 });
    expect(followers).toMatchObject({ items: [{ id: "follower:actor_1" }], nextCursor: "15" });

    const following = await actors.getFollowing("actor_2", { limit: 5, cursor: "0" });
    expect(raw.listFollowing).toHaveBeenCalledWith(expect.anything(), { actorId: "actor_2", limit: 5, offset: 0 });
    expect(following).toMatchObject({ items: [{ id: "following:actor_2" }], nextCursor: "cursor_2" });

    const searched = await actors.search("bob", { limit: 3, offset: 0 });
    expect(searched).toMatchObject({ items: [{ id: "actor:bob" }], nextCursor: "12" });
  }, 20_000);

  it("wraps NotificationService methods to match app-sdk types", async () => {
    const { buildTakosAppEnv } = await import("./app-sdk-loader");

    const authContext = {
      userId: "user123",
      sessionId: "session456",
      isAuthenticated: true,
      user: { handle: "testuser" },
      plan: { name: "pro", limits: {}, features: [] },
      limits: {},
    };

    const c: any = {
      env: {},
      req: { url: "http://localhost/", header: () => null },
      get: (key: string) => (key === "authContext" ? authContext : null),
    };

    const env = buildTakosAppEnv(c, "default", { version: "1.0.0" } as any);
    const notifications: any = (env.core as any).notifications;
    const raw = notifications._raw;

    await notifications.markAsRead("n1");
    expect(raw.markRead).toHaveBeenCalledWith(expect.anything(), "n1");

    await notifications.markAllAsRead();
    expect(raw.list).toHaveBeenCalledTimes(1);
    expect(raw.markRead).toHaveBeenCalledWith(expect.anything(), "n2");
  });
});
