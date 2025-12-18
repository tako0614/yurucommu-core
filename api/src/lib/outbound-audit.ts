import { makeData } from "../data";
import { releaseStore } from "@takos/platform/server";

export type OutboundAuditStatus = "attempt" | "blocked" | "error" | "success";

export type OutboundAuditEvent = {
  status: OutboundAuditStatus;
  url: string;
  method: string;
  hostname?: string | null;
  reason?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  responseBytes?: number | null;
};

export type OutboundAuditLogger = (event: OutboundAuditEvent) => Promise<void>;

const encoder = new TextEncoder();

async function sha256Hex(input: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create an audit logger that persists to the tamper-evident audit_log chain.
 *
 * This is generic: Core logs outbound execution metadata without interpreting protocols.
 */
export function createOutboundAuditLogger(env: Record<string, unknown>): OutboundAuditLogger {
  if (!env?.DB) {
    return async () => {};
  }
  return async (event: OutboundAuditEvent) => {
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
        "outbound.fetch",
        event.status,
        event.method,
        event.url,
        event.hostname ?? "",
        event.httpStatus ?? "",
        event.durationMs ?? "",
        event.responseBytes ?? "",
        event.reason ?? "",
        timestamp,
        prevChecksum ?? "",
      ].join("|");
      const checksum = await sha256Hex(checksumPayload);

      await append({
        actor_type: "app",
        actor_id: null,
        action: "outbound.fetch",
        target: event.hostname ?? null,
        details: {
          status: event.status,
          method: event.method,
          url: event.url,
          hostname: event.hostname ?? null,
          http_status: event.httpStatus ?? null,
          duration_ms: event.durationMs ?? null,
          response_bytes: event.responseBytes ?? null,
          reason: event.reason ?? null,
        },
        checksum,
        prev_checksum: prevChecksum,
        timestamp,
      });
    } catch (error) {
      console.error("[outbound-audit] failed to record audit entry", error);
    } finally {
      await releaseStore(store as any);
    }
  };
}
