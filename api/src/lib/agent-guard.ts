import type { AgentToolId, AgentType } from "@takos/platform/server";
import { assertToolAllowedForAgent, normalizeAgentType } from "@takos/platform/server";

export type AgentGuardResult =
  | { ok: true; agentType: AgentType | null }
  | { ok: false; status: number; error: string };

const AGENT_TYPE_HEADERS = ["x-takos-agent-type", "x-ai-agent-type", "x-agent-type"];

export function readAgentType(
  req: { header(name: string): string | undefined | null },
): { agentType: AgentType | null; raw: string | null } {
  for (const key of AGENT_TYPE_HEADERS) {
    const raw = req.header(key);
    if (raw !== undefined && raw !== null) {
      const agentType = normalizeAgentType(raw);
      return { agentType, raw };
    }
  }
  return { agentType: null, raw: null };
}

export function guardAgentRequest(
  req: { header(name: string): string | undefined | null },
  options?: { toolId?: AgentToolId; forbidAgents?: boolean },
): AgentGuardResult {
  const { agentType, raw } = readAgentType(req);

  if (raw !== null && agentType === null) {
    return { ok: false, status: 400, error: "invalid agent type header" };
  }

  if (options?.forbidAgents && agentType) {
    return { ok: false, status: 403, error: "AI agents cannot perform this operation" };
  }

  if (options?.toolId && agentType) {
    try {
      assertToolAllowedForAgent(agentType, options.toolId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "agent not allowed";
      return { ok: false, status: 403, error: message };
    }
  }

  return { ok: true, agentType };
}
