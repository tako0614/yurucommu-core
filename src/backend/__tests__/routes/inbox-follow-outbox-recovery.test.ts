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
import { internalInboundActivityId } from "../../routes/activitypub/inbound-activity-identity.ts";
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
  let failNextWakeup = false;
  const queue = {
    send: async (body: unknown) => {
      queued.push(body);
    },
    sendBatch: async (messages: { body: unknown }[]) => {
      if (failNextWakeup) {
        failNextWakeup = false;
        throw new Error("fixture queue unavailable");
      }
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
  const dispatch = (
    id = LEDGER_ID,
    sourceId = SOURCE_ID,
    verifiedFollower = follower,
  ) =>
    handleFollow(
      c,
      {
        id,
        type: "Follow",
        actor: verifiedFollower,
        object: RECIPIENT,
      } as Activity,
      recipient,
      verifiedFollower,
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
  return {
    db,
    client,
    follower,
    dispatch,
    snapshot,
    fail,
    recover,
    queued,
    failWakeup: () => {
      failNextWakeup = true;
    },
  };
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
      // Response and recipient intent now commit together, including when the
      // resolution INSERT itself fails. No new orphan response may survive.
      expect(partial.accepts).toHaveLength(0);
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

test("a failed Queue wakeup reuses the exact atomically bound Accept and intent", async () => {
  const f = await fixture();
  try {
    f.failWakeup();
    await expect(f.dispatch()).rejects.toThrow("fixture queue unavailable");
    const partial = await f.snapshot();
    expect(partial.accepts).toHaveLength(1);
    expect(partial.resolutions).toHaveLength(1);
    expect(partial.resolutions[0]).toMatchObject({
      activityApId: partial.accepts[0].apId,
      recipientActorApId: REMOTE,
      status: "pending",
    });
    await f.dispatch();
    const after = await f.snapshot();
    expect(after.accepts).toEqual(partial.accepts);
    expect(after.edges).toEqual(partial.edges);
    expect(after.recipient?.followerCount).toBe(1);
    expect(after.resolutions).toHaveLength(1);
    expect(after.resolutions[0]).toMatchObject({
      id: partial.resolutions[0].id,
      activityApId: partial.accepts[0].apId,
      recipientActorApId: REMOTE,
      status: "queued",
    });
    expect(f.queued).toHaveLength(1);
  } finally {
    f.client.close();
  }
});

test("a completed recipient intent is not reopened or given a fresh retry budget", async () => {
  const f = await fixture();
  try {
    await f.dispatch();
    await f.db.update(deliveryResolutions).set({
      status: "resolved",
      attempts: 7,
      resolvedAt: "2026-01-01T00:00:00.000Z",
    });
    const before = await f.snapshot();
    const queued = f.queued.length;
    await f.dispatch();
    expect(await f.snapshot()).toEqual(before);
    expect(f.queued).toHaveLength(queued);
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

test("same-origin followers sharing a wire id retain separate Accept identities", async () => {
  const f = await fixture();
  try {
    const second = "https://remote.test/users/second";
    const firstId = await internalInboundActivityId(APP_URL, REMOTE, SOURCE_ID);
    const secondId = await internalInboundActivityId(
      APP_URL,
      second,
      SOURCE_ID,
    );
    expect(firstId).not.toBe(secondId);
    await f.dispatch(firstId, SOURCE_ID, REMOTE);
    await f.dispatch(secondId, SOURCE_ID, second);
    const after = await f.snapshot();
    expect(after.recipient?.followerCount).toBe(2);
    expect(after.edges).toHaveLength(2);
    expect(after.accepts).toHaveLength(2);
    expect(after.resolutions).toHaveLength(2);
    expect(new Set(after.resolutions.map((row) => row.activityApId)).size).toBe(
      2,
    );
    expect(
      after.resolutions.map((row) => row.recipientActorApId).sort(),
    ).toEqual([REMOTE, second].sort());
    await f.dispatch(secondId, SOURCE_ID, second);
    expect(await f.snapshot()).toEqual(after);
  } finally {
    f.client.close();
  }
});

test("an unattributable legacy Accept is preserved without binding it to a follower", async () => {
  const f = await fixture();
  try {
    const legacyId = `${APP_URL}/ap/activities/legacy-unattributed`;
    await f.db.insert(activities).values({
      apId: legacyId,
      type: "Accept",
      actorApId: RECIPIENT,
      objectApId: SOURCE_ID,
      rawJson: JSON.stringify({
        id: legacyId,
        type: "Accept",
        actor: RECIPIENT,
        object: SOURCE_ID,
      }),
      direction: "outbound",
    });
    const legacy = await f.db
      .select()
      .from(activities)
      .where(eq(activities.apId, legacyId))
      .get();
    await f.dispatch();
    const after = await f.snapshot();
    expect(after.accepts).toHaveLength(2);
    expect(after.resolutions).toHaveLength(1);
    expect(after.resolutions[0].activityApId).not.toBe(legacyId);
    expect(after.resolutions[0].recipientActorApId).toBe(REMOTE);
    expect(
      await f.db
        .select()
        .from(activities)
        .where(eq(activities.apId, legacyId))
        .get(),
    ).toEqual(legacy);
  } finally {
    f.client.close();
  }
});
