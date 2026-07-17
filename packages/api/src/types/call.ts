/**
 * Call signaling wire contract (voice + video).
 *
 * SINGLE SOURCE OF TRUTH shared by:
 *   - the backend cross-instance signaling ingest (`/ap/rtc/signal`) + the
 *     Signaling Durable Object (server-to-server + browser fan-out), and
 *   - the browser `CallClient` (`../lib/rtc-client.ts`).
 *
 * Kept deliberately DOM-structural (no `RTCIceCandidateInit` / `RTCIceServer`
 * imports) so the same file type-checks in the server context (which never runs
 * the browser WebRTC APIs) and the browser bundle. The `CallClient` maps these
 * structural shapes to/from the real DOM `RTCSessionDescriptionInit` /
 * `RTCIceCandidateInit` / `RTCIceServer`, which are structurally compatible.
 *
 * Design: signaling travels over federation (server-to-server, HTTP-Signature
 * authenticated) as `RtcSignalEnvelopeV1`; media is P2P WebRTC + STUN/TURN for
 * 1:1 (`sfuFocus: null`) and a pluggable WHIP/WHEP SFU focus for group calls.
 */

export const RTC_SIGNAL_ENVELOPE_VERSION = 1 as const;

/** Which media tracks a call carries. `video:false` => audio-only call. */
export interface CallMediaKind {
  audio: boolean;
  video: boolean;
}

/** Cross-instance signaling message kinds (Matrix-VoIP inspired). */
export type RtcSignalType =
  "offer" | "answer" | "candidate" | "accept" | "reject" | "hangup" | "cancel";

/**
 * Selected SFU focus for a group call. `null`/absent means pure P2P (1:1).
 * `kind` names the adapter (`whip` / `livekit` / `cloudflare-realtime` / ...);
 * the client talks WHIP/WHEP so the SFU backend stays vendor-neutral.
 */
export interface SfuFocus {
  kind: string;
  /** WHIP (publish) / WHEP (subscribe) endpoint base, or SFU signaling URL. */
  url: string;
  /** Short-lived join token when the adapter requires one. */
  token?: string;
  room?: string;
}

/** Structural mirror of `RTCIceCandidateInit` (no DOM dependency). */
export interface CallIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

/** Structural mirror of `RTCIceServer` (no DOM dependency). */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Server-to-server signaling envelope. Delivered by the sending instance to the
 * recipient instance's `/ap/rtc/signal` endpoint, signed with the sender actor's
 * HTTP Signature key (keyId-owner === `from`). `callId` doubles as the anti-
 * replay nonce; `ts`/`ttlMs` bound its freshness (the DO drops stale frames).
 */
export interface RtcSignalEnvelopeV1 {
  v: typeof RTC_SIGNAL_ENVELOPE_VERSION;
  callId: string;
  from: string;
  to: string;
  type: RtcSignalType;
  media?: CallMediaKind;
  /** SDP for `offer` / `answer`. */
  sdp?: string;
  /** Half-trickle ICE bundle for `offer` / `answer` / `candidate`. */
  candidates?: CallIceCandidate[];
  sfuFocus?: SfuFocus | null;
  /** Free-text end/reject reason (`busy`, `declined`, `timeout`, ...). */
  reason?: string;
  ts: number;
  ttlMs: number;
}

/** Lifecycle of a single call, mirrored client-side and in `call_sessions`. */
export type CallState =
  | "idle"
  | "ringing"
  | "connecting"
  | "connected"
  | "ended"
  | "rejected"
  | "missed"
  | "failed"
  | "cancelled";

export type CallDirection = "incoming" | "outgoing";

/** Terminal states — a call in one of these is over and not resumable. */
export const TERMINAL_CALL_STATES: readonly CallState[] = [
  "ended",
  "rejected",
  "missed",
  "failed",
  "cancelled",
];

export function isTerminalCallState(state: CallState): boolean {
  return TERMINAL_CALL_STATES.includes(state);
}

// ---------------------------------------------------------------------------
// Browser <-> Signaling Durable Object WebSocket frames
// ---------------------------------------------------------------------------

/** Frames the browser sends up to its own instance's Signaling DO. */
export type ClientToHubFrame =
  | { t: "hello" }
  | { t: "invite"; callId: string; to: string; media: CallMediaKind }
  | { t: "offer"; callId: string; sdp: string }
  | { t: "answer"; callId: string; sdp: string }
  | { t: "candidates"; callId: string; candidates: CallIceCandidate[] }
  | { t: "accept"; callId: string }
  | { t: "reject"; callId: string; reason?: string }
  | { t: "hangup"; callId: string; reason?: string }
  | { t: "resume"; callId: string }
  | { t: "ping" };

