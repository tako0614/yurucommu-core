/**
 * Call sessions (WebRTC voice + video).
 *
 * One row per call, owned by the LOCAL actor. Ephemeral signaling (SDP/ICE)
 * never lands here — it flows over the dedicated `/ap/rtc/signal` transport and
 * the Signaling Durable Object. This table is the durable record: call history,
 * missed-call surfacing, and current-state lookups.
 */

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils.ts";
import { actors } from "./actors.ts";

function callSessionColumns() {
  return {
    // callId (client-minted uuid; also the signaling anti-replay nonce).
    id: text("id").notNull(),
    localActorApId: text("local_actor_ap_id")
      .notNull()
      .references(() => actors.apId, { onDelete: "cascade" }),
    peerActorApId: text("peer_actor_ap_id").notNull(),
    direction: text("direction").notNull(), // "incoming" | "outgoing"
    // CallState: ringing | connecting | connected | ended | missed | rejected |
    // failed | cancelled.
    state: text("state").notNull().default("ringing"),
    mediaAudio: integer("media_audio").notNull().default(1),
    mediaVideo: integer("media_video").notNull().default(0),
    // Selected SFU focus JSON, or NULL for pure P2P (1:1).
    sfuFocus: text("sfu_focus"),
    // Cached peer signaling endpoint so mid-call frames skip re-resolution.
    peerSignalEndpoint: text("peer_signal_endpoint"),
    endReason: text("end_reason"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIso)
      .$onUpdateFn(nowIso),
    connectedAt: text("connected_at"),
    endedAt: text("ended_at"),
  };
}

/** Applied legacy history remains readable without an in-place table rebuild. */
export const legacyCallSessions = sqliteTable(
  "call_sessions",
  { ...callSessionColumns(), id: text("id").primaryKey() },
  (t) => [
    index("call_sessions_local_created_idx").on(t.localActorApId, t.createdAt),
    index("call_sessions_state_idx").on(t.state),
  ],
);

/** A call identifier belongs to its local owner, not to every actor globally. */
export const callSessions = sqliteTable(
  "actor_call_sessions",
  callSessionColumns(),
  (t) => [
    primaryKey({ columns: [t.localActorApId, t.id] }),
    index("actor_call_sessions_local_created_idx").on(
      t.localActorApId,
      t.createdAt,
    ),
    index("actor_call_sessions_state_idx").on(t.state),
  ],
);
