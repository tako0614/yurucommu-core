import { describe, expect, it } from "vitest";
import {
  assertToolAllowedForAgent,
  isToolAllowedForAgent,
  normalizeAgentType,
} from "./agent-policy";

describe("agent tool policy", () => {
  it("normalizes agent types in a case-insensitive way", () => {
    expect(normalizeAgentType("guest")).toBe("guest");
    expect(normalizeAgentType("User")).toBe("user");
    expect(normalizeAgentType("power")).toBe("power");
    expect(normalizeAgentType(" ADMIN ")).toBe("system");
    expect(normalizeAgentType("system")).toBe("system");
    expect(normalizeAgentType("Dev")).toBe("dev");
    expect(normalizeAgentType("full")).toBe("full");
    expect(normalizeAgentType("unknown")).toBeNull();
    expect(normalizeAgentType(undefined)).toBeNull();
  });

  it("enforces allowlist rules per agent type", () => {
    expect(isToolAllowedForAgent("guest", "tool.describeNodeCapabilities")).toBe(true);
    expect(isToolAllowedForAgent("guest", "tool.runAIAction")).toBe(false);
    expect(isToolAllowedForAgent("user", "tool.runAIAction")).toBe(true);
    expect(isToolAllowedForAgent("user", "tool.createPost")).toBe(true);
    expect(isToolAllowedForAgent("power", "tool.moderatePost")).toBe(true);
    expect(isToolAllowedForAgent("system", "tool.updateTakosConfig")).toBe(true);
    expect(isToolAllowedForAgent("dev", "tool.applyCodePatch")).toBe(true);
    expect(isToolAllowedForAgent("full", "tool.applyCodePatch")).toBe(true);
  });

  it("blocks config changes for non-system agents", () => {
    expect(() => assertToolAllowedForAgent("user", "tool.updateTakosConfig")).toThrow(
      /not allowed/,
    );
    expect(() => assertToolAllowedForAgent("power", "tool.updateTakosConfig")).toThrow(/not allowed/);
  });

  it("blocks code changes for non-dev agents", () => {
    expect(() => assertToolAllowedForAgent("system", "tool.applyCodePatch")).toThrow(/not allowed/);
    expect(() => assertToolAllowedForAgent("user", "tool.applyCodePatch")).toThrow(/not allowed/);
  });
});
