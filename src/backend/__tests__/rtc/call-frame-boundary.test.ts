import { expect, test } from "bun:test";
import { CallSignalingDurableObject } from "../../runtime/call-signaling-do.ts";
import { CallHub, type CallRecord } from "../../runtime/call-hub-core.ts";
import {
  getSignalingHub,
  type LocalSocket,
} from "../../runtime/signaling-hub.ts";
import type { Env } from "../../types.ts";
import {
  parseClientToHubFrame,
  parseRtcSignalEnvelope,
  type HubToClientFrame,
  type RtcSignalEnvelopeV1,
} from "../../../../packages/api/src/types/call.ts";

const ACTOR = "https://local.example/ap/users/alice";
const PEER = "https://peer.example/ap/users/bob";
const LIMIT = 1024 * 1024;

function harness(runtime: "do" | "native") {
  const frames: HubToClientFrame[] = [];
  const signals: RtcSignalEnvelopeV1[] = [];
  const persisted: CallRecord[] = [];
  let storageReads = 0;
  let alarms = 0;
  let provisions = 0;
  const hub = new CallHub({
    localActorApId: ACTOR,
    broadcast: (frame) => frames.push(frame),
    hasClients: () => true,
    sendToPeer: async (signal) => {
      signals.push(signal);
    },
    provisionMedia: async () => {
      provisions++;
      return { iceServers: [], sfuFocus: null };
    },
    persist: (call) => {
      persisted.push({ ...call });
    },
    now: () => 1000,
    log: () => {},
  });
  const socket: LocalSocket = {
    send: (raw) => frames.push(JSON.parse(raw)),
    close: () => {},
  };
  const state = {
    storage: {
      get: async () => {
        storageReads++;
        return undefined;
      },
      put: async () => {},
      delete: async () => false,
      list: async () => new Map(),
      getAlarm: async () => {
        alarms++;
        return null;
      },
      setAlarm: async () => {},
    },
    acceptWebSocket: () => {},
    getWebSockets: () => [],
  };
  const callDo = new CallSignalingDurableObject(state, {} as never);
  // Keep the real message boundary + state machine, replacing only external ports.
  (callDo as unknown as { hub: CallHub }).hub = hub;
  const native = getSignalingHub({} as Env) as unknown as {
    users: Map<string, { hub: CallHub; sockets: Set<LocalSocket> }>;
    message(actor: string, socket: LocalSocket, raw: string): Promise<void>;
  };
  const actor = `${ACTOR}/${crypto.randomUUID()}`;
  native.users.set(actor, { hub, sockets: new Set([socket]) });
  return {
    hub,
    frames,
    signals,
    persisted,
    effects: () => ({ storageReads, alarms, provisions }),
    clear: () => {
      frames.length = signals.length = persisted.length = 0;
      alarms = 0;
      provisions = 0;
    },
    message: (raw: string) =>
      runtime === "do"
        ? callDo.webSocketMessage(socket, raw)
        : native.message(actor, socket, raw),
    dispose: () => native.users.delete(actor),
  };
}

const invite = {
  t: "invite",
  callId: "c1",
  to: PEER,
  media: { audio: true, video: false },
};
const malformed = [
  { ...invite, callId: undefined },
  { ...invite, callId: "" },
  { ...invite, callId: "c".repeat(201) },
  { ...invite, callId: "c2", to: 123 },
  { ...invite, callId: "c2", to: "" },
  { ...invite, callId: "c2", media: { audio: "yes", video: false } },
  { ...invite, callId: "c2", media: null },
  { t: "offer", callId: "c1", sdp: 123 },
  { t: "answer", callId: "c1" },
  { t: "candidates", callId: "c1", candidates: [null] },
  { t: "candidates", callId: "c1", candidates: "candidate:1" },
  { t: "candidates", callId: "c1", candidates: [{ candidate: 3 }] },
  {
    t: "candidates",
    callId: "c1",
    candidates: [{ candidate: "", sdpMLineIndex: 0.5 }],
  },
  {
    t: "candidates",
    callId: "c1",
    candidates: [{ candidate: "", sdpMLineIndex: -1 }],
  },
  {
    t: "candidates",
    callId: "c1",
    candidates: [{ candidate: "", sdpMLineIndex: 65536 }],
  },
  { t: "candidates", callId: "c1", candidates: [{ candidate: "", sdpMid: 3 }] },
  {
    t: "candidates",
    callId: "c1",
    candidates: [{ candidate: "", usernameFragment: false }],
  },
  { t: "reject", callId: "c1", reason: {} },
  { t: "hangup", callId: "c1", reason: null },
  { t: "accept", callId: 123 },
  { t: "resume" },
];

