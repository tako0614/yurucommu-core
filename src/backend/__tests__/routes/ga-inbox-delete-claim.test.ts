import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  activities,
  actorCache,
  actors,
  inboundActivityClaims,
  inbox,
  objectRecipients,
  objects,
  runBatch,
} from "../../../db/index.ts";
import { activityDeleteCascadeStatements } from "../../lib/activity-delete-cascade.ts";
import { generateKeyPair, signRequest } from "../../federation-helpers.ts";
import inboxRoutes from "../../routes/activitypub/inbox.ts";
import { deleteObjectCascade } from "../../routes/posts/delete-cascade.ts";
import type { Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const HOST = "https://yuru.test";
const LOCAL = `${HOST}/ap/users/bob`;
const AUTHOR = "https://remote.example/users/alice";
const OTHER = "https://remote.example/users/mallory";
const OBJECT = "https://remote.example/objects/received-note";
const keyPair = generateKeyPair();
const otherKeyPair = generateKeyPair();

async function fixture() {
  const f = await createTestDb();
  const dbErrors: unknown[] = [];
  const batch = f.client.batch.bind(f.client);
  f.client.batch = async (...args: Parameters<typeof batch>) => {
    try {
      return await batch(...args);
    } catch (error) {
      dbErrors.push(error);
      throw error;
    }
  };
  const keys = await keyPair,
    otherKeys = await otherKeyPair;
  await f.db.insert(actors).values({
    apId: LOCAL,
    preferredUsername: "bob",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "unused-local-key",
    privateKeyPem: "unused-local-key",
  });
  for (const [actor, pair] of [
    [AUTHOR, keys],
    [OTHER, otherKeys],
  ] as const) {
    await f.db.insert(actorCache).values({
      apId: actor,
      type: "Person",
      preferredUsername: actor.split("/").at(-1),
      inbox: `${actor}/inbox`,
      publicKeyId: `${actor}#main-key`,
      publicKeyPem: pair.publicKeyPem,
      rawJson: JSON.stringify({ id: actor, type: "Person" }),
      lastFetchedAt: new Date().toISOString(),
    });
  }
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", f.db);
    await next();
  });
  app.route("/", inboxRoutes);
  async function request(
    type: "Create" | "Delete",
    shared = false,
    actor = AUTHOR,
  ) {
    const body = JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${actor}/activities/${type}`,
      type,
      actor,
      to: [LOCAL],
      object:
        type === "Delete"
          ? { id: OBJECT, type: "Tombstone", formerType: "Note" }
          : {
              id: OBJECT,
              type: "Note",
              attributedTo: actor,
              content: "Message before deletion",
              to: [LOCAL],
              cc: [],
              published: "2026-11-05T00:00:00.000Z",
            },
    });
    const url = shared ? `${HOST}/ap/inbox` : `${LOCAL}/inbox`;
    const pair = actor === AUTHOR ? keys : otherKeys;
    const headers = await signRequest(
      pair.privateKeyPem,
      `${actor}#main-key`,
      "POST",
      url,
      body,
    );
    return app.fetch(
      new Request(url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/activity+json" },
        body,
      }),
      { APP_URL: HOST } as Env,
    );
  }
  async function deletion(actor = AUTHOR) {
    return (await f.db.select().from(activities)).find(
      (row) => row.type === "Delete" && row.actorApId === actor,
    )!;
  }
  return { ...f, request, deletion, dbErrors };
}

