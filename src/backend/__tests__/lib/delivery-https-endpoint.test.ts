import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  activities,
  actorCache,
  actors,
  deliveryQueue,
} from "../../../db/index.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import { assertSafeRemoteUrlResolved } from "../../lib/ssrf.ts";
import { Bulkhead, upsertDeliveryJob } from "../../lib/delivery/queue.ts";
import { processDeliverEndpoint } from "../../lib/delivery/queue-delivery.ts";
import { safeEndpointHost } from "../../lib/delivery/transformers.ts";
import type { DeliveryQueueMessageV1 } from "../../lib/delivery/types.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const FLAG = "YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES";
async function withLocalOptIn<T>(
  enabled: boolean,
  run: () => Promise<T> | T,
): Promise<T> {
  const previous = process.env[FLAG];
  if (enabled) process.env[FLAG] = "1";
  else delete process.env[FLAG];
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  }
}

test("delivery defaults to HTTPS and retains the existing URL safety checks", () =>
  withLocalOptIn(false, () => {
    expect(safeEndpointHost("http://peer.example/inbox")).toBeNull();
    expect(safeEndpointHost("https://peer.example/inbox")).toBe("peer.example");
    expect(safeEndpointHost("https://peer.example:8443/inbox")).toBe(
      "peer.example:8443",
    );
    for (const value of [
      "ftp://peer.example/inbox",
      "not a URL",
      "https://localhost/inbox",
      "https://user:pass@peer.example/inbox",
      "https://127.0.0.1/inbox",
    ])
      expect(safeEndpointHost(value)).toBeNull();
  }));

test("explicit existing local opt-in permits HTTP without admitting private or credentialed endpoints", () =>
  withLocalOptIn(true, () => {
    expect(safeEndpointHost("http://peer.example/inbox")).toBe("peer.example");
    expect(safeEndpointHost("https://peer.example/inbox")).toBe("peer.example");
    for (const value of [
      "http://127.0.0.1/inbox",
      "http://169.254.169.254/inbox",
      "http://10.0.0.1/inbox",
      "http://[::1]/inbox",
      "http://localhost/inbox",
      "http://user:pass@peer.example/inbox",
    ])
      expect(safeEndpointHost(value)).toBeNull();
  }));

test("opt-in leaves the existing takos.test DNS exception HTTPS:443-only", () =>
  withLocalOptIn(true, async () => {
    let resolverCalls = 0;
    const options = {
      localResolver: async () => {
        resolverCalls++;
        return ["127.0.0.1"];
      },
    };
    await expect(
      assertSafeRemoteUrlResolved("http://peer.takos.test/inbox", options),
    ).rejects.toThrow("Unsafe local-substrate remote URL");
    await expect(
      assertSafeRemoteUrlResolved(
        "https://peer.takos.test:8443/inbox",
        options,
      ),
    ).rejects.toThrow("Unsafe local-substrate remote URL");
    expect(resolverCalls).toBe(0);
    const result = await assertSafeRemoteUrlResolved(
      "https://peer.takos.test/inbox",
      options,
    );
    expect(new Set(result)).toEqual(new Set(["127.0.0.1"]));
    expect(resolverCalls).toBe(2);
  }));

// Ephemeral synthetic signing material stays in this disposable fixture DB.
// The existing delivery-fetch port is local: no request/DNS lookup is made.
const localKeys = generateKeyPair();
async function deliver(
  endpoint: string,
  state: "pending" | "retry_wait" = "pending",
  shadowInbox?: string,
) {
  const { db, client } = await createTestDb();
  try {
    const owner = "https://local.test/ap/users/owner",
      activity = "https://local.test/ap/activities/private-fixture";
    const keys = await localKeys;
    await db.insert(actors).values({
      apId: owner,
      type: "Person",
      preferredUsername: "local-fixture",
      inbox: `${owner}/inbox`,
      outbox: `${owner}/outbox`,
      followersUrl: `${owner}/followers`,
      followingUrl: `${owner}/following`,
      publicKeyPem: keys.publicKeyPem,
      privateKeyPem: keys.privateKeyPem,
    });
    const rawJson = JSON.stringify({
      id: activity,
      type: "Create",
      actor: owner,
      to: ["https://peer.example/users/recipient"],
      object: { type: "Note", content: "local private-message fixture" },
    });
    await db.insert(activities).values({
      apId: activity,
      type: "Create",
      actorApId: owner,
      direction: "outbound",
      rawJson,
    });
    await upsertDeliveryJob(db, "selected-job", activity, endpoint, [
      "https://peer.example/users/recipient",
    ]);
    await db.update(deliveryQueue).set({
      status: state,
      attempts: state === "retry_wait" ? 3 : 0,
      reconcileAttempt: state === "retry_wait" ? 2 : 0,
      nextAttemptAt: "2020-01-01T00:00:00.000Z",
    });
    if (shadowInbox)
      await db.insert(actorCache).values({
        apId: "https://peer.example/users/recipient",
        inbox: shadowInbox,
        sharedInbox: endpoint,
        rawJson: "{}",
      });
    const urls: string[] = [];
    let shadowProbeCalls = 0;
    let acks = 0,
      retries = 0,
      portCalls = 0;
    const sent: DeliveryQueueMessageV1[] = [];
    const queue = {
      send: async (body: DeliveryQueueMessageV1) => {
        sent.push(body);
      },
      sendBatch: async () => {},
    };
    const env = {
      APP_URL: "https://local.test",
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
      ...(shadowInbox
        ? {
            DELIVERY_SHADOW_PROBE_HOSTS: "peer.example",
            DELIVERY_SHADOW_PROBE_SAMPLE_RATE: "1",
          }
        : {}),
    } as unknown as Env;
    const body = {
      version: 1,
      type: "deliver_endpoint",
      jobId: "selected-job",
      scheduledAt: new Date().toISOString(),
    } as const;
    await processDeliverEndpoint(
      db,
      env,
      body,
      {
        id: "local-delivery",
        body,
        timestamp: new Date(),
        attempts: 1,
        ack() {
          acks++;
        },
        retry() {
          retries++;
        },
      },
      new Bulkhead(10, 3),
      async (url, init) => {
        portCalls++;
        urls.push(String(url));
        if (!init) throw new Error("Missing local delivery request options");
        if (new Headers(init.headers).has("X-Yurucommu-Shadow-Probe"))
          shadowProbeCalls++;
        expect(init.method).toBe("POST");
        expect(init.body).toBe(rawJson);
        expect(new Headers(init.headers).has("Signature")).toBe(true);
        return new Response("local acceptance", { status: 202 });
      },
    );
    const job = await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, "selected-job"))
      .get();
    return { job, acks, retries, portCalls, sent, urls, shadowProbeCalls };
  } finally {
    client.close();
  }
}

