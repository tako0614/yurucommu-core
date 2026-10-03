import { expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  accountDeletionObjectTargets,
  accountDeletionTargets,
  accountDeletions,
  activities,
  actors,
  actorWriteAssertions,
  deliveryQueue,
  follows,
  inbox,
  likes,
  objects,
  runBatch,
  sessions,
  storyVotes,
} from "../../../db/index.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import type { D1Statement } from "../../../db/d1-write.ts";
import { isAccountDeletionWriteConflict } from "../../lib/errors.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const A = `${APP_URL}/ap/users/integrity-a`;
const B = `${APP_URL}/ap/users/integrity-b`;
const C = `${APP_URL}/ap/users/integrity-c`;
const D = "https://remote.test/users/integrity-d";
const OBJECT_A = `${APP_URL}/ap/objects/integrity-a-object`;
const OBJECT_REMOTE = "https://remote.test/objects/integrity-remote-object";
const ACTIVITY_A = `${APP_URL}/ap/activities/integrity-a-activity`;

async function seedActors(db: Database, ids = [A, B, C]) {
  for (const [index, apId] of ids.entries()) {
    const username = apId.split("/").pop()!;
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: `public-key-${index}`,
      privateKeyPem: `private-key-${index}`,
      takosUserId: `local:${username}`,
      role: "member",
    });
  }
}

async function reserve(
  db: Database,
  id: string,
  rootActorApId: string,
  targetActorApId: string,
  objectApId?: string,
  leaseExpired = false,
) {
  await db.insert(accountDeletions).values({
    id,
    rootActorApId,
    rootPublicKeyPem: `public-key-${[A, B, C].indexOf(rootActorApId)}`,
    workerToken: `worker-${id}`,
    leaseExpiresAt: leaseExpired
      ? "2000-01-01T00:00:00.000Z"
      : new Date(Date.now() + 60_000).toISOString(),
  });
  await db.insert(accountDeletionTargets).values({
    actorApId: targetActorApId,
    operationId: id,
    publicKeyPem: `public-key-${[A, B, C].indexOf(targetActorApId)}`,
    followersUrl: `${targetActorApId}/followers`,
    deleteActivityApId: `${APP_URL}/ap/activities/delete-${id}`,
    cascadeComplete: false,
  });
  if (objectApId) {
    await db.insert(accountDeletionObjectTargets).values({
      objectApId,
      operationId: id,
    });
  }
}

function guardedForOperation(db: Database, operationId: string) {
  return createGuardedDatabase(db, () => {
    const markerId = `marker-${crypto.randomUUID()}`;
    const workerToken = `worker-${operationId}`;
    const now = new Date().toISOString();
    return {
      before: db.insert(actorWriteAssertions).values({
        id: markerId,
        witness: sql<number>`(
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM account_deletions AS operation
            JOIN actors AS root
              ON root.ap_id = operation.root_actor_ap_id
            WHERE operation.id = ${operationId}
              AND operation.worker_token = ${workerToken}
              AND operation.lease_expires_at > ${now}
              AND operation.root_public_key_pem = root.public_key_pem
          ) THEN 1 ELSE NULL END
        )`,
        operationId,
      }) as D1Statement,
      after: db
        .delete(actorWriteAssertions)
        .where(eq(actorWriteAssertions.id, markerId)) as D1Statement,
    };
  });
}

async function markerCount(db: Database): Promise<number> {
  return (
    await db.select({ id: actorWriteAssertions.id }).from(actorWriteAssertions)
  ).length;
}

async function expectDeletionConflict(pending: Promise<unknown>) {
  let error: unknown;
  try {
    await pending;
  } catch (caught) {
    error = caught;
  }
  expect(isAccountDeletionWriteConflict(error)).toBe(true);
}

