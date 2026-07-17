/**
 * Runtime-neutral call signaling engine.
 *
 * `CallHub` owns one local actor's per-call state machine and routes signaling
 * frames between the local browser tabs and the peer instance (server-to-server).
 * It is deliberately free of Cloudflare / Bun APIs: the Cloudflare
 * `CallSignalingDurableObject` and the in-process `LocalSignalingHub` (Bun dev /
 * tests) both wrap this same engine, so glare resolution, timeouts, and relay
 * live in exactly one place.
 *
 * Connections are NOT held by the hub — the host owns them (the DO enumerates
 * its live Hibernatable WebSockets on demand) and exposes `broadcast`/`hasClients`
 * through the port. That keeps the hub correct across DO hibernation, where any
 * in-memory socket set would be lost. Per-call state is persisted by the host
 * (`persist`) and rehydrated via `hydrate`.
 *
 * The wire contract lives in the client-API package (single source of truth,
 * shared with the browser `CallClient`).
 */

import type {
  CallDirection,
  CallMediaKind,
  CallState,
  ClientToHubFrame,
  HubToClientFrame,
  IceServerConfig,
  RtcSignalEnvelopeV1,
  SfuFocus,
} from "../../../packages/api/src/types/call.ts";
import {
  isEnvelopeFresh,
  isTerminalCallState,
  RTC_SIGNAL_ENVELOPE_VERSION,
} from "../../../packages/api/src/types/call.ts";

/** A live browser WebSocket, abstracted from the runtime. */
export interface HubConnection {
  send(frame: HubToClientFrame): void;
  close(code?: number, reason?: string): void;
}

/** In-flight call, tracked per hub (= per local actor). */
export interface CallRecord {
  callId: string;
  peerApId: string;
  peerSignalEndpoint?: string;
  direction: CallDirection;
  state: CallState;
  media: CallMediaKind;
  sfuFocus: SfuFocus | null;
  createdAt: number;
  updatedAt: number;
  connectedAt?: number;
}

/** Side-effect port the hosting runtime supplies. */
export interface HubPort {
  /** The local actor (ap_id) this hub serves. */
  readonly localActorApId: string;
  /** Send a frame to every live local browser tab. */
  broadcast(frame: HubToClientFrame): void;
  /** Whether any local browser tab is currently connected. */
  hasClients(): boolean;
  /** Sign + POST a signaling envelope to the peer's instance (s2s). */
  sendToPeer(
    envelope: RtcSignalEnvelopeV1,
    peerSignalEndpoint?: string,
  ): Promise<void>;
  /** ICE servers (+ optional SFU focus) for a call. */
  provisionMedia(
    media: CallMediaKind,
  ): Promise<{ iceServers: IceServerConfig[]; sfuFocus: SfuFocus | null }>;
  /** Best-effort persist of a call-session transition (history / missed-call). */
  persist?(call: CallRecord): Promise<void> | void;
  /** Best-effort wake of a possibly-offline callee (push-gateway ring). */
  ring?(envelope: RtcSignalEnvelopeV1): Promise<void> | void;
  now(): number;
  log?(event: string, data?: Record<string, unknown>): void;
}

// Ringing that never gets answered becomes a missed call; a call that never
// finishes ICE negotiation is failed. Kept generous — a slow federation hop
// plus a human deciding to answer can legitimately take tens of seconds.
const RINGING_TIMEOUT_MS = 45_000;
const CONNECTING_TIMEOUT_MS = 40_000;
// Default freshness window stamped on outbound envelopes.
const DEFAULT_TTL_MS = 30_000;

export class CallHub {
  private readonly calls = new Map<string, CallRecord>();

  constructor(private readonly port: HubPort) {}

  get localActorApId(): string {
    return this.port.localActorApId;
  }

  /** Snapshot of active (non-terminal) calls — used by the DO to persist. */
  activeCalls(): CallRecord[] {
    return [...this.calls.values()].filter(
      (c) => !isTerminalCallState(c.state),
    );
  }

