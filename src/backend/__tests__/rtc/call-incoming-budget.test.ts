import { expect, test } from "bun:test";
import {
  CallHub,
  type CallRecord,
  type HubConnection,
  type HubPort,
} from "../../runtime/call-hub-core.ts";
import type {
  ClientToHubFrame,
  HubToClientFrame,
  RtcSignalEnvelopeV1,
} from "../../../../packages/api/src/types/call.ts";
import { CallClient } from "../../../../packages/api/src/lib/rtc-client.ts";
import {
  getYurucommuApiTransport,
  setYurucommuApiTransport,
} from "../../../../packages/api/src/lib/transport.ts";

const LOCAL = "https://z.example/ap/users/local";
const PEER = "https://a.example/ap/users/peer";
const MEDIA = { audio: true, video: false };
const MEDIA_RESULT = { iceServers: [], sfuFocus: null };

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function fixture() {
  let now = 1_000_000;
  let mediaCalls = 0;
  const persisted: CallRecord[] = [];
  const rings: RtcSignalEnvelopeV1[] = [];
  const relays: RtcSignalEnvelopeV1[] = [];
  const frames: HubToClientFrame[] = [];
  const port: HubPort = {
    localActorApId: LOCAL,
    broadcast: (frame) => {
      frames.push(frame);
    },
    hasClients: () => false,
    sendToPeer: async (envelope) => {
      relays.push(envelope);
    },
    provisionMedia: async () => {
      mediaCalls++;
      return MEDIA_RESULT;
    },
    persist: (call) => {
      persisted.push({ ...call });
    },
    ring: (envelope) => {
      rings.push(envelope);
    },
    now: () => now,
  };
  const hub = new CallHub(port);
  const conn: HubConnection = {
    send: (frame) => {
      frames.push(frame);
    },
    close: () => {},
  };
  const offer = (callId: string): RtcSignalEnvelopeV1 => ({
    v: 1,
    callId,
    from: PEER,
    to: LOCAL,
    type: "offer",
    ts: now,
    ttlMs: 30_000,
  });
  const record = (callId: string): CallRecord => ({
    callId,
    peerApId: PEER,
    direction: "outgoing",
    state: "connected",
    media: MEDIA,
    sfuFocus: null,
    createdAt: now,
    updatedAt: now,
  });
  return {
    hub,
    port,
    frames,
    persisted,
    rings,
    relays,
    offer,
    record,
    advance: (ms: number) => {
      now += ms;
    },
    mediaCalls: () => mediaCalls,
    invite: (callId: string) =>
      hub.handleClientFrame(conn, {
        t: "invite",
        callId,
        to: PEER,
        media: MEDIA,
      }),
    incoming: (callId: string) => hub.handleInboundSignal(offer(callId)),
  };
}

test("incoming ringing accepts 16 and refuses the next creation without effects", async () => {
  const f = fixture();
  f.port.hasClients = () => true;
  for (let i = 0; i < 16; i++) await f.incoming(`incoming-${i}`);
  const before = { frames: f.frames.length, media: f.mediaCalls() };
  await f.incoming("overflow");
  expect(f.hub.activeCalls()).toHaveLength(16);
  expect(f.persisted).toHaveLength(16);
  expect(f.rings).toHaveLength(16);
  expect({ frames: f.frames.length, media: f.mediaCalls() }).toEqual(before);
  expect(f.relays).toHaveLength(0);
});

test("restored connected calls count toward 64 without truncating existing history", async () => {
  const f = fixture();
  const records = Array.from({ length: 65 }, (_, i) =>
    f.record(`restored-${i}`),
  );
  f.hub.hydrate(records);
  await f.incoming("overflow");
  await f.invite("outgoing-overflow");
  expect(f.hub.activeCalls()).toEqual(records);
  expect(f.persisted).toHaveLength(0);
  expect(f.rings).toHaveLength(0);
  expect(f.mediaCalls()).toBe(0);
  expect(f.frames).toEqual([
    { t: "error", code: "call_capacity", message: "Too many active calls." },
    { t: "call-state", callId: "outgoing-overflow", state: "failed" },
  ]);
});

test("incoming connecting calls do not consume the separate ringing allowance", async () => {
  const f = fixture();
  f.hub.hydrate(
    Array.from({ length: 48 }, (_, i) => ({
      ...f.record(`connecting-${i}`),
      direction: "incoming",
      state: "connecting",
    })),
  );
  for (let i = 0; i < 16; i++) await f.incoming(`ringing-${i}`);
  await f.incoming("overflow");
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(f.persisted).toHaveLength(16);
  expect(f.rings).toHaveLength(16);
});

