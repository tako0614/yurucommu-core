import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  activities,
  actors,
  blockedActors,
  bookmarks,
  deliveryFanouts,
  deliveryQueue,
  deliveryResolutions,
  objects,
} from "../../../db/index.ts";
import { processResolveActor } from "../../lib/delivery/queue-batching.ts";
import { buildResolveActorMessage } from "../../lib/delivery/resolution-outbox.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const OWNER = `${APP_URL}/ap/users/owner`;
const POST = `${APP_URL}/ap/objects/direct`;
const BOB = "https://remote.test/users/bob";
const CAROL = "https://remote.test/users/carol";

async function fixture(
  options: {
    recipients?: string[];
    queue?: "absent" | "failed";
  } = {},
) {
  const { db, client } = await createTestDb();
  await db.insert(actors).values({
    apId: OWNER,
    type: "Person",
    preferredUsername: "owner",
    inbox: `${OWNER}/inbox`,
    outbox: `${OWNER}/outbox`,
    followersUrl: `${OWNER}/followers`,
    followingUrl: `${OWNER}/following`,
    publicKeyPem: "FIXTURE-PUBLIC",
    privateKeyPem: "FIXTURE-PRIVATE",
    postCount: 2,
  });
  await db.insert(objects).values({
    apId: POST,
    type: "Note",
    attributedTo: OWNER,
    content: "small local direct fixture",
    published: "2026-01-01T00:00:00.000Z",
    visibility: "direct",
    isLocal: 1,
    toJson: JSON.stringify(options.recipients ?? [BOB, CAROL]),
    ccJson: "[]",
  });
  await db.insert(bookmarks).values({ actorApId: OWNER, objectApId: POST });
  const sent: unknown[] = [];
  const queue = {
    async send(body: unknown) {
      if (options.queue === "failed")
        throw new Error("fixture Queue unavailable");
      sent.push(body);
    },
    async sendBatch(messages: { body: unknown }[]) {
      if (options.queue === "failed")
        throw new Error("fixture Queue unavailable");
      sent.push(...messages.map((message) => message.body));
    },
  };
  const env = {
    APP_URL,
    DB_INSTANCE: db,
    ...(options.queue === "absent"
      ? {}
      : { DELIVERY_QUEUE: queue, DELIVERY_DLQ: queue }),
  } as unknown as Env;
  let signedInActor = OWNER;
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: signedInActor } as Actor);
    await next();
  });
  app.route("/api/posts", postsRoutes);
  const remove = () =>
    app.fetch(
      new Request(`${APP_URL}/api/posts/${encodeURIComponent(POST)}`, {
        method: "DELETE",
      }),
      env,
    );
  const snapshot = async () => ({
    objects: await db.select().from(objects),
    actors: await db.select().from(actors),
    bookmarks: await db.select().from(bookmarks),
    activities: await db.select().from(activities),
    intents: await db.select().from(deliveryResolutions),
    fanouts: await db.select().from(deliveryFanouts),
  });
  return {
    db,
    client,
    env,
    remove,
    snapshot,
    sent,
    signInAs: (actor: string) => {
      signedInActor = actor;
    },
  };
}