  /** Restore calls from durable storage after DO hibernation. */
  hydrate(records: CallRecord[]): void {
    for (const rec of records) {
      if (!isTerminalCallState(rec.state)) this.calls.set(rec.callId, rec);
    }
  }

  private transition(call: CallRecord, state: CallState): void {
    call.state = state;
    call.updatedAt = this.port.now();
    if (state === "connected" && !call.connectedAt) {
      call.connectedAt = call.updatedAt;
    }
    void this.port.persist?.(call);
    this.port.broadcast({ t: "call-state", callId: call.callId, state });
    if (isTerminalCallState(state)) this.calls.delete(call.callId);
  }

  private makeEnvelope(
    call: CallRecord,
    type: RtcSignalEnvelopeV1["type"],
    extra: Partial<RtcSignalEnvelopeV1> = {},
  ): RtcSignalEnvelopeV1 {
    return {
      v: RTC_SIGNAL_ENVELOPE_VERSION,
      callId: call.callId,
      from: this.port.localActorApId,
      to: call.peerApId,
      type,
      ts: this.port.now(),
      ttlMs: DEFAULT_TTL_MS,
      ...extra,
    };
  }

  private async relay(
    call: CallRecord,
    type: RtcSignalEnvelopeV1["type"],
    extra: Partial<RtcSignalEnvelopeV1> = {},
  ): Promise<void> {
    try {
      await this.port.sendToPeer(
        this.makeEnvelope(call, type, extra),
        call.peerSignalEndpoint,
      );
    } catch (err) {
      this.port.log?.("call.hub.relay_failed", {
        callId: call.callId,
        type,
        error: String(err),
      });
      // A signaling frame we cannot deliver dooms the call; surface it.
      this.port.broadcast({
        t: "error",
        code: "peer_unreachable",
        message: "Could not reach the other party's server.",
      });
      this.transition(call, "failed");
    }
  }

  // -------------------------------------------------------------------------
  // Browser -> hub
  // -------------------------------------------------------------------------

  async handleClientFrame(
    conn: HubConnection,
    frame: ClientToHubFrame,
  ): Promise<void> {
    switch (frame.t) {
      case "hello":
        conn.send({ t: "ready" });
        // Re-announce any active calls so a reconnecting tab resyncs.
        for (const call of this.activeCalls()) {
          conn.send({
            t: "call-state",
            callId: call.callId,
            state: call.state,
          });
        }
        return;
      case "ping":
        conn.send({ t: "pong" });
        return;
      case "invite":
        return this.onClientInvite(conn, frame);
      case "offer":
        return this.onClientOffer(frame);
      case "answer":
        return this.onClientAnswer(frame);
      case "candidates":
        return this.onClientCandidates(frame);
      case "accept":
        return this.onClientAccept(frame);
      case "reject":
        return this.onClientReject(frame);
      case "hangup":
        return this.onClientHangup(frame);
      case "resume":
        return this.onClientResume(conn, frame);
    }
  }

  private async onClientInvite(
    conn: HubConnection,
    frame: Extract<ClientToHubFrame, { t: "invite" }>,
  ): Promise<void> {
    if (this.calls.has(frame.callId)) return;
    const media = await this.port.provisionMedia(frame.media);
    const now = this.port.now();
    const call: CallRecord = {
      callId: frame.callId,
      peerApId: frame.to,
      direction: "outgoing",
      state: "ringing",
      media: frame.media,
      sfuFocus: media.sfuFocus,
      createdAt: now,
      updatedAt: now,
    };
    this.calls.set(call.callId, call);
    void this.port.persist?.(call);
    // Hand the caller its media params immediately so it can build the offer.
    conn.send({
      t: "ice-servers",
      callId: call.callId,
      iceServers: media.iceServers,
      sfuFocus: media.sfuFocus,
    });
    this.port.broadcast({
      t: "call-state",
      callId: call.callId,
      state: "ringing",
    });
  }

