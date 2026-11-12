import { expect, test } from "bun:test";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import {
  actors,
  blocks,
  blockedActors,
  callSessions,
} from "../../../db/index.ts";
import rtc from "../../routes/rtc/index.ts";
import { CallHub, type CallRecord } from "../../runtime/call-hub-core.ts";
import { createCallHubPort } from "../../runtime/call-hub-port.ts";
import type { Env, Variables } from "../../types.ts";
import type { HubToClientFrame } from "../../../../packages/api/src/types/call.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const OWNER = "https://local.test/ap/users/owner";
const OTHER = "https://local.test/ap/users/other";
const PEER = "https://peer.example/users/contact";
const MEDIA = { audio: true, video: false };

async function fixture(blockedId: string | null = PEER, blocker = OWNER) {
  const { db, client } = await createTestDb();
  for (const [apId, name] of [
    [OWNER, "owner"],
    [OTHER, "other"],
  ]) {
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: name,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "unused-isolated-fixture",
      privateKeyPem: "unused-isolated-fixture",
    });
  }
  if (blockedId)
    await db
      .insert(blocks)
      .values({ blockerApId: blocker, blockedApId: blockedId });
  let apiMediaReads = 0;
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: OWNER, preferred_username: "owner" } as NonNullable<
      Variables["actor"]
    >);
    await next();
  });
  app.route("/", rtc);
  app.onError((_error, c) =>
    c.json({ error: "controlled local authority fault" }, 500),
  );
  const env = {
    APP_URL: "https://local.test",
    DB_INSTANCE: db,
    CALL_SIGNALING: {
      idFromName: () => {
        throw new Error("unexpected namespace access");
      },
    },
    get YURUCOMMU_RTC_ICE_SERVERS() {
      apiMediaReads++;
      return "[]";
    },
  } as unknown as Env;
  return {
    db,
    client,
    env,
    mediaReads: () => apiMediaReads,
    start: () =>
      app.fetch(
        new Request("https://local.test/api/rtc/calls", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: PEER, media: MEDIA }),
        }),
        env,
      ),
  };
}

function createHub(f: Awaited<ReturnType<typeof fixture>>) {
  const frames: HubToClientFrame[] = [];
  const writes: Promise<void>[] = [];
  const events: string[] = [];
  let media = 0;
  const port = createCallHubPort({
    localActorApId: OWNER,
    db: f.db,
    env: f.env,
    broadcast: (frame) => {
      frames.push(frame);
    },
    hasClients: () => false,
  });
  const provision = port.provisionMedia.bind(port);
  port.provisionMedia = async (kind) => {
    media++;
    return provision(kind);
  };
  const persist = port.persist!.bind(port);
  port.persist = (call) => {
    const work = Promise.resolve(persist(call));
    writes.push(work);
    return work;
  };
  port.log = (event) => {
    events.push(event);
  };
  const hub = new CallHub(port);
  return {
    port,
    hub,
    frames,
    events,
    writes,
    media: () => media,
    invite: (callId = "owned-invite") =>
      hub.handleClientFrame(
        {
          send: (frame) => {
            frames.push(frame);
          },
          close: () => {},
        },
        { t: "invite", callId, to: PEER, media: MEDIA },
      ),
    flush: () => Promise.all(writes),
  };
}

for (const blockedId of [
  PEER,
  "https://PEER.example:443/users/contact/#profile",
]) {
  test(`API and real shared port refuse the owner's blocked target: ${blockedId}`, async () => {
    const f = await fixture(blockedId);
    const h = createHub(f);
    try {
      const response = await f.start();
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "blocked" });
      expect(f.mediaReads()).toBe(0);
      await h.invite();
      await h.flush();
      expect({
        media: h.media(),
        active: h.hub.activeCalls().length,
        writes: h.writes.length,
        sessions: (await f.db.select().from(callSessions).all()).length,
      }).toEqual({ media: 0, active: 0, writes: 0, sessions: 0 });
      expect(h.frames).toEqual([
        { t: "error", code: "blocked" },
        { t: "call-state", callId: "owned-invite", state: "failed" },
      ]);
    } finally {
      await h.flush();
      f.client.close();
    }
  });
}

for (const scope of ["normal", "otherOwner", "otherPeer", "unblock"] as const) {
  test(`normal API and direct invite remain usable: ${scope}`, async () => {
    const f = await fixture(
      scope === "normal"
        ? null
        : scope === "otherPeer"
          ? "https://other.example/users/unrelated"
          : PEER,
      scope === "otherOwner" ? OTHER : OWNER,
    );
    const h = createHub(f);
    try {
      if (scope === "unblock") {
        expect((await f.start()).status).toBe(403);
        await h.invite();
        expect(h.hub.activeCalls()).toHaveLength(0);
        await f.db.delete(blocks);
      }
      const response = await f.start();
      expect(response.status).toBe(200);
      expect(
        ((await response.json()) as { callId: string }).callId,
      ).toBeString();
      await h.invite();
      await h.flush();
      expect(h.media()).toBe(1);
      expect(h.hub.activeCalls()).toHaveLength(1);
      expect(h.writes).toHaveLength(1);
      expect(await f.db.select().from(callSessions).all()).toHaveLength(1);
    } finally {
      await h.flush();
      f.client.close();
    }
  });
}

