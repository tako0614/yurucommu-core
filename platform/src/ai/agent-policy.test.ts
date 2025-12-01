import { describe, expect, it } from "vitest";
import {
  assertToolAllowedForAgent,
  isToolAllowedForAgent,
  normalizeAgentType,
} from "./agent-policy";

describe("agent tool policy", () => {
  it("normalizes agent types in a case-insensitive way", () => {
    expect(normalizeAgentType("User")).toBe("user");
    expect(normalizeAgentType(" ADMIN ")).toBe("admin");
    expect(normalizeAgentType("Dev")).toBe("dev");
    expect(normalizeAgentType("unknown")).toBeNull();
    expect(normalizeAgentType(undefined)).toBeNull();
  });

  it("enforces allowlist rules per agent type", () => {
    expect(isToolAllowedForAgent("user", "tool.runAIAction")).toBe(true);
    expect(isToolAllowedForAgent("user", "tool.describeNodeCapabilities")).toBe(true);
    expect(isToolAllowedForAgent("admin", "tool.updateTakosConfig")).toBe(true);
    expect(isToolAllowedForAgent("dev", "tool.applyCodePatch")).toBe(true);
  });

  it("blocks config changes for non-admin agents", () => {
    expect(() => assertToolAllowedForAgent("user", "tool.updateTakosConfig")).toThrow(
      /not allowed/,
    );
    expect(() => assertToolAllowedForAgent("dev", "tool.updateTakosConfig")).toThrow(
      /not allowed/,
    );
  });

  it("blocks code changes for user/admin agents", () => {
    expect(() => assertToolAllowedForAgent("user", "tool.applyCodePatch")).toThrow(
      /not allowed/,
    );
    expect(() => assertToolAllowedForAgent("admin", "tool.applyCodePatch")).toThrow(
      /not allowed/,
    );
  });
});