test("a reservation marker for A can remove cross-owner edges and inbox items, but cannot authorize C", async () => {
  const { db } = await createTestDb();
  await seedActors(db);
  await db.insert(follows).values({
    followerApId: A,
    followingApId: B,
    status: "accepted",
    activityApId: null,
  });
  await db.insert(follows).values({
    followerApId: C,
    followingApId: D,
    status: "accepted",
    activityApId: null,
  });
  await db.insert(follows).values({
    followerApId: A,
    followingApId: D,
    status: "accepted",
    activityApId: null,
  });
  await db.insert(activities).values({
    apId: ACTIVITY_A,
    type: "Like",
    actorApId: A,
    objectApId: null,
    rawJson: "{}",
    direction: "inbound",
  });
  await db.insert(inbox).values({ actorApId: B, activityApId: ACTIVITY_A });
  await db.insert(activities).values({
    apId: `${APP_URL}/ap/activities/integrity-c-activity`,
    type: "Like",
    actorApId: C,
    objectApId: null,
    rawJson: "{}",
    direction: "inbound",
  });
  await db.insert(inbox).values({
    actorApId: D,
    activityApId: `${APP_URL}/ap/activities/integrity-c-activity`,
  });
  await reserve(db, "op-a", A, A);
  await reserve(db, "op-b", B, B);
  await reserve(db, "op-c", C, C);

  const guardedA = guardedForOperation(db, "op-a");
  await runBatch(guardedA, [
    guardedA
      .delete(follows)
      .where(and(eq(follows.followerApId, A), eq(follows.followingApId, B))),
    guardedA
      .delete(inbox)
      .where(and(eq(inbox.actorApId, B), eq(inbox.activityApId, ACTIVITY_A))),
  ] as [D1Statement, ...D1Statement[]]);
  expect(
    await db
      .select()
      .from(follows)
      .where(and(eq(follows.followerApId, A), eq(follows.followingApId, B))),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(inbox)
      .where(and(eq(inbox.actorApId, B), eq(inbox.activityApId, ACTIVITY_A))),
  ).toHaveLength(0);

  const guardedC = guardedForOperation(db, "op-a");
  await expectDeletionConflict(
    Promise.resolve(
      runBatch(guardedC, [
        guardedC
          .delete(follows)
          .where(
            and(eq(follows.followerApId, A), eq(follows.followingApId, D)),
          ),
        guardedC
          .delete(follows)
          .where(
            and(eq(follows.followerApId, C), eq(follows.followingApId, D)),
          ),
      ] as [D1Statement, ...D1Statement[]]),
    ),
  );
  expect(
    await db
      .select()
      .from(follows)
      .where(and(eq(follows.followerApId, A), eq(follows.followingApId, D))),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(follows)
      .where(and(eq(follows.followerApId, C), eq(follows.followingApId, D))),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(inbox)
      .where(
        eq(inbox.activityApId, `${APP_URL}/ap/activities/integrity-c-activity`),
      ),
  ).toHaveLength(1);
  expect(await markerCount(db)).toBe(0);
});

test("deleted authored object IDs stay fenced against late interactions while unrelated objects remain writable", async () => {
  const { db } = await createTestDb();
  await seedActors(db);
  await db.insert(objects).values({
    apId: OBJECT_A,
    type: "Story",
    attributedTo: A,
    content: "reserved story",
    published: new Date().toISOString(),
  });
  await db.insert(objects).values({
    apId: OBJECT_REMOTE,
    type: "Note",
    attributedTo: D,
    content: "unrelated remote object",
    published: new Date().toISOString(),
    isLocal: 0,
  });
  await reserve(db, "op-a-object", A, A, OBJECT_A);
  const guardedA = guardedForOperation(db, "op-a-object");
  await guardedA.delete(objects).where(eq(objects.apId, OBJECT_A));

  await expectDeletionConflict(
    Promise.resolve(
      db.insert(storyVotes).values({
        id: "late-vote-for-deleted-story",
        actorApId: B,
        storyApId: OBJECT_A,
        optionIndex: 0,
      }),
    ),
  );
  await db.insert(likes).values({ actorApId: B, objectApId: OBJECT_REMOTE });
  expect(
    await db
      .select({ actorApId: likes.actorApId })
      .from(likes)
      .where(eq(likes.objectApId, OBJECT_REMOTE)),
  ).toEqual([{ actorApId: B }]);
  expect(
    await db
      .select({ objectApId: accountDeletionObjectTargets.objectApId })
      .from(accountDeletionObjectTargets)
      .where(eq(accountDeletionObjectTargets.objectApId, OBJECT_A)),
  ).toHaveLength(1);
});

