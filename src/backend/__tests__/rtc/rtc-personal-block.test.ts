import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  actorCache,
  actors,
  blocks,
  blockedActors,
} from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import rtc from "../../routes/rtc/index.ts";
import type { Env, Variables } from "../../types.ts";
import type { RtcSignalEnvelopeV1 } from "../../../../packages/api/src/types/call.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP = "https://local.test";
const ALICE = "https://remote.example/users/alice";
const BOB = `${APP}/ap/users/bob`;

async function fixture() {
  const { db, client } = await createTestDb();
  const key = await generateKeyPair();
  await db.insert(actors).values({
    apId: BOB,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${BOB}/inbox`,
    outbox: `${BOB}/outbox`,
    followersUrl: `${BOB}/followers`,
    followingUrl: `${BOB}/following`,
    publicKeyPem: "unused-local-fixture",
    privateKeyPem: "unused-local-fixture",
  });
  await db.insert(actorCache).values({
    apId: ALICE,
    type: "Person",
    inbox: `${ALICE}/inbox`,
    publicKeyId: `${ALICE}#main-key`,
    publicKeyPem: key.publicKeyPem,
    lastFetchedAt: new Date().toISOString(),
    rawJson: "{}",
  });
  const delivered: { actor: string; envelope: RtcSignalEnvelopeV1 }[] = [];
  // The existing namespace port is a local capture, never a real DO or HTTP.
  const namespace = {
    idFromName: (actor: string) => actor,
    get: (actor: string) => ({
      async fetch(url: string, init: RequestInit) {
        expect(url).toBe("https://call-do/_ingest");
        expect(init.method).toBe("POST");
        delivered.push({ actor, envelope: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      },
    }),
  };
  const env = {
    APP_URL: APP,
    DB_INSTANCE: db,
    CALL_SIGNALING: namespace,
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.route("/", rtc);
  app.onError((_error, c) =>
    c.json({ error: "controlled local database fault" }, 500),
  );
  async function signal(overrides: Partial<RtcSignalEnvelopeV1> = {}) {
    const envelope: RtcSignalEnvelopeV1 = {
      v: 1,
      callId: "harmless-local-fixture",
      from: ALICE,
      to: BOB,
      type: "offer",
      sdp: "v=0",
      ts: Date.now(),
      ttlMs: 10000,
      ...overrides,
    };
    const body = JSON.stringify(envelope),
      url = `${APP}/ap/rtc/signal`;
    const signed = await signRequest(
      key.privateKeyPem,
      `${ALICE}#main-key`,
      "POST",
      url,
      body,
    );
    const response = await app.fetch(
      new Request(url, {
        method: "POST",
        headers: { ...signed, "Content-Type": "application/json" },
        body,
      }),
      env,
    );
    return { response, envelope };
  }
  return { db, client, delivered, signal, app, env };
}

test("normal signed RTC offer reaches only the selected local namespace port", async () => {
  const f = await fixture();
  try {
    const { response, envelope } = await f.signal();
    expect(response.status).toBe(204);
    expect(f.delivered).toEqual([{ actor: BOB, envelope }]);
    expect(await f.db.select().from(actors)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

for (const blockedId of [
  ALICE,
  "https://REMOTE.example:443/users/alice/#profile",
]) {
  test(`recipient personal block suppresses signed RTC and unblock restores it: ${blockedId}`, async () => {
    const f = await fixture();
    try {
      await f.db
        .insert(blocks)
        .values({ blockerApId: BOB, blockedApId: blockedId });
      expect((await f.signal()).response.status).toBe(204);
      expect(f.delivered).toHaveLength(0);
      expect(await f.db.select().from(blocks)).toHaveLength(1);
      await f.db.delete(blocks).where(eq(blocks.blockerApId, BOB));
      const { response, envelope } = await f.signal();
      expect(response.status).toBe(204);
      expect(f.delivered).toEqual([{ actor: BOB, envelope }]);
    } finally {
      f.client.close();
    }
  });
}

for (const mode of ["otherOwner", "otherPeer", "operator"] as const) {
  test(`RTC personal policy preserves the ${mode} boundary`, async () => {
    const f = await fixture();
    try {
      if (mode === "operator")
        await f.db.insert(blockedActors).values({ actorApId: ALICE });
      else
        await f.db.insert(blocks).values({
          blockerApId: mode === "otherOwner" ? `${APP}/ap/users/other` : BOB,
          blockedApId:
            mode === "otherPeer"
              ? "https://other.example/users/unrelated"
              : ALICE,
        });
      expect((await f.signal()).response.status).toBe(204);
      expect(f.delivered).toHaveLength(mode === "operator" ? 0 : 1);
    } finally {
      f.client.close();
    }
  });
}

for (const table of ["blocks", "blocked_actors"] as const) {
  test(`unreadable RTC ${table} authority cannot deliver or acknowledge success`, async () => {
    const f = await fixture();
    try {
      await f.db.run(sql.raw(`DROP TABLE ${table}`));
      expect((await f.signal()).response.status).toBe(500);
      expect(f.delivered).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

for (const mode of [
  "signerMismatch",
  "unknownRecipient",
  "unsigned",
] as const) {
  test(`RTC personal policy does not replace the ${mode} boundary`, async () => {
    const f = await fixture();
    try {
      const response =
        mode === "unsigned"
          ? await f.app.fetch(
              new Request(`${APP}/ap/rtc/signal`, {
                method: "POST",
                body: "{}",
              }),
              f.env,
            )
          : (
              await f.signal(
                mode === "signerMismatch"
                  ? { from: "https://other.example/users/actor" }
                  : { to: `${APP}/ap/users/missing` },
              )
            ).response;
      expect(response.status).toBe(
        mode === "unsigned" ? 401 : mode === "signerMismatch" ? 403 : 404,
      );
      expect(f.delivered).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}
