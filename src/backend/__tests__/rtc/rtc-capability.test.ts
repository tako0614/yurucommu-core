import { expect, test } from "bun:test";
import { Hono } from "hono";
import type { Database } from "../../../db/index.ts";
import { actorCache, callSessions } from "../../../db/index.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import rtc from "../../routes/rtc/index.ts";
import { createYurucommuBackendApp } from "../../index.ts";
import { isSignalingAvailable } from "../../runtime/signaling-hub.ts";
import type { Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP = "https://local.test";
const URL = `${APP}/ap/rtc/signal`;

function route(db?: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    if (db) c.set("db", db);
    await next();
  });
  app.route("/", rtc);
  app.onError((_error, c) => c.json({ error: "controlled local fault" }, 500));
  return app;
}

function observedRequest(
  body = "{}",
  headers: Record<string, string> = {},
  rejectRead = false,
) {
  let reads = 0;
  class ObservedRequest extends Request {
    override async text(): Promise<string> {
      reads++;
      if (rejectRead) throw new Error("controlled body read failure");
      return super.text();
    }
  }
  return {
    request: new ObservedRequest(URL, { method: "POST", headers, body }),
    reads: () => reads,
  };
}

for (const rejectRead of [false, true]) {
  test(`unconfigured RTC stops before body read: rejecting body ${rejectRead}`, async () => {
    const { db, client } = await createTestDb();
    try {
      const env = { APP_URL: APP, DB_INSTANCE: db } as unknown as Env;
      expect(isSignalingAvailable(env)).toBe(false);
      const observed = observedRequest("{}", {}, rejectRead);
      const response = await route(db).fetch(observed.request, env);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "signaling_unavailable" });
      expect(observed.reads()).toBe(0);
      expect(await db.select().from(callSessions)).toHaveLength(0);
    } finally {
      client.close();
    }
  });
}

test("unconfigured RTC does not require a database binding", async () => {
  const observed = observedRequest();
  const response = await route().fetch(observed.request, {
    APP_URL: APP,
  } as Env);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "signaling_unavailable" });
  expect(observed.reads()).toBe(0);
});

test("unconfigured RTC rejects an actual signed fixture before auth SQL", async () => {
  const { db, client } = await createTestDb();
  try {
    // A fresh retained key prevents remote key fetch in the original source.
    // The unknown recipient stops the original route before any hub/persist.
    const actor = "https://remote.example/users/local-capability-fixture";
    const key = await generateKeyPair();
    await db.insert(actorCache).values({
      apId: actor,
      type: "Person",
      inbox: `${actor}/inbox`,
      publicKeyId: `${actor}#main-key`,
      publicKeyPem: key.publicKeyPem,
      rawJson: "{}",
      lastFetchedAt: new Date().toISOString(),
    });
    const body = JSON.stringify({
      v: 1,
      callId: "harmless-local-fixture",
      from: actor,
      to: `${APP}/ap/users/missing`,
      type: "offer",
      sdp: "v=0",
      ts: Date.now(),
      ttlMs: 10000,
    });
    const signed = await signRequest(
      key.privateKeyPem,
      `${actor}#main-key`,
      "POST",
      URL,
      body,
    );
    const observed = observedRequest(body, signed);
    let queries = 0;
    const execute = client.execute.bind(client);
    client.execute = (async (...args: Parameters<typeof client.execute>) => {
      queries++;
      return execute(...args);
    }) as typeof client.execute;
    const response = await route(db).fetch(observed.request, {
      APP_URL: APP,
      DB_INSTANCE: db,
    } as unknown as Env);
    expect({
      status: response.status,
      bodyReads: observed.reads(),
      queries,
    }).toEqual({ status: 503, bodyReads: 0, queries: 0 });
    expect(await db.select().from(callSessions)).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("configured RTC keeps signature validation ahead of delivery", async () => {
  const { db, client } = await createTestDb();
  try {
    let namespaceGets = 0;
    const namespace = {
      idFromName() {
        namespaceGets++;
        throw new Error("unexpected delivery");
      },
    };
    const env = {
      APP_URL: APP,
      DB_INSTANCE: db,
      CALL_SIGNALING: namespace,
    } as unknown as Env;
    expect(isSignalingAvailable(env)).toBe(true);
    const observed = observedRequest();
    const response = await route(db).fetch(observed.request, env);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
    expect(observed.reads()).toBe(1);
    expect(namespaceGets).toBe(0);
    expect(await db.select().from(callSessions)).toHaveLength(0);
  } finally {
    client.close();
  }
});

test("the owning backend mount returns unavailable without a signaling transport", async () => {
  const { db, client } = await createTestDb();
  try {
    const response = await createYurucommuBackendApp().fetch(
      new Request(URL, {
        method: "POST",
        headers: { "Content-Length": "2" },
        body: "{}",
      }),
      { APP_URL: APP, DB_INSTANCE: db } as unknown as Env,
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "signaling_unavailable" });
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await db.select().from(callSessions)).toHaveLength(0);
  } finally {
    client.close();
  }
});