for (const shared of [false, true]) {
  test(`signed ${shared ? "shared" : "user"} inbox Delete acknowledges its first completed effect and releases its own claim`, async () => {
    const f = await fixture();
    try {
      expect((await f.request("Create")).status).toBe(202);
      const response = await f.request("Delete", shared);
      expect(await f.db.select().from(objects)).toHaveLength(0);
      expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
      expect(await f.db.select().from(inbox)).toHaveLength(0);
      expect(response.status).toBe(202);
      const activity = await f.deletion();
      expect(activity.processed).toBe(1);
      const claims = await f.db.select().from(inboundActivityClaims);
      expect(claims.map((row) => row.activityApId)).toEqual([activity.apId]);
      expect(claims[0]?.processingToken).toBeNull();
      expect(claims[0]?.leaseExpiresAt).toBeNull();
      const before = await f.db.select().from(activities);
      expect((await f.request("Delete", shared)).status).toBe(202);
      expect(await f.db.select().from(activities)).toEqual(before);
      expect(
        (await f.db.select().from(inboundActivityClaims)).map(
          (row) => row.processingToken,
        ),
      ).toEqual([null]);
      expect(await f.db.select().from(inbox)).toHaveLength(0);
    } finally {
      f.client.close();
    }
  });
}

test("another correctly signed same-origin actor cannot delete the Note or its projections", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    const before = {
      objects: await f.db.select().from(objects),
      recipients: await f.db.select().from(objectRecipients),
      inbox: await f.db.select().from(inbox),
    };
    expect((await f.request("Delete", false, OTHER)).status).toBe(202);
    expect(await f.db.select().from(objects)).toEqual(before.objects);
    expect(await f.db.select().from(objectRecipients)).toEqual(
      before.recipients,
    );
    expect(await f.db.select().from(inbox)).toEqual(before.inbox);
    expect((await f.deletion(OTHER)).processed).toBe(1);
  } finally {
    f.client.close();
  }
});

test("default object projection cleanup still removes all selected inbound claims", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(1);
    await deleteObjectCascade(f.db, OBJECT);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    expect(await f.db.select().from(objects)).toHaveLength(1); // Caller still owns object removal.
    expect(await f.db.select().from(activities)).toHaveLength(1); // Retained ledger.
  } finally {
    f.client.close();
  }
});

test("hard Activity deletion still honors its guard and cannot retain a projection-only claim hint", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    const [activity] = await f.db.select().from(activities);
    const where = eq(activities.apId, activity!.apId);
    const hint = {
      preserveInboundClaimActivityApId: activity!.apId,
      guard: sql`0`,
    };
    await runBatch(f.db, activityDeleteCascadeStatements(f.db, where, hint));
    expect(await f.db.select().from(activities)).toHaveLength(1);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(1);
    expect(await f.db.select().from(inbox)).toHaveLength(1);
    await runBatch(
      f.db,
      activityDeleteCascadeStatements(f.db, where, { ...hint, guard: sql`1` }),
    );
    expect(await f.db.select().from(activities)).toHaveLength(0);
    expect(await f.db.select().from(inboundActivityClaims)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
    expect(await f.db.select().from(objects)).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("a real final object-delete failure remains retryable without losing the Delete claim", async () => {
  const f = await fixture();
  try {
    expect((await f.request("Create")).status).toBe(202);
    await f.client.execute(
      "CREATE TRIGGER reject_object_delete BEFORE DELETE ON objects BEGIN SELECT RAISE(ABORT,'synthetic final object deletion'); END",
    );
    expect((await f.request("Delete")).status).toBe(503);
    expect(f.dbErrors.map(String).join("\n")).toContain(
      "synthetic final object deletion",
    );
    expect(
      await f.db.select().from(objects).where(eq(objects.apId, OBJECT)),
    ).toHaveLength(1);
    const activity = await f.deletion();
    expect(activity.processed).toBe(0);
    const claim = await f.db
      .select()
      .from(inboundActivityClaims)
      .where(eq(inboundActivityClaims.activityApId, activity.apId))
      .get();
    expect(claim).toBeDefined();
    expect(claim?.processingToken).toBeNull();
    await f.client.execute("DROP TRIGGER reject_object_delete");
    expect((await f.request("Delete")).status).toBe(202); // Same original wire Activity id/body.
    expect((await f.deletion()).processed).toBe(1);
    expect(await f.db.select().from(objects)).toHaveLength(0);
    expect(await f.db.select().from(objectRecipients)).toHaveLength(0);
    expect(await f.db.select().from(inbox)).toHaveLength(0);
  } finally {
    f.client.close();
  }
});
