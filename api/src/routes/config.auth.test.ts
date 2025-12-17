import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import configRoutes from "./config";
import { diffConfigs, loadStoredConfig } from "../lib/config-utils";

const baseConfig = vi.hoisted(() => ({
  schema_version: "1.0",
  distro: { name: "takos-oss", version: "1.0.0" },
  node: { url: "https://example.com" },
}));

const nextConfig = vi.hoisted(() => ({
  schema_version: "1.0",
  distro: { name: "takos-oss", version: "1.0.0" },
  node: { url: "https://example.net" },
}));

const persistConfigWithReloadGuardMock = vi.hoisted(() => vi.fn());
const recordConfigAuditMock = vi.hoisted(() => vi.fn());

vi.mock("../middleware/auth", async () => {
  const { fail } = await import("@takos/platform/server");
  const { ErrorCodes } = await import("../lib/error-codes");
  return {
    auth: async (c: any, next: any) => {
      const userId = c.req.header("x-user-id");
      const source = c.req.header("x-auth-source") || "jwt";
      if (!userId) {
        return fail(c, "Authentication required", 401, { code: ErrorCodes.UNAUTHORIZED });
      }
      const user = { id: userId, handle: userId };
      c.set("user", user);
      c.set("sessionUser", user);
      c.set("authSource", source);
      await next();
    },
  };
});

vi.mock("../lib/config-utils", async () => {
  const actual = await vi.importActual<typeof import("../lib/config-utils")>("../lib/config-utils");
  return {
    ...actual,
    loadStoredConfig: vi.fn(),
    buildRuntimeConfig: vi.fn(() => baseConfig),
    stripSecretsFromConfig: vi.fn((cfg: any) => cfg),
    diffConfigs: vi.fn(actual.diffConfigs),
    checkDistroCompatibility: vi.fn(() => ({ ok: true, warnings: ["compat-warning"] })),
  };
});

vi.mock("../lib/config-reload", () => ({
  persistConfigWithReloadGuard: persistConfigWithReloadGuardMock,
}));

vi.mock("../lib/config-audit", () => ({
  recordConfigAudit: recordConfigAuditMock,
  listConfigAudit: vi.fn(),
}));

const defaultEnv = {};

const request = (
  path: string,
  init: any,
  env: Record<string, any> = defaultEnv,
) => configRoutes.request(path, init, env);

const mockLoadStoredConfig = vi.mocked(loadStoredConfig);
const mockDiffConfigs = vi.mocked(diffConfigs);
const mockPersistConfigWithReloadGuard = vi.mocked(persistConfigWithReloadGuardMock);
const mockRecordConfigAudit = vi.mocked(recordConfigAuditMock);

beforeEach(() => {
  mockLoadStoredConfig.mockResolvedValue({
    config: baseConfig,
    warnings: ["stored-warning"],
  });
  mockPersistConfigWithReloadGuard.mockResolvedValue({
    ok: true,
    rolledBack: false,
    reload: {
      ok: true,
      warnings: ["reload-warning"],
      reloaded: true,
      source: "stored",
    },
  });
  mockRecordConfigAudit.mockResolvedValue(undefined as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("/-/config endpoints (authenticated access)", () => {
  it("rejects unauthenticated requests for export", async () => {
    const res = await request(
      "/-/config/export",
      { method: "GET" },
    );

    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.code).toBe("UNAUTHORIZED");
    expect(json.status).toBe(401);
  });

  it("exports the active config for any authenticated user", async () => {
    const res = await request(
      "/-/config/export",
      { method: "GET", headers: { "x-user-id": "alice" } },
    );

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe("OWNER_REQUIRED");
    expect(json.status).toBe(403);
  });

  it("rejects config diff without owner mode", async () => {
    const res = await request(
      "/-/config/diff",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "bob",
        },
        body: JSON.stringify(nextConfig),
      },
    );

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe("OWNER_REQUIRED");
    expect(json.status).toBe(403);
  });

  it("rejects config import without owner mode", async () => {
    const res = await request(
      "/-/config/import",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "charlie",
        },
        body: JSON.stringify(nextConfig),
      },
    );

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe("OWNER_REQUIRED");
    expect(json.status).toBe(403);
  });

  it("exports config for an owner session", async () => {
    const res = await request(
      "/-/config/export",
      { method: "GET", headers: { "x-user-id": "owner", "x-auth-source": "session" } },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.config).toEqual(baseConfig);
    expect(json.data.source).toBe("stored");
    expect(json.data.warnings).toContain("stored-warning");
  });

  it("returns a config diff for an owner session", async () => {
    const res = await request(
      "/-/config/diff",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "owner",
          "x-auth-source": "session",
        },
        body: JSON.stringify(nextConfig),
      },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    const payload = json.data;
    expect(mockDiffConfigs).toHaveBeenCalled();
    expect(payload.diff_count).toBeGreaterThan(0);
    expect(payload.diff.some((entry: any) => entry.path === "node.url")).toBe(true);
    expect(payload.warnings).toContain("stored-warning");
    expect(payload.warnings).toContain("compat-warning");
  });

  it("imports config updates for an owner session and records audit entry", async () => {
    const res = await request(
      "/-/config/import",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-user-id": "owner",
          "x-auth-source": "session",
        },
        body: JSON.stringify(nextConfig),
      },
    );

    expect(res.status).toBe(200);
    const json: any = await res.json();
    const payload = json.data;
    expect(mockPersistConfigWithReloadGuard).toHaveBeenCalledWith({
      env: expect.any(Object),
      nextConfig,
      previousConfig: baseConfig,
    });
    expect(mockRecordConfigAudit).toHaveBeenCalledTimes(1);
    expect(payload.reload.warnings).toContain("reload-warning");
  });
});