test("strict operator block still refuses both outgoing entry points", async () => {
  const f = await fixture(null);
  const h = createHub(f);
  try {
    await f.db.insert(blockedActors).values({ actorApId: PEER });
    expect((await f.start()).status).toBe(403);
    await h.invite();
    await h.flush();
    expect(f.mediaReads()).toBe(0);
    expect(h.media()).toBe(0);
    expect(h.hub.activeCalls()).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
  } finally {
    await h.flush();
    f.client.close();
  }
});

for (const table of ["blocks", "blocked_actors"] as const) {
  test(`unreadable ${table} authority fails without admitting or stranding an invite`, async () => {
    const f = await fixture(null);
    const h = createHub(f);
    try {
      // Only this test's disposable, migrated in-memory database is altered.
      await f.db.run(sql.raw(`DROP TABLE ${table}`));
      expect((await f.start()).status).toBe(500);
      await h.invite();
      await h.flush();
      expect({
        media: h.media(),
        active: h.hub.activeCalls().length,
        writes: h.writes.length,
      }).toEqual({ media: 0, active: 0, writes: 0 });
      expect(h.frames).toEqual([
        { t: "error", code: "call_unavailable" },
        { t: "call-state", callId: "owned-invite", state: "failed" },
      ]);
      expect(h.events).toEqual(["call.hub.policy_unavailable"]);
    } finally {
      await h.flush();
      f.client.close();
    }
  });
}

test("a block introduced during media preparation prevents call creation", async () => {
  const f = await fixture(null);
  const h = createHub(f);
  try {
    const provision = h.port.provisionMedia;
    h.port.provisionMedia = async (kind) => {
      const result = await provision(kind);
      await f.db
        .insert(blocks)
        .values({ blockerApId: OWNER, blockedApId: PEER });
      return result;
    };
    await h.invite();
    await h.flush();
    expect(h.media()).toBe(1);
    expect(h.hub.activeCalls()).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(await f.db.select().from(callSessions).all()).toHaveLength(0);
    expect(h.frames).toEqual([
      { t: "error", code: "blocked" },
      { t: "call-state", callId: "owned-invite", state: "failed" },
    ]);
  } finally {
    await h.flush();
    f.client.close();
  }
});

test("a failed policy read releases its reservation and allows a legitimate retry", async () => {
  const f = await fixture(null);
  const h = createHub(f);
  try {
    const allowed = h.port.isOutgoingPeerAllowed!;
    h.port.isOutgoingPeerAllowed = async () => {
      throw new Error("isolated policy failure");
    };
    await h.invite();
    expect(h.hub.activeCalls()).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    h.port.isOutgoingPeerAllowed = allowed;
    await h.invite();
    await h.flush();
    expect(h.media()).toBe(1);
    expect(h.hub.activeCalls()).toHaveLength(1);
    expect(h.writes).toHaveLength(1);
  } finally {
    await h.flush();
    f.client.close();
  }
});

test("the pending policy check reserves identity and total capacity", async () => {
  const f = await fixture(null);
  const h = createHub(f);
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    const now = Date.now();
    h.hub.hydrate(
      Array.from({ length: 63 }, (_, i): CallRecord => ({
        callId: `restored-${i}`,
        peerApId: PEER,
        direction: "outgoing",
        state: "connected",
        media: MEDIA,
        sfuFocus: null,
        createdAt: now,
        updatedAt: now,
      })),
    );
    const allowed = h.port.isOutgoingPeerAllowed!;
    let checks = 0;
    h.port.isOutgoingPeerAllowed = async (peer) => {
      checks++;
      await barrier;
      return allowed(peer);
    };
    const work = [h.invite(), h.invite(), h.invite("overflow")];
    const checksBeforeRelease = checks;
    const mediaBeforeRelease = h.media();
    release();
    await Promise.all(work);
    await h.flush();
    expect(checksBeforeRelease).toBe(1);
    expect(mediaBeforeRelease).toBe(0);
    expect(h.media()).toBe(1);
    expect(h.hub.activeCalls()).toHaveLength(64);
    expect(h.writes).toHaveLength(1);
    expect(h.frames).toContainEqual({
      t: "call-state",
      callId: "overflow",
      state: "failed",
    });
  } finally {
    release();
    await h.flush();
    f.client.close();
  }
});