for (const runtime of ["do", "native"] as const) {
  test(`${runtime}: malformed client frames cannot mutate or relay an active call`, async () => {
    const h = harness(runtime);
    try {
      await h.message(JSON.stringify(invite));
      const before = h.hub.activeCalls().map((call) => ({ ...call }));
      for (const frame of malformed) {
        h.clear();
        await h.message(JSON.stringify(frame));
        expect({
          frame,
          frames: h.frames,
          signals: h.signals,
          persisted: h.persisted,
          effects: h.effects(),
        }).toEqual({
          frame,
          frames: [],
          signals: [],
          persisted: [],
          effects: { storageReads: 0, alarms: 0, provisions: 0 },
        });
        expect(h.hub.activeCalls()).toEqual(before);
      }
    } finally {
      h.dispose();
    }
  });

  test(`${runtime}: oversized UTF-8 frames are ignored before ping handling`, async () => {
    const h = harness(runtime);
    try {
      const raw = JSON.stringify({
        t: "ping",
        extension: "界".repeat(Math.ceil(LIMIT / 3)),
      });
      expect(raw.length).toBeLessThan(LIMIT);
      await h.message(raw);
      expect(h.frames).toEqual([]);
      expect(h.effects()).toEqual({
        storageReads: 0,
        alarms: 0,
        provisions: 0,
      });
    } finally {
      h.dispose();
    }
  });

  test(`${runtime}: exact frame byte cap is accepted; one byte more is ignored`, async () => {
    const h = harness(runtime);
    try {
      const prefix = '{"t":"ping","extension":"';
      const raw = prefix + "a".repeat(LIMIT - prefix.length - 2) + '"}';
      expect(new TextEncoder().encode(raw).byteLength).toBe(LIMIT);
      await h.message(raw);
      expect(h.frames).toEqual([{ t: "pong" }]);
      h.clear();
      await h.message(raw + " ");
      expect(h.frames).toEqual([]);
      expect(h.effects()).toEqual({
        storageReads: 0,
        alarms: 0,
        provisions: 0,
      });
    } finally {
      h.dispose();
    }
  });

  test(`${runtime}: SDP byte limit prevents federation relay`, async () => {
    const h = harness(runtime);
    try {
      await h.message(JSON.stringify(invite));
      h.clear();
      await h.message(
        JSON.stringify({ t: "offer", callId: "c1", sdp: "界".repeat(33334) }),
      );
      expect(h.signals).toHaveLength(0);
      expect(h.effects()).toEqual({
        storageReads: 0,
        alarms: 0,
        provisions: 0,
      });
    } finally {
      h.dispose();
    }
  });

  test(`${runtime}: valid frames preserve call flow and DOM candidate shapes`, async () => {
    const h = harness(runtime);
    try {
      await h.message('{"t":"hello"}');
      await h.message('{"t":"ping"}');
      expect(h.frames.map((frame) => frame.t)).toEqual(["ready", "pong"]);
      await h.message(JSON.stringify(invite));
      const sdp = "\u0000".repeat(100000); // 600k JSON bytes, within the frame cap.
      await h.message(JSON.stringify({ t: "offer", callId: "c1", sdp }));
      expect(h.signals.at(-1)?.sdp).toBe(sdp);
      const candidates = [
        {
          candidate: "",
          sdpMid: null,
          sdpMLineIndex: null,
          usernameFragment: null,
        },
        { candidate: "candidate:1", sdpMLineIndex: 65535 },
      ];
      await h.message(
        JSON.stringify({ t: "candidates", callId: "c1", candidates }),
      );
      expect(h.signals.at(-1)?.candidates).toEqual(candidates);
      await h.message(JSON.stringify({ t: "resume", callId: "c1" }));
      await h.message(
        JSON.stringify({ t: "answer", callId: "c1", sdp: "answer" }),
      );
      await h.message(JSON.stringify({ t: "accept", callId: "c1" }));
      await h.message(
        JSON.stringify({ t: "hangup", callId: "c1", reason: "done" }),
      );
      expect(h.hub.activeCalls()).toEqual([]);
      await h.message(JSON.stringify({ ...invite, callId: "c2" }));
      await h.message(
        JSON.stringify({ t: "reject", callId: "c2", reason: "x".repeat(201) }),
      );
      expect(h.signals.at(-1)?.reason).toBe("x".repeat(201));
    } finally {
      h.dispose();
    }
  });
}