test("a re-offer of an existing call still works at both limits", async () => {
  const f = fixture();
  f.hub.hydrate(
    Array.from({ length: 48 }, (_, i) => f.record(`connected-${i}`)),
  );
  for (let i = 0; i < 16; i++) await f.incoming(`ringing-${i}`);
  await f.hub.handleInboundSignal({ ...f.offer("ringing-0"), sdp: "v=0" });
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(f.persisted).toHaveLength(16);
  expect(f.rings).toHaveLength(17);
  expect(f.frames).toContainEqual({
    t: "offer",
    callId: "ringing-0",
    sdp: "v=0",
    media: MEDIA,
  });
});

test("ringing timeout releases incoming capacity and preserves missed-call history", async () => {
  const f = fixture();
  for (let i = 0; i < 16; i++) await f.incoming(`ringing-${i}`);
  f.advance(45_001);
  f.hub.tick();
  expect(f.hub.activeCalls()).toHaveLength(0);
  expect(f.persisted.filter((call) => call.state === "missed")).toHaveLength(
    16,
  );
  await f.incoming("next-legitimate-call");
  expect(f.hub.activeCalls().map((call) => call.callId)).toEqual([
    "next-legitimate-call",
  ]);
});

test("a terminal transition returns total capacity for the next legitimate call", async () => {
  const f = fixture();
  f.hub.hydrate(
    Array.from({ length: 64 }, (_, i) => f.record(`connected-${i}`)),
  );
  await f.hub.handleInboundSignal({
    ...f.offer("connected-0"),
    type: "hangup",
  });
  await f.incoming("next-legitimate-call");
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(
    f.hub.activeCalls().some((call) => call.callId === "next-legitimate-call"),
  ).toBe(true);
  expect(f.persisted.map((call) => call.state)).toEqual([
    "cancelled",
    "ringing",
  ]);
});

test("concurrent duplicate invites provision and persist a call only once", async () => {
  const f = fixture();
  const barrier = deferred();
  let starts = 0;
  f.port.provisionMedia = async () => {
    starts++;
    await barrier.promise;
    return MEDIA_RESULT;
  };
  const pending = [f.invite("same-id"), f.invite("same-id")];
  const started = starts;
  barrier.release();
  await Promise.all(pending);
  expect(started).toBe(1);
  expect(f.hub.activeCalls()).toHaveLength(1);
  expect(f.persisted).toHaveLength(1);
  expect(f.frames.filter((frame) => frame.t === "ice-servers")).toHaveLength(1);
});

test("pending media reserves all 64 slots before any provisioning completes", async () => {
  const f = fixture();
  const barrier = deferred();
  let starts = 0;
  f.port.provisionMedia = async () => {
    starts++;
    await barrier.promise;
    return MEDIA_RESULT;
  };
  const pending = Array.from({ length: 65 }, (_, i) =>
    f.invite(`pending-${i}`),
  );
  const started = starts;
  await f.incoming("incoming-overflow");
  barrier.release();
  await Promise.all(pending);
  expect(started).toBe(64);
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(f.persisted).toHaveLength(64);
  expect(f.rings).toHaveLength(0);
  expect(f.frames.filter((frame) => frame.t === "error")).toHaveLength(1);
});

test("failed media frees a pending slot and permits retry of the same ID", async () => {
  const f = fixture();
  f.hub.hydrate(
    Array.from({ length: 63 }, (_, i) => f.record(`connected-${i}`)),
  );
  f.port.provisionMedia = async () => {
    throw new Error("local media unavailable");
  };
  await expect(f.invite("retry-id")).rejects.toThrow("local media unavailable");
  expect(f.hub.activeCalls()).toHaveLength(63);
  expect(f.persisted).toHaveLength(0);
  f.port.provisionMedia = async () => MEDIA_RESULT;
  await f.invite("retry-id");
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(f.persisted).toHaveLength(1);
});

test("restored calls during media preparation are preserved and return an explicit capacity error", async () => {
  const f = fixture();
  const barrier = deferred();
  f.port.provisionMedia = async () => {
    await barrier.promise;
    return MEDIA_RESULT;
  };
  const pending = f.invite("pending");
  const restored = Array.from({ length: 64 }, (_, i) =>
    f.record(`restored-${i}`),
  );
  f.hub.hydrate(restored);
  barrier.release();
  await pending;
  expect(f.hub.activeCalls()).toEqual(restored);
  expect(f.persisted).toHaveLength(0);
  expect(f.frames).toEqual([
    { t: "error", code: "call_capacity", message: "Too many active calls." },
    { t: "call-state", callId: "pending", state: "failed" },
  ]);
  await f.hub.handleInboundSignal({ ...f.offer("restored-0"), type: "hangup" });
  f.port.provisionMedia = async () => MEDIA_RESULT;
  await f.invite("pending");
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(f.hub.activeCalls().some((call) => call.callId === "pending")).toBe(
    true,
  );
});