test("direct Delete rolls back the object, child projection and activity when intent persistence fails", async () => {
  const f = await fixture();
  try {
    const before = await f.snapshot();
    await f.db
      .run(sql`CREATE TRIGGER fail_direct_intent BEFORE INSERT ON delivery_resolutions
      BEGIN SELECT RAISE(ABORT, 'fixture intent unavailable'); END`);
    expect((await f.remove()).status).toBe(500);
    expect(await f.snapshot()).toEqual(before);
    expect(f.sent).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a successful direct Delete keeps only the exact remote intents and does not change postCount", async () => {
  const f = await fixture();
  try {
    expect((await f.remove()).status).toBe(200);
    const after = await f.snapshot();
    expect(after.objects).toHaveLength(0);
    expect(after.bookmarks).toHaveLength(0);
    expect(after.actors[0].postCount).toBe(2);
    expect(after.activities).toHaveLength(1);
    expect(after.activities[0]).toMatchObject({
      type: "Delete",
      objectApId: POST,
      actorApId: OWNER,
    });
    expect(JSON.parse(after.activities[0].rawJson!).to).toEqual([BOB, CAROL]);
    expect(after.intents).toHaveLength(2);
    expect(after.intents.map((row) => row.recipientActorApId).sort()).toEqual(
      [BOB, CAROL].sort(),
    );
    expect(
      after.intents.every(
        (row) => row.activityApId === after.activities[0].apId,
      ),
    ).toBe(true);
    expect(after.fanouts).toHaveLength(0);
    expect((await f.remove()).status).toBe(404);
    expect(await f.snapshot()).toEqual(after);
  } finally {
    f.client.close();
  }
});

for (const queue of ["absent", "failed"] as const) {
  test(`direct Delete retains pending intents when its Queue is ${queue}`, async () => {
    const f = await fixture({ queue });
    try {
      expect((await f.remove()).status).toBe(200);
      const after = await f.snapshot();
      expect(after.objects).toHaveLength(0);
      expect(after.activities).toHaveLength(1);
      expect(after.intents).toHaveLength(2);
      expect(
        after.intents.every(
          (row) => row.status === "pending" && row.attempts === 0,
        ),
      ).toBe(true);
      expect(after.intents.map((row) => row.recipientActorApId).sort()).toEqual(
        [BOB, CAROL].sort(),
      );
      expect(f.sent).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

test("direct Delete preserves safe reply-parent targeting while excluding local and collection recipients", async () => {
  const f = await fixture({
    recipients: [
      BOB,
      BOB,
      OWNER,
      "https://www.w3.org/ns/activitystreams#Public",
      `${OWNER}/followers`,
      "https://remote.test/users/bob/followers",
      "http://127.0.0.1/private",
    ],
  });
  try {
    const parent = "https://remote.test/objects/parent";
    await f.db.insert(objects).values({
      apId: parent,
      type: "Note",
      attributedTo: CAROL,
      content: "parent fixture",
      published: "2026-01-01T00:00:00.000Z",
      isLocal: 0,
    });
    await f.db
      .update(objects)
      .set({ inReplyTo: parent })
      .where(eq(objects.apId, POST));
    expect((await f.remove()).status).toBe(200);
    const after = await f.snapshot();
    expect(after.objects.map((row) => row.apId)).toEqual([parent]);
    expect(after.intents.map((row) => row.recipientActorApId).sort()).toEqual(
      [BOB, CAROL].sort(),
    );
    expect(after.fanouts).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("direct Delete chunks recipient intent writes under the D1 binding limit", async () => {
  const recipients = Array.from(
    { length: 13 },
    (_, i) => `https://remote.test/users/member-${i}`,
  );
  const f = await fixture({ recipients, queue: "absent" });
  try {
    expect((await f.remove()).status).toBe(200);
    const after = await f.snapshot();
    expect(after.activities).toHaveLength(1);
    expect(after.intents).toHaveLength(13);
    expect(after.intents.map((row) => row.recipientActorApId).sort()).toEqual(
      [...recipients].sort(),
    );
    expect(after.fanouts).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a non-owner cannot create Delete intents or change the object", async () => {
  const f = await fixture();
  try {
    f.signInAs(`${APP_URL}/ap/users/other`);
    const before = await f.snapshot();
    expect((await f.remove()).status).toBe(403);
    expect(await f.snapshot()).toEqual(before);
    expect(f.sent).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a blocked recipient's retained direct Delete intent is discarded before endpoint resolution", async () => {
  const f = await fixture({ recipients: [BOB] });
  try {
    await f.db.insert(blockedActors).values({ actorApId: BOB });
    expect((await f.remove()).status).toBe(200);
    const intent = await f.db.select().from(deliveryResolutions).get();
    expect(intent).toMatchObject({
      recipientActorApId: BOB,
      status: "pending",
    });
    const body = buildResolveActorMessage(intent!.activityApId, BOB);
    if (body.type !== "resolve_actor")
      throw new Error("Unexpected fixture message");
    let acknowledgements = 0;
    await processResolveActor(f.db, f.env, body, {
      id: "local-blocked-intent",
      body,
      timestamp: new Date(),
      attempts: 1,
      ack: () => {
        acknowledgements++;
      },
      retry: () => {
        throw new Error("Unexpected retry");
      },
    });
    expect(acknowledgements).toBe(1);
    expect(await f.db.select().from(deliveryResolutions).get()).toMatchObject({
      status: "discarded",
      lastError: "recipient_blocked",
    });
    expect(await f.db.select().from(deliveryQueue)).toHaveLength(0);
    expect(f.sent).toHaveLength(0);
  } finally {
    f.client.close();
  }
});