  private async onClientOffer(
    frame: Extract<ClientToHubFrame, { t: "offer" }>,
  ): Promise<void> {
    const call = this.calls.get(frame.callId);
    if (!call) return;
    await this.relay(call, "offer", { sdp: frame.sdp, media: call.media });
  }

  private async onClientAnswer(
    frame: Extract<ClientToHubFrame, { t: "answer" }>,
  ): Promise<void> {
    const call = this.calls.get(frame.callId);
    if (!call) return;
    if (call.state === "ringing") this.transition(call, "connecting");
    await this.relay(call, "answer", { sdp: frame.sdp });
  }

  private async onClientCandidates(
    frame: Extract<ClientToHubFrame, { t: "candidates" }>,
  ): Promise<void> {
    const call = this.calls.get(frame.callId);
    if (!call || frame.candidates.length === 0) return;
    await this.relay(call, "candidate", { candidates: frame.candidates });
  }

  private async onClientAccept(
    frame: Extract<ClientToHubFrame, { t: "accept" }>,
  ): Promise<void> {
    const call = this.calls.get(frame.callId);
    if (!call) return;
    // Local user accepted an incoming ring; tell the caller and move forward.
    if (call.state === "ringing") this.transition(call, "connecting");
    await this.relay(call, "accept");
  }

  private async onClientReject(
    frame: Extract<ClientToHubFrame, { t: "reject" }>,
  ): Promise<void> {
    const call = this.calls.get(frame.callId);
    if (!call) return;
    await this.relay(call, "reject", { reason: frame.reason });
    this.transition(call, "rejected");
  }

  private async onClientHangup(
    frame: Extract<ClientToHubFrame, { t: "hangup" }>,
  ): Promise<void> {
    const call = this.calls.get(frame.callId);
    if (!call) return;
    // A hangup before connection from the caller side is a cancel.
    const wasConnected = call.state === "connected";
    await this.relay(call, wasConnected ? "hangup" : "cancel", {
      reason: frame.reason,
    });
    this.transition(call, wasConnected ? "ended" : "cancelled");
  }

  private onClientResume(
    conn: HubConnection,
    frame: Extract<ClientToHubFrame, { t: "resume" }>,
  ): void {
    const call = this.calls.get(frame.callId);
    conn.send({
      t: "call-state",
      callId: frame.callId,
      state: call ? call.state : "ended",
    });
  }

  // -------------------------------------------------------------------------
  // Peer instance -> hub (inbound cross-instance signal)
  // -------------------------------------------------------------------------

  async handleInboundSignal(envelope: RtcSignalEnvelopeV1): Promise<void> {
    if (!isEnvelopeFresh(envelope, this.port.now())) {
      this.port.log?.("call.hub.stale_signal", { callId: envelope.callId });
      return;
    }
    switch (envelope.type) {
      case "offer":
        return this.onPeerOffer(envelope);
      case "answer":
        this.onPeerAnswer(envelope);
        return;
      case "candidate":
        this.onPeerCandidate(envelope);
        return;
      case "accept":
        this.onPeerAccept(envelope);
        return;
      case "reject":
        this.onPeerReject(envelope);
        return;
      case "hangup":
      case "cancel":
        this.onPeerHangup(envelope);
        return;
    }
  }