test("an incoming offer cannot overwrite a pending outgoing call ID", async () => {
  const f = fixture();
  const barrier = deferred();
  f.port.provisionMedia = async () => {
    await barrier.promise;
    return MEDIA_RESULT;
  };
  const pending = f.invite("same-id");
  await f.incoming("same-id");
  barrier.release();
  await pending;
  expect(f.hub.activeCalls().map((call) => call.direction)).toEqual([
    "outgoing",
  ]);
  expect(f.persisted).toHaveLength(1);
  expect(f.rings).toHaveLength(0);
});

test("polite glare can replace one outgoing call at the total limit", async () => {
  const f = fixture();
  f.hub.hydrate(
    Array.from({ length: 63 }, (_, i) => ({
      ...f.record(`connected-${i}`),
      peerApId: "https://other.example/users/peer",
    })),
  );
  await f.invite("outgoing");
  await f.incoming("incoming");
  expect(f.hub.activeCalls()).toHaveLength(64);
  expect(f.hub.activeCalls().some((call) => call.callId === "outgoing")).toBe(
    false,
  );
  expect(f.hub.activeCalls().some((call) => call.callId === "incoming")).toBe(
    true,
  );
  expect(f.relays.map((envelope) => envelope.type)).toEqual(["cancel"]);
});

test("a full incoming allowance does not cancel an existing outgoing glare call", async () => {
  const f = fixture();
  for (let i = 0; i < 16; i++) await f.incoming(`ringing-${i}`);
  await f.invite("outgoing");
  await f.incoming("glare-overflow");
  expect(f.hub.activeCalls().some((call) => call.callId === "outgoing")).toBe(
    true,
  );
  expect(f.hub.activeCalls()).toHaveLength(17);
  expect(f.relays).toHaveLength(0);
  expect(f.persisted).toHaveLength(17);
  expect(f.rings).toHaveLength(16);
});

test("a pending glare replacement reserves its identity and incoming allowance", async () => {
  const f = fixture();
  for (let i = 0; i < 15; i++) await f.incoming(`ringing-${i}`);
  await f.invite("outgoing");
  const barrier = deferred();
  f.port.sendToPeer = async (envelope) => {
    f.relays.push(envelope);
    await barrier.promise;
  };
  const pending = f.incoming("glare");
  const duplicate = f.incoming("glare");
  const overflow = f.incoming("other-overflow");
  barrier.release();
  await Promise.all([pending, duplicate, overflow]);
  expect(f.relays).toHaveLength(1);
  expect(f.hub.activeCalls()).toHaveLength(16);
  expect(
    f.hub.activeCalls().some((call) => call.callId === "other-overflow"),
  ).toBe(false);
  expect(f.rings).toHaveLength(16);
});

test("glare rechecks capacity after awaiting relay without removing restored calls", async () => {
  const f = fixture();
  await f.invite("outgoing");
  const barrier = deferred();
  f.port.sendToPeer = async () => {
    await barrier.promise;
  };
  const pending = f.incoming("glare");
  f.hub.hydrate(
    Array.from({ length: 64 }, (_, i) => f.record(`restored-${i}`)),
  );
  barrier.release();
  await pending;
  expect(f.hub.activeCalls()).toHaveLength(65);
  expect(f.hub.activeCalls().some((call) => call.callId === "outgoing")).toBe(
    true,
  );
  expect(f.rings).toHaveLength(0);
  expect(f.persisted).toHaveLength(1);
});

