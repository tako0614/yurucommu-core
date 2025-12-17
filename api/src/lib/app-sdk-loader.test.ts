import { describe, expect, it, vi, beforeEach } from "vitest";
import { buildTakosAppEnv, buildTakosScheduledAppEnv } from "./app-sdk-loader";

describe("buildTakosAppEnv", () => {
  it("exposes optional bindings/env vars on AppEnv", () => {
    const fakeDb = { name: "DB" };
    const fakeKv = { name: "KV" };
    const fakeBucket = { name: "MEDIA" };

    const c: any = {
      env: {
        DB: fakeDb,
        KV: fakeKv,
        MEDIA: fakeBucket,
        INSTANCE_DOMAIN: "example.test",
        JWT_SECRET: "secret",
      },
      req: {
        url: "http://localhost/",
        header: () => null,
      },
      get: () => null,
    };

    const env = buildTakosAppEnv(c, "default", { version: "1.0.0" } as any);
    expect(env.DB).toBe(fakeDb);
    expect(env.KV).toBe(fakeKv);
    expect(env.STORAGE).toBe(fakeBucket);
    expect(env.INSTANCE_DOMAIN).toBe("example.test");
    expect(env.JWT_SECRET).toBe("secret");
  });

  it("provides auth info when user is authenticated", () => {
    const authContext = {
      userId: "user123",
      sessionId: "session456",
      isAuthenticated: true,
      user: { handle: "testuser" },
      plan: { name: "pro", limits: { storage: 1000 }, features: ["ai"] },
      limits: { storage: 1000 },
    };

    const c: any = {
      env: {
        DB: {},
        KV: {},
        INSTANCE_DOMAIN: "example.test",
      },
      req: {
        url: "http://localhost/",
        header: () => null,
      },
      get: (key: string) => (key === "authContext" ? authContext : null),
    };

    const env = buildTakosAppEnv(c, "default", { version: "1.0.0" } as any);
    expect(env.auth).not.toBeNull();
    expect(env.auth?.userId).toBe("user123");
    expect(env.auth?.handle).toBe("testuser");
    expect(env.auth?.sessionId).toBe("session456");
    expect(env.auth?.isAuthenticated).toBe(true);
    expect(env.auth?.plan?.name).toBe("pro");
  });

  it("provides null auth when user is not authenticated", () => {
    const c: any = {
      env: {
        DB: {},
        KV: {},
        INSTANCE_DOMAIN: "example.test",
      },
      req: {
        url: "http://localhost/",
        header: () => null,
      },
      get: () => null,
    };

    const env = buildTakosAppEnv(c, "default", { version: "1.0.0" } as any);
    expect(env.auth).toBeNull();
  });

  it("provides app info from manifest", () => {
    const c: any = {
      env: { DB: {}, KV: {}, INSTANCE_DOMAIN: "example.test" },
      req: { url: "http://localhost/", header: () => null },
      get: () => null,
    };

    const manifest = { version: "2.5.0" } as any;
    const env = buildTakosAppEnv(c, "my-app", manifest);
    expect(env.app.id).toBe("my-app");
    expect(env.app.version).toBe("2.5.0");
  });
});

describe("per-user storage", () => {
  it("uses per-user key structure for authenticated users", async () => {
    const kvStore: Record<string, string> = {};
    const fakeKv = {
      get: vi.fn(async (key: string) => {
        const value = kvStore[key];
        return value ? JSON.parse(value) : null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        kvStore[key] = value;
      }),
      delete: vi.fn(async (key: string) => {
        delete kvStore[key];
      }),
      list: vi.fn(async ({ prefix }: { prefix: string }) => ({
        keys: Object.keys(kvStore)
          .filter((k) => k.startsWith(prefix))
          .map((name) => ({ name })),
      })),
    };

    const authContext = {
      userId: "user123",
      sessionId: "sess",
      isAuthenticated: true,
    };

    const c: any = {
      env: {
        DB: {},
        KV: fakeKv,
        APP_STATE: fakeKv,
        INSTANCE_DOMAIN: "example.test",
      },
      req: { url: "http://localhost/", header: () => null },
      get: (key: string) => (key === "authContext" ? authContext : null),
    };

    const env = buildTakosAppEnv(c, "test-app", { version: "1.0.0" } as any);

    // Set a value
    await env.storage.set("mykey", { foo: "bar" });

    // Verify key structure includes user ID
    expect(fakeKv.put).toHaveBeenCalledWith(
      "app:test-app:user:user123:mykey",
      JSON.stringify({ foo: "bar" }),
      {},
    );

    // Get the value back
    const value = await env.storage.get("mykey");
    expect(value).toEqual({ foo: "bar" });
  });

  it("uses global key structure for unauthenticated users", async () => {
    const fakeKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ keys: [] })),
    };

    const c: any = {
      env: {
        DB: {},
        KV: fakeKv,
        APP_STATE: fakeKv,
        INSTANCE_DOMAIN: "example.test",
      },
      req: { url: "http://localhost/", header: () => null },
      get: () => null, // No auth context
    };

    const env = buildTakosAppEnv(c, "test-app", { version: "1.0.0" } as any);

    await env.storage.set("globalkey", "value");

    expect(fakeKv.put).toHaveBeenCalledWith(
      "app:test-app:global:globalkey",
      JSON.stringify("value"),
      {},
    );
  });

  it("supports TTL option", async () => {
    const fakeKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ keys: [] })),
    };

    const authContext = {
      userId: "user123",
      sessionId: "sess",
      isAuthenticated: true,
    };

    const c: any = {
      env: {
        DB: {},
        KV: fakeKv,
        APP_STATE: fakeKv,
        INSTANCE_DOMAIN: "example.test",
      },
      req: { url: "http://localhost/", header: () => null },
      get: (key: string) => (key === "authContext" ? authContext : null),
    };

    const env = buildTakosAppEnv(c, "test-app", { version: "1.0.0" } as any);

    // Set with TTL
    await env.storage.set("tempkey", "tempvalue", { expirationTtl: 3600 });

    expect(fakeKv.put).toHaveBeenCalledWith(
      "app:test-app:user:user123:tempkey",
      JSON.stringify("tempvalue"),
      { expirationTtl: 3600 },
    );
  });
});

describe("buildTakosScheduledAppEnv", () => {
  it("provides null auth for scheduled context", () => {
    const env: any = {
      DB: {},
      KV: {},
      INSTANCE_DOMAIN: "example.test",
    };

    const appEnv = buildTakosScheduledAppEnv(env, "default", { version: "1.0.0" } as any);
    expect(appEnv.auth).toBeNull();
  });

  it("uses global key structure for storage (no user)", async () => {
    const fakeKv = {
      get: vi.fn(async () => null),
      put: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      list: vi.fn(async () => ({ keys: [] })),
    };

    const env: any = {
      DB: {},
      KV: fakeKv,
      APP_STATE: fakeKv,
      INSTANCE_DOMAIN: "example.test",
    };

    const appEnv = buildTakosScheduledAppEnv(env, "scheduled-app", { version: "1.0.0" } as any);

    await appEnv.storage.set("task-state", { completed: true });

    expect(fakeKv.put).toHaveBeenCalledWith(
      "app:scheduled-app:global:task-state",
      JSON.stringify({ completed: true }),
      {},
    );
  });
});

