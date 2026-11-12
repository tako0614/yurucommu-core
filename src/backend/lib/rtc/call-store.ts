/**
 * Durable persistence for call sessions (history / missed-call / current state).
 * Ephemeral SDP/ICE never touches this — only the call lifecycle does.
 */

import { and, desc, eq, notExists, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import { callSessions, legacyCallSessions, nowIso } from "../../../db/index.ts";
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
    .select(
      db
        .select({
          id: sql<string>`${call.callId}`.as("id"),
          localActorApId: sql<string>`${localActorApId}`.as(
            "local_actor_ap_id",
          ),
          peerActorApId:
            sql<string>`coalesce(${legacyCallSessions.peerActorApId}, ${call.peerApId})`.as(
              "peer_actor_ap_id",
            ),
          direction:
            sql<string>`coalesce(${legacyCallSessions.direction}, ${call.direction})`.as(
              "direction",
            ),
          state: sql<string>`${call.state}`.as("state"),
          mediaAudio:
            sql<number>`coalesce(${legacyCallSessions.mediaAudio}, ${call.media.audio ? 1 : 0})`.as(
              "media_audio",
            ),
          mediaVideo:
            sql<number>`coalesce(${legacyCallSessions.mediaVideo}, ${call.media.video ? 1 : 0})`.as(
              "media_video",
            ),
          sfuFocus: sql<string | null>`${sfuFocus}`.as("sfu_focus"),
          peerSignalEndpoint: sql<
            string | null
          >`${call.peerSignalEndpoint ?? null}`.as("peer_signal_endpoint"),
          endReason: sql<string | null>`${legacyCallSessions.endReason}`.as(
            "end_reason",
          ),
          createdAt:
            sql<string>`coalesce(${legacyCallSessions.createdAt}, ${now})`.as(
              "created_at",
            ),
          updatedAt: sql<string>`${now}`.as("updated_at"),
          connectedAt: sql<string | null>`${connectedAt}`.as("connected_at"),
          endedAt: sql<string | null>`${terminal ? now : null}`.as("ended_at"),
        })
        // One input row preserves the original FK failure for an absent owner.
        .from(sql`(SELECT 1) AS call_input`)
        .leftJoin(
          legacyCallSessions,
          and(
            eq(legacyCallSessions.id, call.callId),
            eq(legacyCallSessions.localActorApId, localActorApId),
          ),
        )
        // Disambiguate SQLite INSERT/SELECT's following ON CONFLICT clause.
        .where(sql`1`),
    )
    .onConflictDoUpdate({
      target: [callSessions.localActorApId, callSessions.id],
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

/** Merge retained legacy rows without backfilling or duplicating an own ID. */
function callHistory(db: Database, localActorApId: string, callId?: string) {
  return db
    .select()
    .from(callSessions)
    .where(
      and(
        eq(callSessions.localActorApId, localActorApId),
        callId === undefined ? undefined : eq(callSessions.id, callId),
      ),
    )
    .unionAll(
      db
        .select()
        .from(legacyCallSessions)
        .where(
          and(
            eq(legacyCallSessions.localActorApId, localActorApId),
            callId === undefined
              ? undefined
              : eq(legacyCallSessions.id, callId),
            notExists(
              db
                .select({ id: callSessions.id })
                .from(callSessions)
                .where(
                  and(
                    eq(
                      callSessions.localActorApId,
                      legacyCallSessions.localActorApId,
                    ),
                    eq(callSessions.id, legacyCallSessions.id),
                  ),
                ),
            ),
          ),
        ),
    );
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
  const rows = await callHistory(db, localActorApId)
    .orderBy(desc(sql`created_at`))
    .limit(Math.min(Math.max(limit, 1), 200));
  return rows.map(toSummary);
}

export async function getCallSession(
  db: Database,
  localActorApId: string,
  callId: string,
): Promise<CallSessionSummary | null> {
  const row = await callHistory(db, localActorApId, callId).limit(1).get();
  return row ? toSummary(row) : null;
}