for (const state of ["pending", "retry_wait"] as const) {
  test(`existing ${state} HTTP delivery fails explicitly without posting or resetting budgets`, () =>
    withLocalOptIn(false, async () => {
      const result = await deliver("http://peer.example/inbox", state);
      expect(result).toMatchObject({
        acks: 1,
        retries: 0,
        portCalls: 0,
        sent: [],
        urls: [],
      });
      expect(result.job).toMatchObject({
        status: "failed",
        error: "invalid_endpoint",
        attempts: state === "retry_wait" ? 3 : 0,
        reconcileAttempt: state === "retry_wait" ? 2 : 0,
        processingToken: null,
        endpointRecoveryPending: 0,
      });
    }));
}

test("HTTPS private-message delivery preserves the real signing and completion path", () =>
  withLocalOptIn(false, async () => {
    const result = await deliver("https://peer.example/inbox");
    expect(result).toMatchObject({
      acks: 1,
      retries: 0,
      portCalls: 1,
      sent: [],
    });
    expect(result.urls).toEqual(["https://peer.example/inbox"]);
    expect(result.job).toMatchObject({
      status: "delivered",
      attempts: 0,
      reconcileAttempt: 0,
      processingToken: null,
    });
  }));

test("explicit local HTTP opt-in preserves the existing signing path", () =>
  withLocalOptIn(true, async () => {
    const result = await deliver("http://peer.example/inbox");
    expect(result).toMatchObject({
      acks: 1,
      retries: 0,
      portCalls: 1,
      sent: [],
    });
    expect(result.urls).toEqual(["http://peer.example/inbox"]);
    expect(result.job).toMatchObject({
      status: "delivered",
      attempts: 0,
      reconcileAttempt: 0,
    });
  }));

test("private HTTP endpoint remains rejected even in explicit local mode", () =>
  withLocalOptIn(true, async () => {
    const result = await deliver("http://127.0.0.1/inbox");
    expect(result).toMatchObject({
      acks: 1,
      retries: 0,
      portCalls: 0,
      sent: [],
      urls: [],
    });
    expect(result.job).toMatchObject({
      status: "failed",
      error: "invalid_endpoint",
    });
  }));

test("enabled shadow probe also refuses HTTP without explicit local opt-in", () =>
  withLocalOptIn(false, async () => {
    const endpoint = "https://peer.example/shared";
    const result = await deliver(
      endpoint,
      "pending",
      "http://peer.example/users/recipient/inbox",
    );
    expect(result.urls).toEqual([endpoint]);
    expect(result).toMatchObject({
      acks: 1,
      retries: 0,
      portCalls: 1,
      shadowProbeCalls: 0,
    });
    expect(result.job).toMatchObject({ status: "delivered" });
  }));

test("enabled HTTPS shadow probe keeps its signing path", () =>
  withLocalOptIn(false, async () => {
    const endpoint = "https://peer.example/shared",
      inbox = "https://peer.example/users/recipient/inbox";
    const result = await deliver(endpoint, "pending", inbox);
    expect(result.urls).toEqual([endpoint, inbox]);
    expect(result).toMatchObject({
      acks: 1,
      retries: 0,
      portCalls: 2,
      shadowProbeCalls: 1,
    });
    expect(result.job).toMatchObject({ status: "delivered" });
  }));

test("shadow HTTP remains available only with explicit local opt-in", () =>
  withLocalOptIn(true, async () => {
    const endpoint = "https://peer.example/shared",
      inbox = "http://peer.example/users/recipient/inbox";
    const result = await deliver(endpoint, "pending", inbox);
    expect(result.urls).toEqual([endpoint, inbox]);
    expect(result).toMatchObject({
      acks: 1,
      retries: 0,
      portCalls: 2,
      shadowProbeCalls: 1,
    });
    expect(result.job).toMatchObject({ status: "delivered" });
  }));
