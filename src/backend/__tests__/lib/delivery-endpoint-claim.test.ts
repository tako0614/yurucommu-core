import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  deliveryEndpointRecipients,
  deliveryQueue,
  remoteActorTombstones,
} from "../../../db/index.ts";
import type { IQueueMessage } from "../../runtime/queue.ts";
import type { Env } from "../../types.ts";
import { generateKeyPair } from "../../federation-helpers.ts";
import { Bulkhead, upsertDeliveryJob } from "../../lib/delivery/queue.ts";
import { processDeliverEndpoint } from "../../lib/delivery/queue-delivery.ts";
import type {
  DeliveryDeliverEndpointMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";
import { handleDelete } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const SENDER = `${APP_URL}/ap/users/alice`;
const REMOTE = "https://remote.example/users/bob";
const ACTIVITY_ID = `${APP_URL}/ap/activities/endpoint-claim`;
const ENDPOINT = "https://example.com/inbox";
const JOB_ID = "endpoint-claim-job";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { MEDIA: undefined, APP_URL },
  } as unknown as ActivityContext;
}

function deleteRemoteActor(): Activity {
  return {
    id: `${REMOTE}#delete`,
    type: "Delete",
    actor: REMOTE,
    object: REMOTE,
  } as unknown as Activity;
}

function deliveryMessage(): DeliveryDeliverEndpointMessageV1 {
  return {
    version: 1,
    type: "deliver_endpoint",
    jobId: JOB_ID,
    scheduledAt: new Date().toISOString(),
  };
}

function queueHarness(db: Database) {
  const sent: DeliveryQueueMessageV1[] = [];
  let acknowledgements = 0;
  let retries = 0;
  const queue = {
    send: async (body: DeliveryQueueMessageV1) => {
      sent.push(body);
    },
    sendBatch: async () => {},
  };
  return {
    sent,
    get acknowledgements() {
      return acknowledgements;
    },
    get retries() {
      return retries;
    },
    env: {
      APP_URL,
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as unknown as Env,
    message: {
      ack: () => {
        acknowledgements += 1;
      },
      retry: () => {
        retries += 1;
      },
    } as unknown as IQueueMessage<DeliveryQueueMessageV1>,
  };
}

async function seedEndpointJob(db: Database): Promise<void> {
  expect(
    await upsertDeliveryJob(db, JOB_ID, ACTIVITY_ID, ENDPOINT, [REMOTE]),
  ).toBe(true);
}

test("the Bun/libsql runtime continues after a successful endpoint-job claim", async () => {
  const db = await freshDb();
  await seedEndpointJob(db);
  const harness = queueHarness(db);

  await processDeliverEndpoint(
    db,
    harness.env,
    deliveryMessage(),
    harness.message,
    new Bulkhead(10, 5),
  );

  expect(
    await db
      .select({
        status: deliveryQueue.status,
        error: deliveryQueue.error,
        processingStartedAt: deliveryQueue.processingStartedAt,
      })
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, JOB_ID))
      .get(),
  ).toEqual({
    status: "failed",
    error: "activity_not_found",
    processingStartedAt: null,
  });
  expect(harness.acknowledgements).toBe(1);
  expect(harness.retries).toBe(0);
});

test("Actor Delete that commits before endpoint claim prevents delivery", async () => {
  const db = await freshDb();
  await seedEndpointJob(db);
  const harness = queueHarness(db);
  const deleteBeforeClaim = {
    acquire: async () => {
      await handleDelete(ctxFor(db), deleteRemoteActor());
    },
    release: () => {},
  } as unknown as Bulkhead;

  await processDeliverEndpoint(
    db,
    harness.env,
    deliveryMessage(),
    harness.message,
    deleteBeforeClaim,
  );

  expect(await db.select().from(deliveryQueue)).toEqual([]);
  expect(await db.select().from(deliveryEndpointRecipients)).toEqual([]);
  expect(await db.select().from(remoteActorTombstones)).toMatchObject([
    { actorApId: REMOTE },
  ]);
  expect(harness.sent).toEqual([]);
  expect(harness.acknowledgements).toBe(1);
  expect(harness.retries).toBe(0);
});

test("endpoint claim that wins before Actor Delete sends once without resurrecting the job", async () => {
  const db = await freshDb();
  const keys = await generateKeyPair();
  await db.insert(actors).values({
    apId: SENDER,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${SENDER}/inbox`,
    outbox: `${SENDER}/outbox`,
    followersUrl: `${SENDER}/followers`,
    followingUrl: `${SENDER}/following`,
    publicKeyPem: keys.publicKeyPem,
    privateKeyPem: keys.privateKeyPem,
  });
  await db.insert(activities).values({
    apId: ACTIVITY_ID,
    type: "Create",
    actorApId: SENDER,
    objectApId: `${APP_URL}/ap/objects/endpoint-claim`,
    rawJson: JSON.stringify({
      id: ACTIVITY_ID,
      type: "Create",
      actor: SENDER,
    }),
    direction: "outbound",
  });
  await seedEndpointJob(db);
  const harness = queueHarness(db);
  let fetches = 0;
  const deliveryFetch = async () => {
    fetches += 1;
    await handleDelete(ctxFor(db), deleteRemoteActor());
    return new Response(null, { status: 202 });
  };

  await processDeliverEndpoint(
    db,
    harness.env,
    deliveryMessage(),
    harness.message,
    new Bulkhead(10, 5),
    deliveryFetch,
  );

  expect(fetches).toBe(1);
  expect(await db.select().from(deliveryQueue)).toEqual([]);
  expect(await db.select().from(deliveryEndpointRecipients)).toEqual([]);
  expect(await db.select().from(remoteActorTombstones)).toMatchObject([
    { actorApId: REMOTE },
  ]);
  expect(harness.sent).toEqual([]);
  expect(harness.acknowledgements).toBe(1);
  expect(harness.retries).toBe(0);
});
