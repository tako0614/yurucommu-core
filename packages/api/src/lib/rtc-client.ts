/**
 * CallClient — framework-agnostic browser WebRTC engine for the call feature.
 *
 * Owns the WebSocket to the per-user signaling hub (`/api/rtc/socket`), the
 * `RTCPeerConnection` lifecycle, `getUserMedia`, half-trickle ICE, and the call
 * state machine as the browser sees it. Both products (yurucommu / yurumeet)
 * wrap this with their own reactive state layer (SolidJS signals / jotai) — no
 * WebRTC logic is duplicated per product, and the wire protocol is single-
 * sourced with the backend via `./types/call.ts`.
 *
 * 1:1 only for now: the caller offers, the callee answers, media is P2P over the
 * server-provided ICE (STUN/TURN) servers. Camera on/off toggles the existing
 * video track (no mid-call renegotiation, so no glare at the PC level).
 */

import type {
  CallMediaKind,
  ClientToHubFrame,
  HubToClientFrame,
  IceServerConfig,
} from "../types/call.ts";

export type CallUiState =
  | "idle"
  | "calling" // outgoing, ringing
  | "incoming" // inbound ring, awaiting accept/decline
  | "connecting"
  | "connected"
  | "ended";

export interface IncomingCallInfo {
  callId: string;
  from: string;
  media: CallMediaKind;
}

export interface CallClientEvents {
  state: (state: CallUiState) => void;
  incoming: (info: IncomingCallInfo) => void;
  localstream: (stream: MediaStream | null) => void;
  remotestream: (stream: MediaStream | null) => void;
  muted: (muted: boolean) => void;
  cameraoff: (off: boolean) => void;
  error: (code: string, message?: string) => void;
}

export interface CallClientOptions {
  /** Origin the app is served from (defaults to the page origin). */
  origin?: string;
  /** WebSocket reconnect backoff ceiling (ms). */
  maxBackoffMs?: number;
}

type Listener = (...args: never[]) => void;

interface ActiveCall {
  callId: string;
  peer: string;
  media: CallMediaKind;
  role: "caller" | "callee";
  pc: RTCPeerConnection | null;
  iceServers: IceServerConfig[];
  pendingRemoteCandidates: RTCIceCandidateInit[];
  candidateBuffer: RTCIceCandidateInit[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  remoteDescriptionSet: boolean;
}

const CANDIDATE_FLUSH_MS = 200;

export class CallClient {
  private ws: WebSocket | null = null;
  private wantConnected = false;
  private backoff = 500;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<keyof CallClientEvents, Set<Listener>>();
  private call: ActiveCall | null = null;
  private localStream: MediaStream | null = null;
  private state: CallUiState = "idle";

  constructor(private readonly options: CallClientOptions = {}) {}

  // --- events ---------------------------------------------------------------
  on<K extends keyof CallClientEvents>(
    event: K,
    listener: CallClientEvents[K],
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener);
    return () => set?.delete(listener as Listener);
  }

  private emit<K extends keyof CallClientEvents>(
    event: K,
    ...args: Parameters<CallClientEvents[K]>
  ): void {
    for (const l of this.listeners.get(event) ?? []) {
      (l as (...a: unknown[]) => void)(...args);
    }
  }

  private setState(state: CallUiState): void {
    if (this.state === state) return;
    this.state = state;
    this.emit("state", state);
  }

  getState(): CallUiState {
    return this.state;
  }

  // --- connection -----------------------------------------------------------
  private origin(): string {
    return (
      this.options.origin ??
      (typeof location !== "undefined" ? location.origin : "")
    );
  }

  private socketUrl(): string {
    const o = this.origin();
    return `${o.replace(/^http/, "ws")}/api/rtc/socket`;
  }

  connect(): void {
    this.wantConnected = true;
    this.openSocket();
  }

