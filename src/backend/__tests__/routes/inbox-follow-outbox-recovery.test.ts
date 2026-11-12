import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  activities,
  actors,
  blocks,
  deliveryResolutions,
  follows,
  inbox,
} from "../../../db/index.ts";
import { acceptRetainedFollowDirection } from "../../lib/follow-edge-mutations.ts";
import { handleFollow } from "../../routes/activitypub/handlers/inbox-follow-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const RECIPIENT = `${APP_URL}/ap/users/owner`;
const REMOTE = "https://remote.test/users/follower";
const LEDGER_ID = `${APP_URL}/ap/inbound/follow-one`;
const SOURCE_ID = "https://remote.test/activities/follow-one";

async function fixture(options: { private?: boolean; local?: boolean } = {}) {
  const { db, client } = await createTestDb();
  const follower = options.local ? `${APP_URL}/ap/users/local` : REMOTE;
  for (const apId of options.local ? [RECIPIENT, follower] : [RECIPIENT]) {
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: apId === RECIPIENT ? "owner" : "local",
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "FIXTURE-PUBLIC",
      privateKeyPem: "FIXTURE-PRIVATE",
      isPrivate: options.private && apId === RECIPIENT ? 1 : 0,
    });
  }
  const recipient = (await db
    .select()
    .from(actors)
    .where(eq(actors.apId, RECIPIENT))
    .get())!;
  const queued: unknown[] = [];
  const queue = {
    send: async (body: unknown) => {
      queued.push(body);
    },
    sendBatch: async (messages: { body: unknown }[]) => {
      queued.push(...messages.map((message) => message.body));
    },
  };
  const c = {
    get: (key: string) => (key === "db" ? db : null),
    env: {
      APP_URL,
      DB_INSTANCE: db,
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    },
  } as unknown as ActivityContext;
  const dispatch = (id = LEDGER_ID, sourceId = SOURCE_ID) =>
    handleFollow(
      c,
      { id, type: "Follow", actor: follower, object: RECIPIENT } as Activity,
      recipient,
      follower,
      APP_URL,
      sourceId,
    );
  const snapshot = async () => ({
    recipient: await db
      .select()
      .from(actors)
      .where(eq(actors.apId, RECIPIENT))
      .get(),
    edges: await db.select().from(follows),
    accepts: await db
      .select()
      .from(activities)
      .where(eq(activities.type, "Accept")),
    notifications: await db.select().from(inbox),
    resolutions: await db.select().from(deliveryResolutions),
  });
  const fail = async (
    table: "activities" | "inbox" | "delivery_resolutions",
  ) => {
    const when = table === "activities" ? "WHEN NEW.type = 'Accept'" : "";
    await db.run(
      sql.raw(`CREATE TRIGGER fail_follow_effect BEFORE INSERT ON ${table}
        ${when} BEGIN SELECT RAISE(ABORT, 'fixture effect unavailable'); END`),
    );
  };
  const recover = () => db.run(sql`DROP TRIGGER fail_follow_effect`);
  return { db, client, follower, dispatch, snapshot, fail, recover, queued };
}

for (const table of ["activities", "inbox", "delivery_resolutions"] as const) {
  test(`same Follow repairs a ${table} failure after its edge and count commit`, async () => {
    const f = await fixture();
    try {
      await f.fail(table);
      await expect(f.dispatch()).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining("fixture effect unavailable"),
        },
      });
      const partial = await f.snapshot();
      expect(partial.recipient?.followerCount).toBe(1);
      expect(partial.edges).toHaveLength(1);
      expect(partial.edges[0]).toMatchObject({
        activityApId: LEDGER_ID,
        status: "accepted",
      });
      expect(partial.accepts).toHaveLength(
        table === "delivery_resolutions" ? 1 : 0,
      );
      await f.recover();

      await f.dispatch();
      const repaired = await f.snapshot();
      expect(repaired.recipient?.followerCount).toBe(1);
      expect(repaired.edges).toEqual(partial.edges);
      expect(repaired.notifications).toHaveLength(1);
      expect(repaired.accepts).toHaveLength(1);
      expect(repaired.accepts[0]).toMatchObject({
        actorApId: RECIPIENT,
        objectApId: SOURCE_ID,
        direction: "outbound",
      });
      expect(JSON.parse(repaired.accepts[0].rawJson!).object).toBe(SOURCE_ID);
      expect(repaired.resolutions).toHaveLength(1);
      expect(repaired.resolutions[0]).toMatchObject({
        activityApId: repaired.accepts[0].apId,
        recipientActorApId: REMOTE,
      });
      if (partial.accepts.length)
        expect(repaired.accepts[0].apId).toBe(partial.accepts[0].apId);

      // A further retry reuses the same Accept/outbox, not another count or
      // notification. Keep the notification's read state as well.
      await f.db.update(inbox).set({ read: 1 });
      const read = await f.snapshot();
      await f.dispatch();
      expect(await f.snapshot()).toEqual(read);
    } finally {
      f.client.close();
    }
  });
}

