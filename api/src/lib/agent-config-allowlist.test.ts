import { describe, expect, it } from "vitest";
import {
  changedPathsFromDiff,
  enforceAgentConfigAllowlist,
  findDisallowedConfigPaths,
  getAgentConfigAllowlist,
} from "./agent-config-allowlist";

describe("agent config allowlist", () => {
  it("normalizes and deduplicates allowlist entries", () => {
    const allowlist = getAgentConfigAllowlist({
      ai: { agent_config_allowlist: [" ai.enabled_actions ", "ai.enabled_actions", "custom.flag"] },
    });
    expect(allowlist).toEqual(["ai.enabled_actions", "custom.flag"]);
  });

  it("allows agent updates when all changed paths are permitted", () => {
    const diffPaths = changedPathsFromDiff([
      { path: "ai.enabled_actions", change: "changed", previous: [], next: ["ai.summary"] },
      { path: "ai.enabled_actions[0]", change: "changed", previous: "ai.summary", next: "ai.qa" },
    ]);
    const result = enforceAgentConfigAllowlist({
      agentType: "admin",
      allowlist: ["ai.enabled_actions"],
      changedPaths: diffPaths,
    });
    expect(result.ok).toBe(true);
  });

  it("rejects agent mutations outside the allowlist", () => {
    const disallowed = findDisallowedConfigPaths(
      ["activitypub.blocked_instances", "ai.enabled_actions"],
      ["ai.enabled_actions"],
    );
    expect(disallowed).toEqual(["activitypub.blocked_instances"]);

    const result = enforceAgentConfigAllowlist({
      agentType: "admin",
      allowlist: ["ai.enabled_actions"],
      changedPaths: ["activitypub.blocked_instances"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.disallowed).toEqual(["activitypub.blocked_instances"]);
      expect(result.error).toContain("activitypub.blocked_instances");
    }
  });

  it("skips allowlist enforcement when no agent type is provided", () => {
    const result = enforceAgentConfigAllowlist({
      agentType: null,
      allowlist: [],
      changedPaths: ["node.url"],
    });
    expect(result.ok).toBe(true);
  });
});