test("server envelope SDP is limited in UTF-8 bytes, not JS characters", () => {
  const envelope = {
    v: 1,
    type: "offer",
    callId: "c1",
    from: ACTOR,
    to: PEER,
    ts: 1000,
    ttlMs: 30000,
  };
  expect(
    parseRtcSignalEnvelope({ ...envelope, sdp: "界".repeat(33334) }) === null,
  ).toBe(true);
  expect(
    parseRtcSignalEnvelope({ ...envelope, sdp: "a".repeat(100000) })?.sdp
      ?.length,
  ).toBe(100000);
  expect(
    parseRtcSignalEnvelope({ ...envelope, sdp: "界".repeat(33333) + "a" })?.sdp,
  ).toBe("界".repeat(33333) + "a");
});

test("invalid messages do not initialize either runtime or access DO storage", async () => {
  let reads = 0;
  const callDo = new CallSignalingDurableObject(
    {
      storage: {
        get: async () => {
          reads++;
          return undefined;
        },
      },
    } as unknown as ConstructorParameters<typeof CallSignalingDurableObject>[0],
    {} as never,
  );
  const socket: LocalSocket = {
    send: () => {
      throw new Error("unexpected send");
    },
    close: () => {},
  };
  const native = getSignalingHub({} as Env) as unknown as {
    users: Map<string, unknown>;
    message(actor: string, socket: LocalSocket, raw: string): Promise<void>;
  };
  const actor = `${ACTOR}/cold`;
  for (const raw of [
    "null",
    "[]",
    "{",
    '{"t":"unknown"}',
    '{"t":"invite"}',
    JSON.stringify({ t: "ping", padding: "a".repeat(LIMIT) }),
  ]) {
    await callDo.webSocketMessage(socket, raw);
    await native.message(actor, socket, raw);
    expect(reads).toBe(0);
    expect(native.users.has(actor)).toBe(false);
  }
  // Binary remains ignored even when it contains otherwise-valid JSON.
  const binary = new TextEncoder().encode('{"t":"ping"}');
  await callDo.webSocketMessage(socket, binary.buffer);
  await native.message(actor, socket, binary as unknown as string);
  expect(reads).toBe(0);
  expect(native.users.has(actor)).toBe(false);
});

test("candidate index must be finite and optional DOM fields remain nullable", () => {
  for (const index of ["1e999", "-1", "0.5", "65536", '"0"']) {
    expect(
      parseClientToHubFrame(
        `{"t":"candidates","callId":"c","candidates":[{"candidate":"","sdpMLineIndex":${index}}]}`,
      ),
    ).toBeNull();
  }
  expect(
    parseClientToHubFrame('{"t":"candidates","callId":"c","candidates":[]}'),
  ).toEqual({ t: "candidates", callId: "c", candidates: [] });
  expect(
    parseClientToHubFrame(
      '{"t":"candidates","callId":"c","candidates":[{"candidate":""}]}',
    ),
  ).toEqual({ t: "candidates", callId: "c", candidates: [{ candidate: "" }] });
});
