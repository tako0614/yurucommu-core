import { describe, expect, it } from "vitest";
import type { AuthContext, PlanLimits } from "./auth-context-model";
import {
  requireAiQuota,
  requireFileSizeWithinPlan,
  requirePlanFeature,
  requireStorageWithinPlan,
} from "./plan-guard";

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

const makeAuth = (opts: { features?: string[]; limits?: Partial<PlanLimits> } = {}): AuthContext =>
  ({
    userId: "u1",
    sessionId: "s1",
    isAuthenticated: true,
    user: null,
    plan: {
      name: "test",
      features: opts.features ?? ["*"],
      limits: makeLimits(opts.limits),
    },
    limits: makeLimits(opts.limits),
  }) satisfies AuthContext;

describe("plan-guard", () => {
  it("rejects missing plan feature", () => {
    const auth = makeAuth({ features: ["basic_sns"] });
    const result = requirePlanFeature(auth, "ai");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.code).toBe("FEATURE_UNAVAILABLE");
    }
  });

  it("rejects AI usage when feature not enabled", () => {
    const auth = makeAuth({ features: ["basic_sns"], limits: { aiRequests: 100 } });
    const result = requireAiQuota(auth, { used: 0, requested: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.code).toBe("AI_UNAVAILABLE");
    }
  });

  it("rejects AI usage when quota is unavailable", () => {
    const auth = makeAuth({ features: ["ai"], limits: { aiRequests: 0 } });
    const result = requireAiQuota(auth, { used: 0, requested: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(402);
      expect(result.code).toBe("AI_UNAVAILABLE");
    }
  });

  it("rejects AI usage when quota exceeded", () => {
    const auth = makeAuth({ features: ["ai"], limits: { aiRequests: 10 } });
    const result = requireAiQuota(auth, { used: 10, requested: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.code).toBe("AI_LIMIT_EXCEEDED");
      expect(result.details?.used).toBe(10);
    }
  });

  it("rejects file size beyond plan limit", () => {
    const auth = makeAuth({ limits: { fileSize: 5 } });
    const result = requireFileSizeWithinPlan(auth, 6);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(413);
      expect(result.code).toBe("FILE_TOO_LARGE");
      expect(result.details).toEqual({ size: 6, limit: 5 });
    }
  });

  it("rejects storage usage beyond plan limit", () => {
    const auth = makeAuth({ limits: { storage: 10 } });
    const result = requireStorageWithinPlan(auth, 10, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(507);
      expect(result.code).toBe("STORAGE_LIMIT_EXCEEDED");
      expect(result.details).toEqual({ used: 10, incoming: 1, limit: 10 });
    }
  });
});

