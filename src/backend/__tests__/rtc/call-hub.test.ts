/**
 * Phase 0 signaling proof: drive two in-process CallHubs (two self-hosted
 * instances) through a full cross-instance call over the signaling plane, with
 * no real WebRTC/media. This exercises the exact state machine + relay + glare
 * logic the Durable Object and the Bun hub both run — the hardest, most
 * federation-sensitive part — without needing a browser.
 */

import { expect, test } from "bun:test";
import {
  CallHub,
  type CallRecord,
  type HubConnection,
  type HubPort,
} from "../../runtime/call-hub-core.ts";
import type {
  HubToClientFrame,
  RtcSignalEnvelopeV1,
} from "../../../../packages/api/src/types/call.ts";
import { parseRtcSignalEnvelope } from "../../../../packages/api/src/types/call.ts";

interface Side {
  hub: CallHub;
  conn: HubConnection;
  frames: HubToClientFrame[];
  setPeer: (deliver: (e: RtcSignalEnvelopeV1) => Promise<void>) => void;
  persisted: CallRecord[];
}

function makeSide(localApId: string, clock: () => number): Side {
  const frames: HubToClientFrame[] = [];
  const persisted: CallRecord[] = [];
  let deliverToPeer: (e: RtcSignalEnvelopeV1) => Promise<void> = async () => {};
  const port: HubPort = {
    localActorApId: localApId,
    broadcast: (f) => frames.push(f),
    hasClients: () => true,
    sendToPeer: async (envelope) => {
      await deliverToPeer(envelope);
    },
    provisionMedia: async () => ({
      iceServers: [{ urls: "stun:stun.example:3478" }],
      sfuFocus: null,
    }),
    persist: (call) => {
      persisted.push({ ...call });
    },
    now: clock,
    log: () => {},
  };
  const hub = new CallHub(port);
  const conn: HubConnection = { send: (f) => frames.push(f), close: () => {} };
  return {
    hub,
    conn,
    frames,
    persisted,
    setPeer: (d) => {
      deliverToPeer = d;
    },
  };
}

function wire(a: Side, b: Side): void {
  a.setPeer((e) => b.hub.handleInboundSignal(e));
  b.setPeer((e) => a.hub.handleInboundSignal(e));
}

const kinds = (frames: HubToClientFrame[]) => frames.map((f) => f.t);
const lastState = (frames: HubToClientFrame[]): string | undefined => {
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (f.t === "call-state") return f.state;
  }
  return undefined;
};

const A = "https://a.example/ap/users/alice";
const B = "https://b.example/ap/users/bob";

test("parseRtcSignalEnvelope accepts a valid offer and rejects junk", () => {
  const ok = parseRtcSignalEnvelope({
    v: 1,
    callId: "c1",
    from: A,
    to: B,
    type: "offer",
    sdp: "v=0...",
    media: { audio: true, video: true },
    ts: 1000,
    ttlMs: 30000,
  });
  expect(ok).not.toBeNull();
  expect(ok?.type).toBe("offer");
  expect(ok?.media).toEqual({ audio: true, video: true });

  expect(
    parseRtcSignalEnvelope({ v: 2, callId: "c", from: A, to: B }),
  ).toBeNull();
  expect(parseRtcSignalEnvelope({ v: 1, type: "offer" })).toBeNull();
  expect(
    parseRtcSignalEnvelope({
      v: 1,
      callId: "c",
      from: A,
      to: B,
      type: "nonsense",
      ts: 1,
      ttlMs: 1,
    }),
  ).toBeNull();
});

