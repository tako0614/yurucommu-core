import { describe, expect, it } from "vitest";
import type { AuthContext, PlanLimits } from "./auth-context-model";
import { checkStorageQuota } from "./storage-quota";

const makeLimits = (overrides: Partial<PlanLimits> = {}): PlanLimits => ({
  storage: Number.MAX_SAFE_INTEGER,
  fileSize: Number.MAX_SAFE_INTEGER,
  aiRequests: Number.MAX_SAFE_INTEGER,
  dmMessagesPerDay: Number.MAX_SAFE_INTEGER,
  dmMediaSize: Number.MAX_SAFE_INTEGER,
  vfsStorage: Number.MAX_SAFE_INTEGER,
  vfsMaxFiles: Number.MAX_SAFE_INTEGER,
  vfsMaxFileSize: Number.MAX_SAFE_INTEGER,
  vfsMaxWorkspaces: Number.MAX_SAFE_INTEGER,
  apDeliveryPerMinute: Number.MAX_SAFE_INTEGER,
  apDeliveryPerDay: Number.MAX_SAFE_INTEGER,
  apiRateLimits: {
    read: { perMinute: Number.MAX_SAFE_INTEGER, perDay: Number.MAX_SAFE_INTEGER },
    write: { perMinute: Number.MAX_SAFE_INTEGER, perDay: Number.MAX_SAFE_INTEGER },
  },
  ...overrides,
});

const makeAuth = (limits: Partial<PlanLimits>): AuthContext =>
  ({
    userId: "u1",
    sessionId: "s1",
    isAuthenticated: true,
    user: null,
    plan: { name: "test", features: ["*"], limits: makeLimits(limits) },
    limits: makeLimits(limits),
  }) satisfies AuthContext;

describe("storage-quota", () => {
  it("returns file guard error before touching bucket", async () => {
    const auth = makeAuth({ fileSize: 5 });
    const bucket = {
      list: async () => {
        throw new Error("bucket.list should not be called");
      },
    } as any;

    const result = await checkStorageQuota(bucket, "users/u1", auth, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.guard.code).toBe("FILE_TOO_LARGE");
      expect(result.guard.status).toBe(413);
    }
  });

  it("skips usage calculation when bucket is null", async () => {
    const auth = makeAuth({ fileSize: 10, storage: 10 });
    const result = await checkStorageQuota(null, "users/u1", auth, 5);
    expect(result).toEqual({ ok: true, usage: 0 });
  });

  it("returns storage guard error when usage would exceed limit", async () => {
    const auth = makeAuth({ fileSize: 10, storage: 5 });
    const bucket = {
      list: async () => ({
        objects: [{ size: 5 }],
        truncated: false,
      }),
    } as any;

    const result = await checkStorageQuota(bucket, "users/u1", auth, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.guard.code).toBe("STORAGE_LIMIT_EXCEEDED");
      expect(result.guard.status).toBe(507);
    }
  });
});

