/**
 * Realtime stream wire contract (browser <-> per-user RealtimeStreamDO).
 *
 * One authenticated WebSocket per user carries every live update the client
 * used to poll for: talk messages, typing, read receipts, contact-list
 * changes, new notifications, and the authoritative unread counters. The
 * server pushes `RealtimeEvent` envelopes; the client sends only the small
 * control frames below (writes stay on the REST API).
 *
 * Event ids are a per-user monotonic sequence assigned by the Durable Object.
 * A reconnecting client offers its last seen id in `hello`; the DO replays the
 * gap from its ring buffer, or answers `resync` when the gap is older than the
 * buffer so the client re-fetches via the normal REST reads.
 */

export type RealtimeEventType =
  | "talk.message"
  | "talk.typing"
  | "talk.read"
  | "talk.contacts_changed"
  | "notification.new"
  | "unread";

export interface RealtimeEvent {
  /** Per-user monotonic sequence number (assigned by the stream DO). */
  id: number;
  type: RealtimeEventType;
  data: Record<string, unknown>;
}

/** `talk.message` payload. `other_ap_id` is from the RECEIVING user's view. */
export interface TalkMessageEventData {
  kind: "dm" | "community";
  /** DM: the counterpart actor (per-recipient). */
  other_ap_id?: string;
  /** Community chat: the community actor. */
  community_ap_id?: string;
  conversation_id?: string;
  message: {
    id: string;
    sender: {
      ap_id: string;
      username: string;
      preferred_username: string | null;
      name: string | null;
      icon_url: string | null;
    };
    content: string | null;
    attachments?: unknown[];
    created_at: string | null;
  };
}

export interface TalkTypingEventData {
  other_ap_id: string;
  is_typing: boolean;
  typed_at: string;
}

export interface TalkReadEventData {
  other_ap_id: string;
  conversation_id: string;
  last_read_at: string;
}

/** Authoritative unread counters (server-computed; never client-derived). */
export interface UnreadEventData {
  dm: number;
  community: number;
  talk_total: number;
  notifications: number;
}

// --- Client -> server frames -------------------------------------------------

export type RealtimeClientFrame =
  { t: "hello"; lastEventId?: number } | { t: "ping" } | { t: "pong" };

// --- Server -> client frames -------------------------------------------------

export type RealtimeServerFrame =
  | { t: "hello_ok"; lastEventId: number }
  | { t: "event"; event: RealtimeEvent }
  /** The requested replay gap is older than the buffer: re-fetch via REST. */
  | { t: "resync" }
  | { t: "ping" }
  | { t: "pong" };

export function parseRealtimeClientFrame(
  raw: unknown,
): RealtimeClientFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as { t?: unknown; lastEventId?: unknown };
  if (frame.t === "ping" || frame.t === "pong") return { t: frame.t };
  if (frame.t === "hello") {
    const lastEventId =
      typeof frame.lastEventId === "number" &&
      Number.isFinite(frame.lastEventId) &&
      frame.lastEventId >= 0
        ? Math.floor(frame.lastEventId)
        : undefined;
    return { t: "hello", lastEventId };
  }
  return null;
}

export function parseRealtimeServerFrame(
  raw: unknown,
): RealtimeServerFrame | null {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw as { t?: unknown; event?: unknown; lastEventId?: unknown };
  if (frame.t === "ping" || frame.t === "pong" || frame.t === "resync") {
    return { t: frame.t };
  }
  if (frame.t === "hello_ok" && typeof frame.lastEventId === "number") {
    return { t: "hello_ok", lastEventId: frame.lastEventId };
  }
  if (frame.t === "event" && frame.event && typeof frame.event === "object") {
    const event = frame.event as {
      id?: unknown;
      type?: unknown;
      data?: unknown;
    };
    if (typeof event.id === "number" && typeof event.type === "string") {
      return {
        t: "event",
        event: {
          id: event.id,
          type: event.type as RealtimeEventType,
          data:
            event.data && typeof event.data === "object"
              ? (event.data as Record<string, unknown>)
              : {},
        },
      };
    }
  }
  return null;
}