test("an ordinary accepted remote Follow remains idempotent", async () => {
  const f = await fixture();
  try {
    await f.dispatch();
    const first = await f.snapshot();
    expect(first.recipient?.followerCount).toBe(1);
    expect(first.accepts).toHaveLength(1);
    expect(first.resolutions).toHaveLength(1);
    await f.dispatch();
    expect(await f.snapshot()).toEqual(first);
  } finally {
    f.client.close();
  }
});

test("a different Follow id cannot replace the retained relationship or its effects", async () => {
  const f = await fixture();
  try {
    await f.dispatch();
    const first = await f.snapshot();
    const queued = f.queued.length;
    await f.dispatch(`${APP_URL}/ap/inbound/follow-two`, `${SOURCE_ID}-two`);
    expect(await f.snapshot()).toEqual(first);
    expect(f.queued).toHaveLength(queued);
  } finally {
    f.client.close();
  }
});

test("a private pending Follow repairs its notification without granting acceptance", async () => {
  const f = await fixture({ private: true });
  try {
    await f.fail("inbox");
    await expect(f.dispatch()).rejects.toMatchObject({
      cause: { message: expect.stringContaining("fixture effect unavailable") },
    });
    await f.recover();
    await f.dispatch();
    const after = await f.snapshot();
    expect(after.recipient?.followerCount).toBe(0);
    expect(after.edges).toMatchObject([{ status: "pending" }]);
    expect(after.notifications).toHaveLength(1);
    expect(after.accepts).toHaveLength(0);
    expect(after.resolutions).toHaveLength(0);
    expect(f.queued).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("retained approval, rather than the recipient privacy setting, authorizes Accept recovery", async () => {
  const f = await fixture({ private: true });
  try {
    await f.dispatch();
    await acceptRetainedFollowDirection(
      f.db,
      f.follower,
      RECIPIENT,
      new Date().toISOString(),
    );
    await f.dispatch();
    const after = await f.snapshot();
    expect(after.recipient?.isPrivate).toBe(1);
    expect(after.recipient?.followerCount).toBe(1);
    expect(after.edges).toMatchObject([{ status: "accepted" }]);
    expect(after.accepts).toHaveLength(1);
    expect(after.resolutions).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("a local follower repairs its notification without outbound acceptance", async () => {
  const f = await fixture({ local: true });
  try {
    await f.fail("inbox");
    await expect(f.dispatch()).rejects.toMatchObject({
      cause: { message: expect.stringContaining("fixture effect unavailable") },
    });
    await f.recover();
    await f.dispatch();
    const after = await f.snapshot();
    expect(after.recipient?.followerCount).toBe(1);
    expect(after.notifications).toHaveLength(1);
    expect(after.accepts).toHaveLength(0);
    expect(after.resolutions).toHaveLength(0);
    expect(f.queued).toHaveLength(0);
  } finally {
    f.client.close();
  }
});

test("a newly blocked follower cannot use recovery to bypass moderation", async () => {
  const f = await fixture();
  try {
    await f.fail("activities");
    await expect(f.dispatch()).rejects.toMatchObject({
      cause: { message: expect.stringContaining("fixture effect unavailable") },
    });
    await f.recover();
    await f.db.insert(blocks).values({
      blockerApId: RECIPIENT,
      blockedApId: REMOTE,
    });
    const before = await f.snapshot();
    await f.dispatch();
    expect(await f.snapshot()).toEqual(before);
    expect(f.queued).toHaveLength(0);
  } finally {
    f.client.close();
  }
});
