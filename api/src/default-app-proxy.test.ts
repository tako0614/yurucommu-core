import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildTakosAppEnv: vi.fn(),
  buildTakosScheduledAppEnv: vi.fn(),
  loadStoredAppManifest: vi.fn(),
  loadTakosApp: vi.fn(),
}));

vi.mock("./lib/app-sdk-loader", () => mocks);

import { createTakosRoot } from "./index";

const makeExecutionContext = () =>
  ({
    waitUntil: () => {},
    passThroughOnException: () => {},
  }) as any;

const makeEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    DB: {
      prepare: () => ({
        run: async () => ({ success: true }),
        first: async () => null,
        all: async () => ({ results: [] }),
        bind: () => ({
          first: async () => null,
          run: async () => ({ success: true }),
          all: async () => ({ results: [] }),
        }),
      }),
    },
    CRON_SECRET: "test-secret",
    CRON_TRIGGERS: ["*/5 * * * *", "0 2 * * *"].join(","),
    ...overrides,
  }) as any;

describe("Default App proxy routes (ActivityPub migration)", () => {
  beforeEach(() => {
    mocks.buildTakosAppEnv.mockReset();
    mocks.buildTakosScheduledAppEnv.mockReset();
    mocks.loadStoredAppManifest.mockReset();
    mocks.loadTakosApp.mockReset();
  });

  it("proxies WebFinger", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-webfinger", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/.well-known/webfinger?resource=acct:alice@example.test"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-webfinger");
  });

  it("proxies Actor endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-actor", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-actor");
  });

  it("proxies Outbox endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-outbox", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice/outbox"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-outbox");
  });

  it("proxies NodeInfo discovery", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-nodeinfo", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/.well-known/nodeinfo"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-nodeinfo");
  });

  it("proxies NodeInfo 2.0 endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-nodeinfo-2.0", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/nodeinfo/2.0"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-nodeinfo-2.0");
  });

  it("proxies Shared Inbox endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-shared-inbox", { status: 202 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/inbox", { method: "POST", body: "{}" }),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-shared-inbox");
  });

  it("proxies Personal Inbox endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-user-inbox", { status: 202 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice/inbox", { method: "POST", body: "{}" }),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-user-inbox");
  });

  it("proxies Object endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-object", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/objects/obj-1"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-object");
  });

  it("proxies Followers endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-followers", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice/followers"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-followers");
  });

  it("proxies Following endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-following", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice/following"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-following");
  });

  it("proxies Group Actor endpoint", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-group", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/groups/community-1"),
      makeEnv(),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-group");
  });
});
