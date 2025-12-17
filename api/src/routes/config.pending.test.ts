import { describe, expect, it, vi } from "vitest";
import configRoutes from "./config";

const mockProposalQueue = {
  list: vi.fn(async () => [{ id: "prop_1", type: "config_change", status: "pending" }]),
  getStats: vi.fn(async () => ({ pending: 1, approved: 0, rejected: 0, expired: 0 })),
  approve: vi.fn(async (id: string, reviewerId: string) => ({ id, reviewerId, status: "approved" })),
  reject: vi.fn(async (id: string, reviewerId: string) => ({ id, reviewerId, status: "rejected" })),
};

vi.mock("@takos/platform/ai/proposal-queue", () => ({
  D1ProposalQueueStorage: class {
    constructor(_db: any) {}
  },
  createProposalQueue: () => mockProposalQueue,
}));

vi.mock("../lib/proposal-executor", () => ({
  executeProposal: vi.fn(async () => ({ success: true, message: "ok" })),
}));

vi.mock("../middleware/auth", async () => {
  const { fail } = await import("@takos/platform/server");
  const { ErrorCodes } = await import("../lib/error-codes");
  return {
    auth: async (c: any, next: any) => {
      const userId = c.req.header("x-user-id");
      const source = c.req.header("x-auth-source") || "jwt";
      if (!userId) return fail(c, "Authentication required", 401, { code: ErrorCodes.UNAUTHORIZED });
      const user = { id: userId, handle: userId };
      c.set("user", user);
      c.set("sessionUser", user);
      c.set("authSource", source);
      await next();
    },
  };
});

describe("/-/config/pending", () => {
  it("rejects non-owner auth source", async () => {
    const res = await configRoutes.request("/-/config/pending", {
      method: "GET",
      headers: { "x-user-id": "alice", "x-auth-source": "jwt" },
    }, { DB: {} as any });

    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe("OWNER_REQUIRED");
  });

  it("lists pending config change proposals for owner session", async () => {
    const res = await configRoutes.request("/-/config/pending", {
      method: "GET",
      headers: { "x-user-id": "owner", "x-auth-source": "session" },
    }, { DB: {} as any });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data?.proposals)).toBe(true);
    expect(mockProposalQueue.list).toHaveBeenCalled();
  });

  it("approves a pending change for owner session", async () => {
    const res = await configRoutes.request("/-/config/pending/prop_1/decide", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": "owner",
        "x-auth-source": "session",
      },
      body: JSON.stringify({ decision: "approve" }),
    }, { DB: {} as any });

    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(mockProposalQueue.approve).toHaveBeenCalledWith("prop_1", "owner", undefined);
  });
});