for (const mediaPending of [true, false]) {
  test(`capacity rejection releases the real CallClient and permits retry: pending media ${mediaPending}`, async () => {
    const f = fixture();
    f.hub.hydrate(
      Array.from({ length: 64 }, (_, i) => f.record(`restored-${i}`)),
    );
    const originalFetch = globalThis.fetch;
    const originalSocket = globalThis.WebSocket;
    const originalPeer = globalThis.RTCPeerConnection;
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      "navigator",
    );
    const originalTransport = getYurucommuApiTransport();
    const mediaReady = deferred();
    const inviteQueued = deferred();
    const admission = deferred();
    const hubWork: Promise<void>[] = [];
    const sent: ClientToHubFrame[] = [];
    const client = new CallClient();
    const errors: string[] = [];
    client.on("error", (code) => {
      errors.push(code);
    });
    let socket!: LocalSocket;
    let resolveMedia!: (stream: MediaStream) => void;
    let mediaRequests = 0;
    let stopped = 0;
    let peers = 0;
    let closedPeers = 0;
    let callRequests = 0;
    const stream = () =>
      ({
        getTracks: () => [
          {
            stop: () => {
              stopped++;
            },
          },
        ],
      }) as unknown as MediaStream;
    class LocalSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        socket = this;
        queueMicrotask(() => {
          this.readyState = 1;
          this.onopen?.();
        });
      }
      deliver(frame: HubToClientFrame) {
        this.onmessage?.({ data: JSON.stringify(frame) });
      }
      send(raw: string) {
        const frame = JSON.parse(raw) as ClientToHubFrame;
        sent.push(frame);
        const conn = {
          send: (reply: HubToClientFrame) => this.deliver(reply),
          close: () => {},
        };
        if (frame.t === "invite" && frame.callId === "attempt-1") {
          inviteQueued.release();
          hubWork.push(
            admission.promise.then(() => f.hub.handleClientFrame(conn, frame)),
          );
        } else {
          hubWork.push(f.hub.handleClientFrame(conn, frame));
        }
      }
      close() {}
    }
    class LocalPeer {
      constructor() {
        peers++;
      }
      addTrack() {}
      async createOffer() {
        return { type: "offer", sdp: "local-fixture" };
      }
      async setLocalDescription() {}
      getSenders() {
        return [];
      }
      close() {
        closedPeers++;
      }
    }
    try {
      setYurucommuApiTransport({
        credentials: "omit",
        resolveUrl: (path) => new URL(path, "https://local.test").href,
        getAuthHeaders: () => ({}),
      });
      globalThis.fetch = (async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/rtc/calls") {
          return Response.json({
            callId: `attempt-${++callRequests}`,
            iceServers: [],
          });
        }
        if (url.pathname === "/api/rtc/ticket") {
          return Response.json({
            ticket: "isolated-fixture",
            actor_ap_id: LOCAL,
          });
        }
        throw new Error("unexpected local fixture API");
      }) as typeof fetch;
      globalThis.WebSocket = LocalSocket as unknown as typeof WebSocket;
      globalThis.RTCPeerConnection =
        LocalPeer as unknown as typeof RTCPeerConnection;
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          mediaDevices: {
            getUserMedia: () => {
              mediaRequests++;
              mediaReady.release();
              return mediaPending && mediaRequests === 1
                ? new Promise<MediaStream>((resolve) => {
                    resolveMedia = resolve;
                  })
                : Promise.resolve(stream());
            },
          },
        },
      });
      const starting = client.startCall(PEER, MEDIA);
      await Promise.all([mediaReady.promise, inviteQueued.promise]);
      if (!mediaPending) await starting;
      admission.release();
      await Promise.all(hubWork);
      const stateAfterRejection = client.getState();
      const offersBeforeLateMedia = sent.filter(
        (frame) => frame.t === "offer",
      ).length;
      if (mediaPending) resolveMedia(stream());
      await starting;
      expect(stateAfterRejection).toBe("ended");
      expect(errors).toEqual(["call_capacity"]);
      expect(stopped).toBe(1);
      expect(peers).toBe(mediaPending ? 0 : 1);
      expect(closedPeers).toBe(peers);
      expect(sent.filter((frame) => frame.t === "offer")).toHaveLength(
        offersBeforeLateMedia,
      );
      expect(f.hub.activeCalls()).toHaveLength(64);
      expect(f.persisted).toHaveLength(0);

      await f.hub.handleInboundSignal({
        ...f.offer("restored-0"),
        type: "hangup",
      });
      await client.startCall(PEER, MEDIA);
      await Promise.all(hubWork);
      expect(callRequests).toBe(2);
      expect(client.getState()).toBe("calling");
      expect(
        f.hub.activeCalls().some((call) => call.callId === "attempt-2"),
      ).toBe(true);
      expect(
        f.relays.some(
          (envelope) =>
            envelope.callId === "attempt-2" && envelope.type === "offer",
        ),
      ).toBe(true);
      socket.deliver({
        t: "call-state",
        callId: "unrelated-call",
        state: "failed",
      });
      expect(client.getState()).toBe("calling");
    } finally {
      admission.release();
      client.hangup();
      client.disconnect();
      await Promise.all(hubWork);
      setYurucommuApiTransport(originalTransport);
      globalThis.fetch = originalFetch;
      globalThis.WebSocket = originalSocket;
      globalThis.RTCPeerConnection = originalPeer;
      if (originalNavigator)
        Object.defineProperty(globalThis, "navigator", originalNavigator);
      else Reflect.deleteProperty(globalThis, "navigator");
    }
  });
}
