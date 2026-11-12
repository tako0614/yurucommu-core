import { expect, test } from "bun:test";
import { Hono } from "hono";
import { actorCache, actors } from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../lib/ap-signing.ts";
import rtc from "../../routes/rtc/index.ts";
import { CallHub, type CallRecord } from "../../runtime/call-hub-core.ts";
import type { Env, Variables } from "../../types.ts";
import type {
  HubToClientFrame,
  RtcSignalEnvelopeV1,
} from "../../../../packages/api/src/types/call.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP = "https://local.test";
const LOCAL = `${APP}/ap/users/owner`;
const PEER = "https://peer.example/users/contact";
const OTHER = "https://other.example/users/contact";
const CALL = "owned-local-call";
const TYPES = [
  "offer",
  "answer",
  "candidate",
  "accept",
  "reject",
  "hangup",
  "cancel",
] as const;

function fixture(state: "ringing" | "connected" = "ringing", restored = true) {
  const frames: HubToClientFrame[] = [];
  const writes: CallRecord[] = [];
  const rings: RtcSignalEnvelopeV1[] = [];
  let media = 0;
  const now = Date.now();
  const hub = new CallHub({
    localActorApId: LOCAL,
    broadcast: (frame) => frames.push(frame),
    hasClients: () => true,
    sendToPeer: async () => {
      throw new Error("no peer transport in this fixture");
    },
    provisionMedia: async () => {
      media++;
      return { iceServers: [], sfuFocus: null };
    },
    persist: (call) => {
      writes.push({ ...call });
    },
    ring: (envelope) => {
      rings.push(envelope);
    },
    now: () => now,
  });
  if (restored)
    hub.hydrate([
      {
        callId: CALL,
        peerApId: PEER,
        direction: "outgoing",
        state,
        media: { audio: true, video: false },
        sfuFocus: null,
        createdAt: now,
        updatedAt: now,
        ...(state === "connected" ? { connectedAt: now } : {}),
      },
    ]);
  function signal(
    type: RtcSignalEnvelopeV1["type"],
    from = OTHER,
  ): RtcSignalEnvelopeV1 {
    return {
      v: 1,
      callId: CALL,
      from,
      to: LOCAL,
      type,
      ts: now,
      ttlMs: 10000,
      sdp: "v=0",
      candidates: [{ candidate: "harmless-local-fixture" }],
    };
  }
  const effects = () => ({
    calls: JSON.stringify(hub.activeCalls()),
    frames: frames.length,
    writes: writes.length,
    rings: rings.length,
    media,
  });
  return { hub, signal, effects, frames, writes, rings };
}

for (const state of ["ringing", "connected"] as const) {
  for (const type of TYPES) {
    test(`an existing ${state} call ignores a different peer's ${type}`, async () => {
      const f = fixture(state);
      const before = f.effects();
      await f.hub.handleInboundSignal(f.signal(type));
      expect(f.effects()).toEqual(before);
    });
  }
}

for (const from of [PEER, "https://PEER.example:443/users/contact/#profile"]) {
  for (const type of TYPES) {
    test(`the retained peer's ${type} still works using ${from}`, async () => {
      const f = fixture();
      await f.hub.handleInboundSignal(f.signal(type, from));
      const expected = {
        offer: "offer",
        answer: "answer",
        candidate: "candidates",
        accept: "peer-accepted",
        reject: "peer-rejected",
        hangup: "peer-hangup",
        cancel: "peer-hangup",
      }[type];
      expect(f.frames.some((frame) => frame.t === expected)).toBe(true);
      if (type === "answer" || type === "accept")
        expect(f.hub.activeCalls()[0]?.state).toBe("connecting");
      if (["reject", "hangup", "cancel"].includes(type))
        expect(f.hub.activeCalls()).toHaveLength(0);
    });
  }
}

for (const from of [
  "https://peer.example/users/Contact",
  `${PEER}?different=actor`,
]) {
  test(`identity-significant actor differences stay distinct: ${from}`, async () => {
    const f = fixture();
    const before = f.effects();
    await f.hub.handleInboundSignal(f.signal("answer", from));
    expect(f.effects()).toEqual(before);
  });
}

test("a different peer's offer can create a new incoming call", async () => {
  const f = fixture("ringing", false);
  await f.hub.handleInboundSignal(f.signal("offer"));
  expect(f.hub.activeCalls().map((call) => call.peerApId)).toEqual([OTHER]);
  expect(f.rings).toHaveLength(1);
  expect(f.writes).toHaveLength(1);
});

test("peer binding preserves freshness rejection", async () => {
  const f = fixture();
  const before = f.effects();
  await f.hub.handleInboundSignal({ ...f.signal("answer", PEER), ts: 0 });
  expect(f.effects()).toEqual(before);
});

