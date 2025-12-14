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

  it("proxies WebFinger when WEBFINGER_FROM_APP is enabled", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-webfinger", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/.well-known/webfinger?resource=acct:alice@example.test"),
      makeEnv({ WEBFINGER_FROM_APP: "1" }),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-webfinger");
  });

  it("proxies Actor endpoint when ACTOR_FROM_APP is enabled", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-actor", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice"),
      makeEnv({ ACTOR_FROM_APP: "1" }),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-actor");
  });

  it("proxies Outbox endpoint when OUTBOX_FROM_APP is enabled", async () => {
    const appModuleFetch = vi.fn(async () => new Response("proxied-outbox", { status: 200 }));
    mocks.loadTakosApp.mockResolvedValue({ fetch: appModuleFetch });
    mocks.loadStoredAppManifest.mockResolvedValue({} as any);
    mocks.buildTakosAppEnv.mockReturnValue({} as any);

    const app = createTakosRoot({ ensureDatabase: async () => {} }, "example.test");
    const res = await app.fetch(
      new Request("https://example.test/ap/users/alice/outbox"),
      makeEnv({ OUTBOX_FROM_APP: "1" }),
      makeExecutionContext(),
    );

    expect(mocks.loadTakosApp).toHaveBeenCalledWith("default", expect.anything());
    expect(appModuleFetch).toHaveBeenCalledTimes(1);
    expect(await res.text()).toBe("proxied-outbox");
  });
});
