import type { AgentType, EffectiveAiDataPolicy, AiRedaction } from "@takos/platform/server";
import { makeData } from "../data";
import { releaseStore } from "@takos/platform/server";

export type AiAuditStatus = "attempt" | "blocked" | "error" | "success";

export type AiAuditEvent = {
  actionId: string;
  providerId: string;
  model?: string | null;
  policy: EffectiveAiDataPolicy;
  redacted?: AiRedaction[];
  agentType?: AgentType | null;
  userId?: string | null;
  status?: AiAuditStatus;
  error?: string | null;
};

export type AiAuditLogger = (event: AiAuditEvent) => Promise<void>;

export type AgentToolAuditStatus = "attempt" | "blocked" | "error" | "success";

export type AgentToolAuditEvent = {
  toolId: string;
  status: AgentToolAuditStatus;
  agentType?: AgentType | null;
  userId?: string | null;
  message?: string | null;
  durationMs?: number | null;
  requestId?: string | null;
  ip?: string | null;
};

export type AgentToolAuditLogger = (event: AgentToolAuditEvent) => Promise<void>;

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function actorTypeForEvent(event: AiAuditEvent): string {
  if (event.agentType) return `agent:${event.agentType}`;
  if (event.userId) return "user";
  return "system";
}

function actorTypeForToolEvent(event: AgentToolAuditEvent): string {
  if (event.agentType) return `agent:${event.agentType}`;
  if (event.userId) return "user";
  return "system";
}

/**
 * Create an audit logger that persists to the tamper-evident audit_log chain.
 * Falls back silently when the backing store does not support audit logging.
 */
export function createAiAuditLogger(env: Record<string, unknown>): AiAuditLogger {
  return async (event: AiAuditEvent) => {
    const store = makeData(env as any);
    try {
      const getLatest = (store as any)?.getLatestAuditLog;
      const append = (store as any)?.appendAuditLog;
      if (typeof getLatest !== "function" || typeof append !== "function") {
        return;
      }
      const prev = await getLatest();
      const timestamp = new Date().toISOString();
      const prevChecksum = prev?.checksum ?? prev?.prev_checksum ?? null;
      const checksumPayload = [
        event.actionId,
        event.providerId,
        event.model ?? "",
        event.userId ?? "",
        event.agentType ?? "",
        event.status ?? "attempt",
        timestamp,
        prevChecksum ?? "",
        JSON.stringify(event.policy ?? {}),
        JSON.stringify(event.redacted ?? []),
        event.error ?? "",
      ].join("|");
      const checksum = await sha256Hex(checksumPayload);

      await append({
        actor_type: actorTypeForEvent(event),
        actor_id: event.userId ?? null,
        action: "ai.provider_call",
        target: event.actionId,
        details: {
          provider: event.providerId,
          model: event.model ?? null,
          policy: event.policy,
          redacted: event.redacted ?? [],
          status: event.status ?? "attempt",
          error: event.error ?? null,
        },
        checksum,
        prev_checksum: prevChecksum,
        timestamp,
      });
    } catch (error) {
      console.error("[ai-audit] failed to record audit entry", error);
    } finally {
      await releaseStore(store as any);
    }
  };
}

/**
 * Create a tool-call audit logger that persists to the tamper-evident audit_log chain.
 * Falls back silently when the backing store does not support audit logging.
 */
export function createAgentToolAuditLogger(env: Record<string, unknown>): AgentToolAuditLogger {
  return async (event: AgentToolAuditEvent) => {
    const store = makeData(env as any);
    try {
      const getLatest = (store as any)?.getLatestAuditLog;
      const append = (store as any)?.appendAuditLog;
      if (typeof getLatest !== "function" || typeof append !== "function") {
        return;
      }

      const prev = await getLatest();
      const timestamp = new Date().toISOString();
      const prevChecksum = prev?.checksum ?? prev?.prev_checksum ?? null;
      const checksumPayload = [
        "tool_call",
        event.toolId,
        event.userId ?? "",
        event.agentType ?? "",
        event.status,
        timestamp,
        prevChecksum ?? "",
        event.message ?? "",
        event.durationMs ?? "",
        event.requestId ?? "",
      ].join("|");
      const checksum = await sha256Hex(checksumPayload);

      await append({
        actor_type: actorTypeForToolEvent(event),
        actor_id: event.userId ?? null,
        action: "ai.tool_call",
        target: event.toolId,
        details: {
          tool: event.toolId,
          status: event.status,
          success: event.status === "success",
          message: event.message ?? null,
          duration_ms: event.durationMs ?? null,
          request_id: event.requestId ?? null,
          ip: event.ip ?? null,
        },
        checksum,
        prev_checksum: prevChecksum,
        timestamp,
      });
    } catch (error) {
      console.error("[ai-audit] failed to record tool audit entry", error);
    } finally {
      await releaseStore(store as any);
    }
  };
}