async function signedFixture() {
  const f = fixture();
  const { db, client } = await createTestDb();
  try {
    const keys = new Map<string, Awaited<ReturnType<typeof generateKeyPair>>>();
    await db.insert(actors).values({
      apId: LOCAL,
      type: "Person",
      preferredUsername: "owner",
      inbox: `${LOCAL}/inbox`,
      outbox: `${LOCAL}/outbox`,
      followersUrl: `${LOCAL}/followers`,
      followingUrl: `${LOCAL}/following`,
      publicKeyPem: "unused-local-fixture",
      privateKeyPem: "unused-local-fixture",
    });
    for (const actor of [PEER, OTHER]) {
      const key = await generateKeyPair();
      keys.set(actor, key);
      await db.insert(actorCache).values({
        apId: actor,
        type: "Person",
        inbox: `${actor}/inbox`,
        publicKeyId: `${actor}#main-key`,
        publicKeyPem: key.publicKeyPem,
        lastFetchedAt: new Date().toISOString(),
        rawJson: "{}",
      });
    }
    let delivered = 0;
    const env = {
      APP_URL: APP,
      DB_INSTANCE: db,
      CALL_SIGNALING: {
        idFromName: (actor: string) => actor,
        get: (actor: string) => ({
          async fetch(url: string, init: RequestInit) {
            expect(actor).toBe(LOCAL);
            expect(url).toBe("https://call-do/_ingest");
            expect(init.method).toBe("POST");
            delivered++;
            await f.hub.handleInboundSignal(JSON.parse(String(init.body)));
            return new Response(null, { status: 204 });
          },
        }),
      },
    } as unknown as Env;
    const app = new Hono<{ Bindings: Env; Variables: Variables }>();
    app.use("*", async (c, next) => {
      c.set("db", db);
      await next();
    });
    app.route("/", rtc);
    async function signedSignal(
      signer: string,
      type: RtcSignalEnvelopeV1["type"],
      overrides: Partial<RtcSignalEnvelopeV1> = {},
    ) {
      const body = JSON.stringify({ ...f.signal(type, signer), ...overrides });
      const url = `${APP}/ap/rtc/signal`;
      const signed = await signRequest(
        keys.get(signer)!.privateKeyPem,
        `${signer}#main-key`,
        "POST",
        url,
        body,
      );
      return app.fetch(
        new Request(url, {
          method: "POST",
          headers: { ...signed, "Content-Type": "application/json" },
          body,
        }),
        env,
      );
    }
    return { ...f, client, signedSignal, delivered: () => delivered };
  } catch (error) {
    client.close();
    throw error;
  }
}

for (const type of TYPES) {
  test(`a genuinely signed different peer's ${type} cannot mutate an existing call`, async () => {
    const f = await signedFixture();
    try {
      const before = f.effects();
      expect((await f.signedSignal(OTHER, type)).status).toBe(204);
      expect(f.delivered()).toBe(1);
      expect(f.effects()).toEqual(before);
    } finally {
      f.client.close();
    }
  });
}

test("signed ingress retains signer binding and accepts the peer's cosmetic identity", async () => {
  const f = await signedFixture();
  try {
    const before = f.effects();
    expect((await f.signedSignal(OTHER, "answer", { from: PEER })).status).toBe(
      403,
    );
    expect(f.delivered()).toBe(0);
    expect(f.effects()).toEqual(before);
    expect(
      (
        await f.signedSignal(PEER, "answer", {
          from: "https://PEER.example:443/users/contact/#profile",
        })
      ).status,
    ).toBe(204);
    expect(f.hub.activeCalls()[0]?.state).toBe("connecting");
    expect(f.frames.some((frame) => frame.t === "answer")).toBe(true);
  } finally {
    f.client.close();
  }
});

test("signed ingress accepts a new call from another peer without changing the retained call", async () => {
  const f = await signedFixture();
  try {
    const retained = JSON.stringify(f.hub.activeCalls());
    expect(
      (await f.signedSignal(OTHER, "offer", { callId: "new-local-call" }))
        .status,
    ).toBe(204);
    expect(f.delivered()).toBe(1);
    expect(
      JSON.stringify(
        f.hub.activeCalls().filter((call) => call.callId === CALL),
      ),
    ).toBe(retained);
    expect(
      f.hub.activeCalls().find((call) => call.callId === "new-local-call")
        ?.peerApId,
    ).toBe(OTHER);
    expect(f.writes).toHaveLength(1);
    expect(f.rings).toHaveLength(1);
  } finally {
    f.client.close();
  }
});
