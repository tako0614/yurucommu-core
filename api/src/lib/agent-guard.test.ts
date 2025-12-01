import { describe, expect, it } from "vitest";
import { guardAgentRequest, readAgentType } from "./agent-guard";

type HeaderBag = Record<string, string>;

const makeReq = (headers: HeaderBag) => ({
  header: (name: string) => headers[name.toLowerCase()] ?? null,
});

describe("agent guard", () => {
  it("returns null when no agent header is provided", () => {
    const result = readAgentType(makeReq({}));
    expect(result.agentType).toBeNull();
    expect(result.raw).toBeNull();
  });

  it("rejects invalid agent header values", () => {
    const result = guardAgentRequest(makeReq({ "x-takos-agent-type": "root" }), {
      toolId: "tool.updateTakosConfig",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
    }
  });

  it("applies tool allowlist rules when an agent header is present", () => {
    const allowed = guardAgentRequest(makeReq({ "x-takos-agent-type": "admin" }), {
      toolId: "tool.updateTakosConfig",
    });
    expect(allowed.ok).toBe(true);

    const blocked = guardAgentRequest(makeReq({ "x-takos-agent-type": "user" }), {
      toolId: "tool.updateTakosConfig",
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.status).toBe(403);
      expect(blocked.error).toMatch(/not allowed/);
    }
  });

  it("can forbid all agent-sourced mutations", () => {
    const result = guardAgentRequest(makeReq({ "x-takos-agent-type": "dev" }), {
      forbidAgents: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toMatch(/cannot perform/);
    }
  });
});
