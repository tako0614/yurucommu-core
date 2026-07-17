/**
 * Durable persistence for call sessions (history / missed-call / current state).
 * Ephemeral SDP/ICE never touches this — only the call lifecycle does.
 */

import { and, desc, eq } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import { callSessions, nowIso } from "../../../db/index.ts";
import type {
  CallSessionSummary,
  CallDirection,
  CallState,
} from "../../../../packages/api/src/types/call.ts";
import { isTerminalCallState } from "../../../../packages/api/src/types/call.ts";
import type { CallRecord } from "../../runtime/call-hub-core.ts";

/** Insert or update the durable row for a call transition. */
export async function upsertCallSession(
  db: Database,
  localActorApId: string,
  call: CallRecord,
): Promise<void> {
  const now = nowIso();
  const terminal = isTerminalCallState(call.state);
  const connectedAt = call.connectedAt
    ? new Date(call.connectedAt).toISOString()
    : null;
  const sfuFocus = call.sfuFocus ? JSON.stringify(call.sfuFocus) : null;
  await db
    .insert(callSessions)
    .values({
      id: call.callId,
      localActorApId,
      peerActorApId: call.peerApId,
      direction: call.direction,
      state: call.state,
      mediaAudio: call.media.audio ? 1 : 0,
      mediaVideo: call.media.video ? 1 : 0,
      sfuFocus,
      peerSignalEndpoint: call.peerSignalEndpoint ?? null,
      connectedAt,
      endedAt: terminal ? now : null,
    })
    .onConflictDoUpdate({
      target: callSessions.id,
      set: {
        state: call.state,
        sfuFocus,
        peerSignalEndpoint: call.peerSignalEndpoint ?? null,
        connectedAt,
        endedAt: terminal ? now : null,
        updatedAt: now,
      },
    });
}

function toSummary(row: typeof callSessions.$inferSelect): CallSessionSummary {
  return {
    id: row.id,
    peer: row.peerActorApId,
    direction: row.direction as CallDirection,
    state: row.state as CallState,
    media: { audio: row.mediaAudio === 1, video: row.mediaVideo === 1 },
    createdAt: row.createdAt,
    connectedAt: row.connectedAt,
    endedAt: row.endedAt,
    endReason: row.endReason,
  };
}

export async function listCallSessions(
  db: Database,
  localActorApId: string,
  limit = 50,
): Promise<CallSessionSummary[]> {
  const rows = await db
    .select()
    .from(callSessions)
    .where(eq(callSessions.localActorApId, localActorApId))
    .orderBy(desc(callSessions.createdAt))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toSummary);
}

export async function getCallSession(
  db: Database,
  localActorApId: string,
  callId: string,
): Promise<CallSessionSummary | null> {
  const row = await db
    .select()
    .from(callSessions)
    .where(
      and(
        eq(callSessions.id, callId),
        eq(callSessions.localActorApId, localActorApId),
      ),
    )
    .get();
  return row ? toSummary(row) : null;
}