  disconnect(): void {
    this.wantConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.socketUrl());
    } catch (err) {
      this.emit("error", "socket_open_failed", String(err));
      this.scheduleReconnect();
      return;
    }
    this.ws = socket;
    socket.onopen = () => {
      this.backoff = 500;
      this.send({ t: "hello" });
      if (this.call) this.send({ t: "resume", callId: this.call.callId });
    };
    socket.onmessage = (ev) => {
      void this.onFrame(ev.data);
    };
    socket.onclose = () => {
      if (this.ws === socket) this.ws = null;
      if (this.wantConnected) this.scheduleReconnect();
    };
    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer) return;
    const max = this.options.maxBackoffMs ?? 15_000;
    const delay = Math.min(this.backoff, max);
    this.backoff = Math.min(this.backoff * 2, max);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocket();
    }, delay);
  }

  private send(frame: ClientToHubFrame): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
  }

  // --- public call control --------------------------------------------------

  /** Place an outgoing call. Fetches a callId + ICE, then rings the peer. */
  async startCall(peer: string, media: CallMediaKind): Promise<void> {
    if (this.call) throw new Error("already in a call");
    const res = await fetch(`${this.origin()}/api/rtc/calls`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: peer, media }),
    });
    if (!res.ok) {
      const code = res.status === 403 ? "blocked" : "start_failed";
      this.emit("error", code);
      throw new Error(code);
    }
    const data = (await res.json()) as {
      callId: string;
      iceServers: IceServerConfig[];
    };
    this.call = this.newCall(
      data.callId,
      peer,
      media,
      "caller",
      data.iceServers,
    );
    this.setState("calling");
    this.connect();
    this.send({ t: "invite", callId: data.callId, to: peer, media });
    await this.setupMedia(this.call);
    await this.makeOffer(this.call);
  }

  /** Accept the current incoming call. */
  async accept(): Promise<void> {
    const call = this.call;
    if (!call || call.role !== "callee") return;
    this.setState("connecting");
    this.send({ t: "accept", callId: call.callId });
    await this.setupMedia(call);
    // The offer was already applied on arrival; create + send the answer.
    if (call.pc && call.remoteDescriptionSet) {
      const answer = await call.pc.createAnswer();
      await call.pc.setLocalDescription(answer);
      this.send({ t: "answer", callId: call.callId, sdp: answer.sdp ?? "" });
    }
  }

  /** Decline the current incoming call. */
  reject(reason = "declined"): void {
    const call = this.call;
    if (!call) return;
    this.send({ t: "reject", callId: call.callId, reason });
    this.teardown("ended");
  }

  /** Hang up / cancel the active call. */
  hangup(reason = "hangup"): void {
    const call = this.call;
    if (!call) return;
    this.send({ t: "hangup", callId: call.callId, reason });
    this.teardown("ended");
  }

  setMuted(muted: boolean): void {
    for (const track of this.localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    this.emit("muted", muted);
  }

  setCameraEnabled(enabled: boolean): void {
    for (const track of this.localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled;
    }
    this.emit("cameraoff", !enabled);
  }

  // --- frame handling -------------------------------------------------------
  private async onFrame(raw: unknown): Promise<void> {
    if (typeof raw !== "string") return;
    let frame: HubToClientFrame;
    try {
      frame = JSON.parse(raw) as HubToClientFrame;
    } catch {
      return;
    }
    switch (frame.t) {
      case "ready":
      case "pong":
        return;
      case "ringing":
        this.onRinging(frame);
        return;
      case "ice-servers":
        if (this.call && this.call.callId === frame.callId) {
          this.call.iceServers = frame.iceServers;
        }
        return;
      case "offer":
        await this.onRemoteOffer(frame);
        return;
      case "answer":
        await this.onRemoteAnswer(frame);
        return;
      case "candidates":
        await this.onRemoteCandidates(frame);
        return;
      case "peer-accepted":
        if (this.state === "calling") this.setState("connecting");
        return;
      case "peer-rejected":
        this.emit("error", "declined", frame.reason);
        this.teardown("ended");
        return;
      case "peer-hangup":
        this.teardown("ended");
        return;
      case "call-state":
        this.onCallState(frame);
        return;
      case "error":
        this.emit("error", frame.code, frame.message);
        if (frame.code === "peer_unreachable") this.teardown("ended");
        return;
    }
  }

  private onRinging(frame: Extract<HubToClientFrame, { t: "ringing" }>): void {
    if (this.call) {
      // Already busy — auto-decline the second ring.
      this.send({ t: "reject", callId: frame.callId, reason: "busy" });
      return;
    }
    this.call = this.newCall(
      frame.callId,
      frame.from,
      frame.media,
      "callee",
      [],
    );
    this.setState("incoming");
    this.emit("incoming", {
      callId: frame.callId,
      from: frame.from,
      media: frame.media,
    });
  }

  private onCallState(
    frame: Extract<HubToClientFrame, { t: "call-state" }>,
  ): void {
    if (!this.call || this.call.callId !== frame.callId) return;
    if (
      frame.state === "missed" ||
      frame.state === "cancelled" ||
      frame.state === "rejected" ||
      frame.state === "failed" ||
      frame.state === "ended"
    ) {
      this.teardown("ended");
    }
  }

  private async onRemoteOffer(
    frame: Extract<HubToClientFrame, { t: "offer" }>,
  ): Promise<void> {
    let call = this.call;
    if (!call || call.callId !== frame.callId) {
      // Offer for a call we have not seen a ring for yet — adopt it.
      call = this.newCall(
        frame.callId,
        "unknown",
        frame.media ?? { audio: true, video: false },
        "callee",
        [],
      );
      this.call = call;
      this.setState("incoming");
    }
    if (!call.pc) this.buildPeerConnection(call);
    await call.pc?.setRemoteDescription({ type: "offer", sdp: frame.sdp });
    call.remoteDescriptionSet = true;
    await this.drainRemoteCandidates(call);
  }

  private async onRemoteAnswer(
    frame: Extract<HubToClientFrame, { t: "answer" }>,
  ): Promise<void> {
    const call = this.call;
    if (!call || call.callId !== frame.callId || !call.pc) return;
    await call.pc.setRemoteDescription({ type: "answer", sdp: frame.sdp });
    call.remoteDescriptionSet = true;
    await this.drainRemoteCandidates(call);
  }

  private async onRemoteCandidates(
    frame: Extract<HubToClientFrame, { t: "candidates" }>,
  ): Promise<void> {
    const call = this.call;
    if (!call || call.callId !== frame.callId) return;
    for (const cand of frame.candidates) {
      if (call.pc && call.remoteDescriptionSet) {
        try {
          await call.pc.addIceCandidate(cand);
        } catch {
          // ignore malformed candidate
        }
      } else {
        call.pendingRemoteCandidates.push(cand);
      }
    }
  }

  private async drainRemoteCandidates(call: ActiveCall): Promise<void> {
    if (!call.pc) return;
    const pending = call.pendingRemoteCandidates.splice(0);
    for (const cand of pending) {
      try {
        await call.pc.addIceCandidate(cand);
      } catch {
        // ignore
      }
    }
  }

  // --- media + peer connection ---------------------------------------------
  private async setupMedia(call: ActiveCall): Promise<void> {
    if (!this.localStream) {
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: call.media.audio,
          video: call.media.video,
        });
      } catch (err) {
        this.emit("error", "media_denied", String(err));
        this.hangup("media_denied");
        return;
      }
      this.emit("localstream", this.localStream);
    }
    if (!call.pc) this.buildPeerConnection(call);
    for (const track of this.localStream.getTracks()) {
      call.pc?.addTrack(track, this.localStream);
    }
  }

  private buildPeerConnection(call: ActiveCall): void {
    const pc = new RTCPeerConnection({
      iceServers: call.iceServers.map((s) => ({
        urls: s.urls,
        username: s.username,
        credential: s.credential,
      })),
    });
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.bufferCandidate(call, ev.candidate.toJSON());
      else this.flushCandidates(call);
    };
    pc.ontrack = (ev) => {
      this.emit("remotestream", ev.streams[0] ?? null);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") this.setState("connected");
      else if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        this.teardown("ended");
      }
    };
    call.pc = pc;
  }

  private async makeOffer(call: ActiveCall): Promise<void> {
    if (!call.pc) this.buildPeerConnection(call);
    const offer = await call.pc!.createOffer();
    await call.pc!.setLocalDescription(offer);
    this.send({ t: "offer", callId: call.callId, sdp: offer.sdp ?? "" });
  }

  private bufferCandidate(call: ActiveCall, cand: RTCIceCandidateInit): void {
    call.candidateBuffer.push(cand);
    if (call.flushTimer) return;
    call.flushTimer = setTimeout(
      () => this.flushCandidates(call),
      CANDIDATE_FLUSH_MS,
    );
  }

  private flushCandidates(call: ActiveCall): void {
    if (call.flushTimer) {
      clearTimeout(call.flushTimer);
      call.flushTimer = null;
    }
    if (call.candidateBuffer.length === 0) return;
    const candidates = call.candidateBuffer.splice(0).map((c) => ({
      candidate: c.candidate ?? "",
      sdpMid: c.sdpMid ?? null,
      sdpMLineIndex: c.sdpMLineIndex ?? null,
      usernameFragment: c.usernameFragment ?? null,
    }));
    this.send({ t: "candidates", callId: call.callId, candidates });
  }

  private newCall(
    callId: string,
    peer: string,
    media: CallMediaKind,
    role: "caller" | "callee",
    iceServers: IceServerConfig[],
  ): ActiveCall {
    return {
      callId,
      peer,
      media,
      role,
      pc: null,
      iceServers,
      pendingRemoteCandidates: [],
      candidateBuffer: [],
      flushTimer: null,
      remoteDescriptionSet: false,
    };
  }

  private teardown(finalState: CallUiState): void {
    const call = this.call;
    if (call) {
      if (call.flushTimer) clearTimeout(call.flushTimer);
      call.pc?.getSenders().forEach((s) => s.track?.stop());
      try {
        call.pc?.close();
      } catch {
        // ignore
      }
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
      this.emit("localstream", null);
    }
    this.emit("remotestream", null);
    this.call = null;
    this.setState(finalState);
    // Return to idle shortly so the UI can show an "ended" flash then reset.
    if (finalState === "ended") {
      setTimeout(() => {
        if (!this.call) this.setState("idle");
      }, 400);
    }
  }
}
