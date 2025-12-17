import { describe, expect, it, vi } from "vitest";
import { expireAiProposals } from "./ai-proposals-cron";

const expireOldMock = vi.fn(async () => 3);

vi.mock("@takos/platform/ai/proposal-queue", () => ({
  D1ProposalQueueStorage: class {
    constructor(_db: any) {}
  },
  createProposalQueue: () => ({ expireOld: expireOldMock }),
}));

describe("expireAiProposals", () => {
  it("returns 0 when DB is missing", async () => {
    await expect(expireAiProposals({} as any)).resolves.toEqual({ expired: 0 });
  });

  it("expires proposals when DB is present", async () => {
    const res = await expireAiProposals({ DB: {} as any } as any);
    expect(res.expired).toBe(3);
    expect(expireOldMock).toHaveBeenCalledTimes(1);
  });
});