test("full 1:1 call: invite -> offer -> answer -> hangup across two instances", async () => {
  let now = 1_000_000;
  const clock = () => now;
  const a = makeSide(A, clock);
  const b = makeSide(B, clock);
  wire(a, b);
  const callId = "call-1";

  // A dials B.
  await a.hub.handleClientFrame(a.conn, {
    t: "invite",
    callId,
    to: B,
    media: { audio: true, video: true },
  });
  expect(kinds(a.frames)).toContain("ice-servers");
  expect(lastState(a.frames)).toBe("ringing");

  // A sends its SDP offer; it relays over federation into B.
  await a.hub.handleClientFrame(a.conn, { t: "offer", callId, sdp: "OFFER_A" });
  // B's browser is rung and handed the offer.
  expect(kinds(b.frames)).toContain("ringing");
  const bOffer = b.frames.find((f) => f.t === "offer");
  expect(bOffer && bOffer.t === "offer" && bOffer.sdp).toBe("OFFER_A");

  // B answers; it relays back to A.
  await b.hub.handleClientFrame(b.conn, {
    t: "answer",
    callId,
    sdp: "ANSWER_B",
  });
  const aAnswer = a.frames.find((f) => f.t === "answer");
  expect(aAnswer && aAnswer.t === "answer" && aAnswer.sdp).toBe("ANSWER_B");
  expect(lastState(a.frames)).toBe("connecting");
  expect(lastState(b.frames)).toBe("connecting");

  // ICE trickle both ways.
  await a.hub.handleClientFrame(a.conn, {
    t: "candidates",
    callId,
    candidates: [{ candidate: "candidate:A", sdpMLineIndex: 0 }],
  });
  const bCand = b.frames.find((f) => f.t === "candidates");
  expect(bCand && bCand.t === "candidates" && bCand.candidates.length).toBe(1);

  // A hangs up before "connected" -> both sides tear down.
  await a.hub.handleClientFrame(a.conn, { t: "hangup", callId });
  expect(lastState(b.frames)).toBe("cancelled");
  expect(a.hub.activeCalls()).toHaveLength(0);
  expect(b.hub.activeCalls()).toHaveLength(0);
});

test("reject: callee declines the incoming call", async () => {
  let now = 2_000_000;
  const a = makeSide(A, () => now);
  const b = makeSide(B, () => now);
  wire(a, b);
  const callId = "call-reject";

  await a.hub.handleClientFrame(a.conn, {
    t: "invite",
    callId,
    to: B,
    media: { audio: true, video: false },
  });
  await a.hub.handleClientFrame(a.conn, { t: "offer", callId, sdp: "O" });
  await b.hub.handleClientFrame(b.conn, {
    t: "reject",
    callId,
    reason: "busy",
  });

  const aRejected = a.frames.find((f) => f.t === "peer-rejected");
  expect(aRejected && aRejected.t === "peer-rejected" && aRejected.reason).toBe(
    "busy",
  );
  expect(a.hub.activeCalls()).toHaveLength(0);
  expect(b.hub.activeCalls()).toHaveLength(0);
});

test("glare: both dial simultaneously — impolite (lower ap_id) call wins", async () => {
  let now = 3_000_000;
  const a = makeSide(A, () => now); // A < B lexicographically => A is impolite
  const b = makeSide(B, () => now);
  wire(a, b);

  // Both invite + offer before either answer arrives.
  await a.hub.handleClientFrame(a.conn, {
    t: "invite",
    callId: "from-a",
    to: B,
    media: { audio: true, video: false },
  });
  await b.hub.handleClientFrame(b.conn, {
    t: "invite",
    callId: "from-b",
    to: A,
    media: { audio: true, video: false },
  });
  await a.hub.handleClientFrame(a.conn, {
    t: "offer",
    callId: "from-a",
    sdp: "OA",
  });
  await b.hub.handleClientFrame(b.conn, {
    t: "offer",
    callId: "from-b",
    sdp: "OB",
  });

  // Impolite A keeps its own outgoing call; polite B cancelled its outgoing and
  // adopted A's incoming call. Both converge on exactly one call: "from-a".
  const aActive = a.hub.activeCalls();
  const bActive = b.hub.activeCalls();
  expect(aActive.map((c) => c.callId)).toEqual(["from-a"]);
  expect(bActive.map((c) => c.callId)).toEqual(["from-a"]);
  expect(bActive[0]?.direction).toBe("incoming");
});

test("stale (expired-TTL) inbound signal is ignored", async () => {
  let now = 5_000_000;
  const a = makeSide(A, () => now);
  await a.hub.handleInboundSignal({
    v: 1,
    callId: "old",
    from: B,
    to: A,
    type: "offer",
    sdp: "O",
    ts: now - 60_000, // 60s old, ttl 30s
    ttlMs: 30_000,
  });
  expect(a.hub.activeCalls()).toHaveLength(0);
  expect(a.frames).toHaveLength(0);
});

test("ringing times out into a missed call", async () => {
  let now = 6_000_000;
  const clock = () => now;
  const a = makeSide(A, clock);
  const b = makeSide(B, clock);
  wire(a, b);

  await a.hub.handleClientFrame(a.conn, {
    t: "invite",
    callId: "c",
    to: B,
    media: { audio: true, video: false },
  });
  await a.hub.handleClientFrame(a.conn, { t: "offer", callId: "c", sdp: "O" });
  expect(b.hub.activeCalls()).toHaveLength(1);

  now += 50_000; // exceed the 45s ringing timeout
  b.hub.tick();
  expect(b.hub.activeCalls()).toHaveLength(0);
  expect(lastState(b.frames)).toBe("missed");
});
