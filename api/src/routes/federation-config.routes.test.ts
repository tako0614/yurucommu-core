import { describe, expect, it, vi } from "vitest";
import activityPubConfigRoutes from "./activitypub-config";
import activityPubAdminRoutes from "./activitypub-admin";

vi.mock("../middleware/auth", async () => {
  const { fail } = await import("@takos/platform/server");
  const { ErrorCodes } = await import("../lib/error-codes");
  return {
    auth: async (c: any, next: any) => {
      const userId = c.req.header("x-user-id");
      if (!userId) return fail(c, "Authentication required", 401, { code: ErrorCodes.UNAUTHORIZED });
      const user = { id: userId, handle: userId };
      c.set("user", user);
      c.set("sessionUser", user);
      c.set("authSource", "session");
      await next();
    },
  };
});

const makeDb = () =>
  ({
    prepare: () => ({
      bind: () => ({
        first: async () => null,
        run: async () => ({ success: true }),
        all: async () => ({ results: [] }),
      }),
      first: async () => null,
      run: async () => ({ success: true }),
      all: async () => ({ results: [] }),
    }),
  }) as any;

const makeEnv = (overrides: Record<string, unknown> = {}) =>
  ({
    DB: makeDb(),
    AUTH_USERNAME: "owner",
    ...overrides,
  }) as any;

describe("federation blocked-instances route aliases", () => {
  it("guards /api/federation/blocked-instances like /api/activitypub/blocked-instances", async () => {
    const env = makeEnv();

    const legacyForbidden = await activityPubConfigRoutes.request(
      "/api/activitypub/blocked-instances",
      { method: "GET", headers: { "x-user-id": "someone" } },
      env,
    );
    expect(legacyForbidden.status).toBe(403);

    const aliasForbidden = await activityPubConfigRoutes.request(
      "/api/federation/blocked-instances",
      { method: "GET", headers: { "x-user-id": "someone" } },
      env,
    );
    expect(aliasForbidden.status).toBe(403);

    const legacyOk = await activityPubConfigRoutes.request(
      "/api/activitypub/blocked-instances",
      { method: "GET", headers: { "x-user-id": "owner" } },
      env,
    );
    expect(legacyOk.status).toBe(200);

    const aliasOk = await activityPubConfigRoutes.request(
      "/api/federation/blocked-instances",
      { method: "GET", headers: { "x-user-id": "owner" } },
      env,
    );
    expect(aliasOk.status).toBe(200);
  });

  it("guards /admin/federation/blocked-instances like /admin/activitypub/blocked-instances", async () => {
    const env = makeEnv();

    const legacyForbidden = await activityPubAdminRoutes.request(
      "/admin/activitypub/blocked-instances",
      { method: "GET", headers: { "x-user-id": "someone" } },
      env,
    );
    expect(legacyForbidden.status).toBe(403);

    const aliasForbidden = await activityPubAdminRoutes.request(
      "/admin/federation/blocked-instances",
      { method: "GET", headers: { "x-user-id": "someone" } },
      env,
    );
    expect(aliasForbidden.status).toBe(403);

    const legacyOk = await activityPubAdminRoutes.request(
      "/admin/activitypub/blocked-instances",
      { method: "GET", headers: { "x-user-id": "owner" } },
      env,
    );
    expect(legacyOk.status).toBe(200);

    const aliasOk = await activityPubAdminRoutes.request(
      "/admin/federation/blocked-instances",
      { method: "GET", headers: { "x-user-id": "owner" } },
      env,
    );
    expect(aliasOk.status).toBe(200);
  });
});

