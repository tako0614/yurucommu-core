import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import {
  activities,
  actorCache,
  actors,
  blockedActors,
  blockedDomains,
  deliveryEndpointRecipients,
  deliveryQueue,
  remoteActorTombstones,
  type Database,
} from "../../../db/index.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import { Bulkhead, upsertDeliveryJob } from "../../lib/delivery/queue.ts";
import { processDeliverEndpoint } from "../../lib/delivery/queue-delivery.ts";
import type { DeliveryQueueMessageV1 } from "../../lib/delivery/types.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const endpoint = "https://peer.example/shared";
const recipient = "https://peer.example/users/recipient";
const cacheOnly = "https://peer.example/users/cache-only";
const activity = "https://local.test/ap/activities/shadow-fixture";
const localKeys = generateKeyPair();

// Actual handler and disposable migrated DB; the existing fetch port captures
// signed requests locally. No network, real credential or remote acceptance.
async function deliver(
  options: {
    prepare?: (db: Database) => Promise<void>;
    afterPrimary?: (db: Database) => Promise<void>;
    hosts?: string;
    sample?: string;
    shadowThrows?: boolean;
  } = {},
) {
  const { db, client } = await createTestDb();
  try {
    const owner = "https://local.test/ap/users/owner";
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
      to: [recipient],
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
      recipient,
    ]);
    // Deliberately insert a non-recipient cache entry first. Endpoint cache
    // proximity, insertion order and a different job cannot authorize a probe.
    for (const apId of [cacheOnly, recipient]) {
      await db.insert(actorCache).values({
        apId,
        inbox: `${apId}/inbox`,
        sharedInbox: endpoint,
        rawJson: "{}",
      });
    }
    await options.prepare?.(db);
    const urls: string[] = [];
    let acks = 0,
      retries = 0;
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
      DELIVERY_SHADOW_PROBE_HOSTS: options.hosts ?? "peer.example",
      DELIVERY_SHADOW_PROBE_SAMPLE_RATE: options.sample ?? "1",
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
        urls.push(String(url));
        if (!init) throw new Error("Missing local delivery request options");
        expect(init.method).toBe("POST");
        expect(init.body).toBe(rawJson);
        const headers = new Headers(init.headers);
        expect(headers.has("Signature")).toBe(true);
        if (headers.has("X-Yurucommu-Shadow-Probe")) {
          if (options.shadowThrows)
            throw new Error("Local probe transport fault");
        } else {
          expect(String(url)).toBe(endpoint);
          await options.afterPrimary?.(db);
        }
        return new Response("local acceptance", { status: 202 });
      },
    );
    const job = await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, "selected-job"))
      .get();
    expect(job).toMatchObject({
      status: "delivered",
      attempts: 0,
      reconcileAttempt: 0,
      processingToken: null,
    });
    expect({ acks, retries, sent }).toEqual({ acks: 1, retries: 0, sent: [] });
    return urls;
  } finally {
    client.close();
  }
}

async function removeAttribution(db: Database) {
  await db
    .delete(deliveryEndpointRecipients)
    .where(eq(deliveryEndpointRecipients.deliveryJobId, "selected-job"));
}

test("configured probe selects the positive recipient, never a cache-only co-tenant", async () => {
  expect(await deliver()).toEqual([endpoint, `${recipient}/inbox`]);
});

test("unknown legacy attribution does not authorize a cache-only probe", async () => {
  expect(
    await deliver({
      prepare: async (db) => {
        await removeAttribution(db);
        await db.update(deliveryQueue).set({ recipientAttributionComplete: 0 });
      },
    }),
  ).toEqual([endpoint]);
});

for (const mismatch of ["orphan", "activity", "endpoint", "job"] as const) {
  test(`a ${mismatch} recipient mapping cannot authorize this job's probe`, async () => {
    expect(
      await deliver({
        prepare: async (db) => {
          await removeAttribution(db);
          if (mismatch !== "orphan")
            await upsertDeliveryJob(
              db,
              "other-job",
              mismatch === "activity" ? `${activity}/other` : activity,
              mismatch === "endpoint" ? `${endpoint}/other` : endpoint,
              [cacheOnly],
            );
          else
            await db.insert(deliveryEndpointRecipients).values({
              deliveryJobId: "missing-job",
              recipientActorApId: cacheOnly,
            });
        },
      }),
    ).toEqual([endpoint]);
  });
}

test("known positive recipients remain usable on partially attributed legacy jobs", async () => {
  expect(
    await deliver({
      prepare: async (db) => {
        await db.update(deliveryQueue).set({ recipientAttributionComplete: 0 });
      },
    }),
  ).toEqual([endpoint, `${recipient}/inbox`]);
});

for (const change of ["mapping", "cache", "sharedEndpoint"] as const) {
  test(`a ${change} removed or changed during primary delivery has no cache-only fallback`, async () => {
    expect(
      await deliver({
        afterPrimary: async (db) => {
          if (change === "mapping") await removeAttribution(db);
          else if (change === "cache")
            await db.delete(actorCache).where(eq(actorCache.apId, recipient));
          else
            await db
              .update(actorCache)
              .set({ sharedInbox: `${endpoint}/new` })
              .where(eq(actorCache.apId, recipient));
        },
      }),
    ).toEqual([endpoint]);
  });
}

for (const authority of ["tombstone", "actorBlock", "domainBlock"] as const) {
  test(`current ${authority} prevents a secondary probe without undoing primary success`, async () => {
    expect(
      await deliver({
        afterPrimary: async (db) => {
          if (authority === "tombstone")
            await db.insert(remoteActorTombstones).values({
              actorApId: recipient,
              deleteActivityApId: `${activity}/delete`,
            });
          else if (authority === "actorBlock")
            await db.insert(blockedActors).values({ actorApId: recipient });
          else
            await db.insert(blockedDomains).values({ domain: "peer.example" });
        },
      }),
    ).toEqual([endpoint]);
  });
}

for (const options of [
  { hosts: "" },
  { hosts: "other.example" },
  { sample: "0" },
]) {
  test(`disabled or unselected probe stays closed: ${JSON.stringify(options)}`, async () => {
    expect(await deliver(options)).toEqual([endpoint]);
  });
}

test("unreadable moderation authority skips the probe and keeps primary success", async () => {
  expect(
    await deliver({
      afterPrimary: async (db) => {
        await db.run(sql`DROP TABLE blocked_domains`);
      },
    }),
  ).toEqual([endpoint]);
});

test("probe transport failure preserves the successful primary ACK and budgets", async () => {
  expect(await deliver({ shadowThrows: true })).toEqual([
    endpoint,
    `${recipient}/inbox`,
  ]);
});