  private async onPeerOffer(envelope: RtcSignalEnvelopeV1): Promise<void> {
    let call = this.calls.get(envelope.callId);
    if (!call) {
      // Glare: we are already ringing this same peer (a DIFFERENT callId) and
      // their offer arrives — both sides dialed at once. Perfect Negotiation:
      // the lexicographically-lower ap_id is "impolite" and keeps its own
      // outgoing call (ignoring the incoming offer); the "polite" higher ap_id
      // cancels its outgoing call and accepts the incoming one. Both sides then
      // converge on the impolite side's call.
      const outgoingToPeer = [...this.calls.values()].find(
        (c) =>
          c.direction === "outgoing" &&
          c.peerApId === envelope.from &&
          c.state === "ringing",
      );
      if (outgoingToPeer) {
        const weArePolite = this.localActorApId > envelope.from;
        if (!weArePolite) return; // keep our outgoing offer; ignore theirs
        await this.relay(outgoingToPeer, "cancel", { reason: "glare" });
        this.transition(outgoingToPeer, "cancelled");
      }
    }
    if (!call) {
      const now = this.port.now();
      call = {
        callId: envelope.callId,
        peerApId: envelope.from,
        direction: "incoming",
        state: "ringing",
        media: envelope.media ?? { audio: true, video: false },
        sfuFocus: envelope.sfuFocus ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.calls.set(call.callId, call);
      void this.port.persist?.(call);
    }
    // Wake an offline client (best effort) and ring any live ones.
    void this.port.ring?.(envelope);
    if (this.port.hasClients()) {
      const media = await this.port.provisionMedia(call.media);
      this.port.broadcast({
        t: "ice-servers",
        callId: call.callId,
        iceServers: media.iceServers,
        sfuFocus: media.sfuFocus,
      });
      this.port.broadcast({
        t: "ringing",
        callId: call.callId,
        from: call.peerApId,
        media: call.media,
      });
    }
    if (envelope.sdp) {
      this.port.broadcast({
        t: "offer",
        callId: call.callId,
        sdp: envelope.sdp,
        media: call.media,
      });
    }
  }

  private onPeerAnswer(envelope: RtcSignalEnvelopeV1): void {
    const call = this.calls.get(envelope.callId);
    if (!call || !envelope.sdp) return;
    if (call.state === "ringing") this.transition(call, "connecting");
    this.port.broadcast({
      t: "answer",
      callId: call.callId,
      sdp: envelope.sdp,
    });
  }

  private onPeerCandidate(envelope: RtcSignalEnvelopeV1): void {
    const call = this.calls.get(envelope.callId);
    if (!call || !envelope.candidates?.length) return;
    this.port.broadcast({
      t: "candidates",
      callId: call.callId,
      candidates: envelope.candidates,
    });
  }

  private onPeerAccept(envelope: RtcSignalEnvelopeV1): void {
    const call = this.calls.get(envelope.callId);
    if (!call) return;
    if (call.state === "ringing") this.transition(call, "connecting");
    this.port.broadcast({ t: "peer-accepted", callId: call.callId });
  }

  private onPeerReject(envelope: RtcSignalEnvelopeV1): void {
    const call = this.calls.get(envelope.callId);
    if (!call) return;
    this.port.broadcast({
      t: "peer-rejected",
      callId: call.callId,
      reason: envelope.reason,
    });
    this.transition(call, "rejected");
  }

  private onPeerHangup(envelope: RtcSignalEnvelopeV1): void {
    const call = this.calls.get(envelope.callId);
    if (!call) return;
    this.port.broadcast({
      t: "peer-hangup",
      callId: call.callId,
      reason: envelope.reason,
    });
    this.transition(call, call.connectedAt ? "ended" : "cancelled");
  }

  /** Promote a call to connected (client signals ICE established). */
  markConnected(callId: string): void {
    const call = this.calls.get(callId);
    if (call && call.state !== "connected") this.transition(call, "connected");
  }

  // -------------------------------------------------------------------------
  // Periodic sweep (DO alarm / dev interval) — expire stuck calls
  // -------------------------------------------------------------------------

  tick(): void {
    const now = this.port.now();
    for (const call of [...this.calls.values()]) {
      const age = now - call.updatedAt;
      if (call.state === "ringing" && age > RINGING_TIMEOUT_MS) {
        this.transition(
          call,
          call.direction === "incoming" ? "missed" : "cancelled",
        );
      } else if (call.state === "connecting" && age > CONNECTING_TIMEOUT_MS) {
        this.transition(call, "failed");
      }
    }
  }
}