test("raw profile insertion for a reserved owner is blocked even after its worker lease expires", async () => {
  const { db } = await createTestDb();
  await seedActors(db);
  await reserve(db, "op-a-actor-insert", A, A, undefined, true);

  await expectDeletionConflict(
    Promise.resolve(
      db.insert(actors).values({
        apId: `${APP_URL}/ap/users/new-profile-under-a`,
        type: "Person",
        preferredUsername: "new-profile-under-a",
        inbox: "https://yuru.test/inbox",
        outbox: "https://yuru.test/outbox",
        followersUrl: "https://yuru.test/followers",
        followingUrl: "https://yuru.test/following",
        publicKeyPem: "profile-public-key",
        privateKeyPem: "profile-private-key",
        takosUserId: "local:new-profile-under-a",
        role: "member",
        ownerActorApId: A,
      }),
    ),
  );
  expect(
    await db
      .select({ apId: actors.apId })
      .from(actors)
      .where(eq(actors.preferredUsername, "new-profile-under-a")),
  ).toHaveLength(0);
});

test("reservation plans cannot be deleted before all target finalization and session cleanup", async () => {
  const { db } = await createTestDb();
  await seedActors(db, [A]);
  await db.insert(sessions).values({
    id: "session-a",
    memberId: A,
    accessToken: "session-a-token",
    expiresAt: "2099-01-01T00:00:00.000Z",
    provider: null,
  });
  await reserve(db, "op-a-premature-release", A, A, OBJECT_A);
  const planBefore = await db
    .select()
    .from(accountDeletionTargets)
    .where(eq(accountDeletionTargets.actorApId, A));

  const markerId = "marker-premature-release";
  await expectDeletionConflict(
    Promise.resolve(
      runBatch(db, [
        db.insert(actorWriteAssertions).values({
          id: markerId,
          witness: sql<number>`(
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM account_deletions AS operation
            JOIN actors AS root
              ON root.ap_id = operation.root_actor_ap_id
            WHERE operation.id = 'op-a-premature-release'
              AND operation.worker_token = 'worker-op-a-premature-release'
              AND operation.lease_expires_at > ${new Date().toISOString()}
              AND operation.root_public_key_pem = root.public_key_pem
          ) THEN 1 ELSE NULL END
        )`,
          operationId: "op-a-premature-release",
        }),
        db
          .delete(accountDeletionTargets)
          .where(eq(accountDeletionTargets.actorApId, A)),
        db
          .delete(accountDeletions)
          .where(eq(accountDeletions.id, "op-a-premature-release")),
        db
          .delete(actorWriteAssertions)
          .where(eq(actorWriteAssertions.id, markerId)),
      ] as [D1Statement, ...D1Statement[]]),
    ),
  );

  expect(
    await db
      .select({ id: accountDeletions.id })
      .from(accountDeletions)
      .where(eq(accountDeletions.id, "op-a-premature-release")),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(accountDeletionTargets)
      .where(eq(accountDeletionTargets.actorApId, A)),
  ).toEqual(planBefore);
  expect(
    await db
      .select({ objectApId: accountDeletionObjectTargets.objectApId })
      .from(accountDeletionObjectTargets)
      .where(eq(accountDeletionObjectTargets.objectApId, OBJECT_A)),
  ).toHaveLength(1);
  expect(
    await db
      .select({ memberId: sessions.memberId })
      .from(sessions)
      .where(eq(sessions.id, "session-a")),
  ).toEqual([{ memberId: A }]);
  expect(await markerCount(db)).toBe(0);
});
