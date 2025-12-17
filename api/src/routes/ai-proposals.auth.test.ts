import { describe, expect, it, vi } from "vitest";
import aiProposalsRoutes from "./ai-proposals";

const proposalQueueMock = {
  list: vi.fn(async () => [{ id: "prop_1" }]),
  getStats: vi.fn(async () => ({ pending: 1, approved: 0, rejected: 0, expired: 0 })),
  get: vi.fn(async () => ({ id: "prop_1" })),
  approve: vi.fn(async (id: string) => ({ id, status: "approved" })),
  reject: vi.fn(async (id: string) => ({ id, status: "rejected" })),
  expireOld: vi.fn(async () => 2),
};

vi.mock("@takos/platform/ai/proposal-queue", () => ({
  D1ProposalQueueStorage: class {
    constructor(_db: any) {}
  },
  createProposalQueue: () => proposalQueueMock,
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
      c.set("user", { id: userId, handle: userId });
      c.set("sessionUser", { id: userId, handle: userId });
      c.set("authSource", source);
      c.set("authContext", { plan: { name: "test", features: ["*"] }, limits: { aiRequests: 999 } });
      await next();
    },
  };
});

describe("/ai/proposals owner mode", () => {
  const env = { DB: {} as any } as any;

  it("rejects list for jwt source", async () => {
    const res = await aiProposalsRoutes.request("/", { method: "GET", headers: { "x-user-id": "u1" } }, env);
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe("OWNER_REQUIRED");
  });

  it("allows list for session source", async () => {
    const res = await aiProposalsRoutes.request(
      "/",
      { method: "GET", headers: { "x-user-id": "owner", "x-auth-source": "session" } },
      env,
    );
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.data?.proposals)).toBe(true);
  });

  it("rejects approve for jwt source", async () => {
    const res = await aiProposalsRoutes.request(
      "/prop_1/approve",
      { method: "POST", headers: { "x-user-id": "u1", "content-type": "application/json" }, body: "{}" },
      env,
    );
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe("OWNER_REQUIRED");
  });
});