/** Frames the Signaling DO pushes down to the browser. */
export type HubToClientFrame =
  | { t: "ready" }
  | { t: "ringing"; callId: string; from: string; media: CallMediaKind }
  | { t: "offer"; callId: string; sdp: string; media?: CallMediaKind }
  | { t: "answer"; callId: string; sdp: string }
  | { t: "candidates"; callId: string; candidates: CallIceCandidate[] }
  | { t: "peer-accepted"; callId: string }
  | { t: "peer-rejected"; callId: string; reason?: string }
  | { t: "peer-hangup"; callId: string; reason?: string }
  | {
      t: "ice-servers";
      callId: string;
      iceServers: IceServerConfig[];
      sfuFocus?: SfuFocus | null;
    }
  | { t: "call-state"; callId: string; state: CallState }
  | { t: "pong" }
  | { t: "error"; code: string; message?: string };

// ---------------------------------------------------------------------------
// REST contract (start call / mint ICE / call history)
// ---------------------------------------------------------------------------

export interface StartCallRequest {
  to: string;
  media: CallMediaKind;
}

export interface StartCallResponse {
  callId: string;
  iceServers: IceServerConfig[];
  sfuFocus?: SfuFocus | null;
}

export interface IceServersResponse {
  iceServers: IceServerConfig[];
}

export interface CallSessionSummary {
  id: string;
  peer: string;
  direction: CallDirection;
  state: CallState;
  media: CallMediaKind;
  createdAt: string;
  connectedAt?: string | null;
  endedAt?: string | null;
  endReason?: string | null;
}

// ---------------------------------------------------------------------------
// Runtime validation (used by the backend ingest to reject malformed frames)
// ---------------------------------------------------------------------------

const SIGNAL_TYPES: readonly RtcSignalType[] = [
  "offer",
  "answer",
  "candidate",
  "accept",
  "reject",
  "hangup",
  "cancel",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCallMediaKind(value: unknown): value is CallMediaKind {
  return (
    isPlainObject(value) &&
    typeof value.audio === "boolean" &&
    typeof value.video === "boolean"
  );
}

function parseCandidates(value: unknown): CallIceCandidate[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  const out: CallIceCandidate[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw) || typeof raw.candidate !== "string") continue;
    out.push({
      candidate: raw.candidate,
      sdpMid: typeof raw.sdpMid === "string" ? raw.sdpMid : null,
      sdpMLineIndex:
        typeof raw.sdpMLineIndex === "number" ? raw.sdpMLineIndex : null,
      usernameFragment:
        typeof raw.usernameFragment === "string" ? raw.usernameFragment : null,
    });
  }
  return out;
}

function parseSfuFocus(value: unknown): SfuFocus | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!isPlainObject(value)) return undefined;
  if (typeof value.kind !== "string" || typeof value.url !== "string") {
    return undefined;
  }
  return {
    kind: value.kind,
    url: value.url,
    token: typeof value.token === "string" ? value.token : undefined,
    room: typeof value.room === "string" ? value.room : undefined,
  };
}

/**
 * Parse + validate an inbound cross-instance signaling envelope. Returns the
 * normalized envelope or `null` when the shape is invalid. Callers additionally
 * enforce that the HTTP-Signature signer equals `from` and that the recipient
 * (`to`) is a local actor.
 */
export function parseRtcSignalEnvelope(
  input: unknown,
): RtcSignalEnvelopeV1 | null {
  if (!isPlainObject(input)) return null;
  if (input.v !== RTC_SIGNAL_ENVELOPE_VERSION) return null;
  const { callId, from, to, type, ts, ttlMs } = input;
  if (
    typeof callId !== "string" ||
    callId.length === 0 ||
    callId.length > 200 ||
    typeof from !== "string" ||
    from.length === 0 ||
    typeof to !== "string" ||
    to.length === 0 ||
    typeof type !== "string" ||
    !SIGNAL_TYPES.includes(type as RtcSignalType) ||
    typeof ts !== "number" ||
    !Number.isFinite(ts) ||
    typeof ttlMs !== "number" ||
    !Number.isFinite(ttlMs) ||
    ttlMs < 0
  ) {
    return null;
  }
  const sdp = typeof input.sdp === "string" ? input.sdp : undefined;
  // Guard against absurd SDP blobs abusing the endpoint as a relay.
  if (sdp !== undefined && sdp.length > 100_000) return null;
  return {
    v: RTC_SIGNAL_ENVELOPE_VERSION,
    callId,
    from,
    to,
    type: type as RtcSignalType,
    media: isCallMediaKind(input.media) ? input.media : undefined,
    sdp,
    candidates: parseCandidates(input.candidates),
    sfuFocus: parseSfuFocus(input.sfuFocus),
    reason:
      typeof input.reason === "string" ? input.reason.slice(0, 200) : undefined,
    ts,
    ttlMs,
  };
}

/** True when the envelope is still within its freshness window. */
export function isEnvelopeFresh(
  envelope: RtcSignalEnvelopeV1,
  now: number,
): boolean {
  // Reject frames from the future (clock skew tolerance) or past their TTL.
  const skewToleranceMs = 30_000;
  if (envelope.ts - now > skewToleranceMs) return false;
  return now - envelope.ts <= envelope.ttlMs;
}
