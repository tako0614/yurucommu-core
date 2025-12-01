export type AgentType = "user" | "admin" | "dev";

export type AgentToolId =
  | "tool.describeNodeCapabilities"
  | "tool.inspectService"
  | "tool.updateTakosConfig"
  | "tool.applyCodePatch"
  | "tool.runAIAction";

const AGENT_TOOL_ALLOWLIST: Record<AgentType, ReadonlySet<AgentToolId>> = {
  user: new Set(["tool.describeNodeCapabilities", "tool.runAIAction"]),
  admin: new Set(["tool.describeNodeCapabilities", "tool.updateTakosConfig", "tool.runAIAction"]),
  dev: new Set(["tool.applyCodePatch", "tool.inspectService"]),
};

export const CONFIG_MUTATION_TOOLS: ReadonlySet<AgentToolId> = new Set([
  "tool.updateTakosConfig",
]);

export const CODE_MUTATION_TOOLS: ReadonlySet<AgentToolId> = new Set([
  "tool.applyCodePatch",
]);

export function normalizeAgentType(value: unknown): AgentType | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "user" || normalized === "admin" || normalized === "dev") {
    return normalized;
  }
  return null;
}

export function isToolAllowedForAgent(agentType: AgentType, toolId: AgentToolId): boolean {
  return AGENT_TOOL_ALLOWLIST[agentType].has(toolId);
}

export function assertToolAllowedForAgent(agentType: AgentType, toolId: AgentToolId): void {
  if (!isToolAllowedForAgent(agentType, toolId)) {
    throw new Error(`Agent type "${agentType}" is not allowed to call ${toolId}`);
  }
}
