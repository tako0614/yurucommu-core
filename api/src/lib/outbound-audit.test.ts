import { describe, expect, it, vi } from "vitest";
import { createOutboundAuditLogger } from "./outbound-audit";

const appendAuditLog = vi.fn(async () => ({}));
const getLatestAuditLog = vi.fn(async () => ({ checksum: "prev" }));

vi.mock("../data", () => ({
  makeData: () => ({
    appendAuditLog,
    getLatestAuditLog,
  }),
}));

vi.mock("@takos/platform/server", async () => {
  const actual = await vi.importActual<any>("@takos/platform/server");
  return {
    ...actual,
    releaseStore: vi.fn(async () => {}),
  };
});

describe("outbound-audit", () => {
  it("writes to audit_log chain when available", async () => {
    appendAuditLog.mockClear();
    getLatestAuditLog.mockClear();

    const logger = createOutboundAuditLogger({ DB: {} } as any);
    await logger({
      status: "success",
      url: "https://remote.example/test",
      hostname: "remote.example",
      method: "GET",
      httpStatus: 200,
      durationMs: 12,
      responseBytes: 2,
    });

    expect(getLatestAuditLog).toHaveBeenCalledTimes(1);
    expect(appendAuditLog).toHaveBeenCalledTimes(1);
    const entry = appendAuditLog.mock.calls[0][0];
    expect(entry.action).toBe("outbound.fetch");
    expect(entry.actor_type).toBe("app");
    expect(entry.target).toBe("remote.example");
    expect(entry.details).toMatchObject({
      status: "success",
      method: "GET",
      hostname: "remote.example",
      http_status: 200,
    });
    expect(typeof entry.checksum).toBe("string");
    expect(entry.checksum.length).toBeGreaterThan(10);
  });
});
