import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, blocks, follows } from "../../../db/index.ts";
import {
  handleFollow,
  handleReject,
} from "../../routes/activitypub/handlers/inbox-follow-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

// ---------------------------------------------------------------------------
// GA-fix Wave-11 cluster FOLLOW-COUNT
//   [R6 #2] An inbound auto-accepted (non-private) Follow previously inserted the
//   follows edge (onConflictDoNothing) then bumped recipient.followerCount in a
//   SEPARATE statement gated on `isNewFollow`. Under the claim/processed
//   re-dispatch model, a crash between the insert and the +1, then a peer retry
//   (whose no-op insert sets isNewFollow=false → early return), permanently
//   SKIPPED the increment → a follower UNDER-count.
//
//   Fix: the followers-edge insert + the followerCount +1 now commit in one
//   atomic `db.batch`, with the increment guarded by a correlated `NOT EXISTS`
//   subquery so it fires only when THIS batch creates the edge. A private
//   recipient stays pending with no count change.
//
//   These tests run the REAL handler against a real in-memory libsql DB (which
//   exposes the same atomic `db.batch` surface as D1). The follower is a LOCAL
//   actor so the auto-Accept outbound-delivery path (which needs a queue env) is
//   skipped — the counter maintenance is identical regardless of follower
//   locality.
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const LOCAL_FOLLOWER = `${APP_URL}/ap/users/alice`;
const RECIPIENT = `${APP_URL}/ap/users/bob`;
const PRIVATE_RECIPIENT = `${APP_URL}/ap/users/eve`;
const FOLLOW_ACTIVITY = "https://yuru.test/ap/activities/follow-1";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  // Mirror D1, which does NOT enforce foreign keys by default. A Follow
  // activity's object_ap_id is an actor AP id (not an `objects` row), so the
  // activities-table FK to `objects(ap_id)` would otherwise fail in libsql even
  // though production (D1) accepts it.
  await client.execute("PRAGMA foreign_keys = OFF;");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    const migration = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(migration);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedActor(
  db: Database,
  apId: string,
  username: string,
  isPrivate = 0,
): Promise<void> {
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    isPrivate,
    followerCount: 0,
    followingCount: 0,
  });
}

async function setup(): Promise<Database> {
  const db = await freshDb();
  await seedActor(db, LOCAL_FOLLOWER, "alice");
  await seedActor(db, RECIPIENT, "bob");
  await seedActor(db, PRIVATE_RECIPIENT, "eve", 1);
  return db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: {},
  } as unknown as ActivityContext;
}

function recipientRow(apId: string, isPrivate: boolean) {
  return { apId, isPrivate } as unknown as Parameters<typeof handleFollow>[2];
}

const followActivity = (id: string, actor: string, target: string): Activity =>
  ({
    id,
    type: "Follow",
    actor,
    object: target,
  }) as unknown as Activity;

async function followerCount(db: Database, apId: string): Promise<number> {
  const row = await db
    .select({ followerCount: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  return row?.followerCount ?? -1;
}

async function edgeCount(db: Database, target: string): Promise<number> {
  const rows = await db
    .select({ f: follows.followerApId })
    .from(follows)
    .where(eq(follows.followingApId, target));
  return rows.length;
}

// Audit #15 finding #2 (HIGH): an inbound Follow from an actor the recipient has
// LOCALLY blocked must be dropped — no edge, no count, no Accept/notify. Pre-fix
// handleFollow ignored the per-user `blocks` table entirely, so a blocked actor
// could (re)establish a follow edge and resume receiving the recipient's
// followers-only content.
test("[audit#15 #2] an inbound Follow from a blocked actor is dropped (no edge, no count)", async () => {
  const db = await setup();
  // bob (recipient) has blocked alice (the incoming follower).
  await db
    .insert(blocks)
    .values({ blockerApId: RECIPIENT, blockedApId: LOCAL_FOLLOWER });

  await handleFollow(
    ctxFor(db),
    followActivity(FOLLOW_ACTIVITY, LOCAL_FOLLOWER, RECIPIENT),
    recipientRow(RECIPIENT, false),
    LOCAL_FOLLOWER,
    APP_URL,
  );

  // No edge created, recipient's follower count unchanged.
  expect(await edgeCount(db, RECIPIENT)).toBe(0);
  expect(await followerCount(db, RECIPIENT)).toBe(0);
});

test("[R6 #2] auto-accepted Follow applies the edge + followerCount atomically, once", async () => {
  const db = await setup();
  await handleFollow(
    ctxFor(db),
    followActivity(FOLLOW_ACTIVITY, LOCAL_FOLLOWER, RECIPIENT),
    recipientRow(RECIPIENT, false),
    LOCAL_FOLLOWER,
    APP_URL,
  );

  expect(await edgeCount(db, RECIPIENT)).toBe(1);
  expect(await followerCount(db, RECIPIENT)).toBe(1);
});

test("[R6 #2] a crash-then-retry of an auto-accepted Follow CONVERGES to followerCount == 1 (not 0, not 2)", async () => {
  const db = await setup();

  // The fix makes the edge insert and the +1 ATOMIC (one db.batch). So the
  // hazard the spec describes — a crash BETWEEN the insert and the +1 — can no
  // longer leave a half-applied state: the batch either commits both or neither.
  // The realistic crash is therefore that the FIRST dispatch committed NOTHING
  // (atomic rollback): no edge, followerCount still 0. Pre-fix the two writes
  // were separate, so a crash could leave the edge present with the count un-
  // bumped, and the peer's retry (no-op insert → isNewFollow=false → early
  // return) SKIPPED the increment forever (stuck at 0).
  expect(await edgeCount(db, RECIPIENT)).toBe(0);
  expect(await followerCount(db, RECIPIENT)).toBe(0); // nothing committed yet

  // Peer retry re-dispatches the same Follow. The atomic batch now applies the
  // edge AND the increment together → converges to exactly 1.
  await handleFollow(
    ctxFor(db),
    followActivity(FOLLOW_ACTIVITY, LOCAL_FOLLOWER, RECIPIENT),
    recipientRow(RECIPIENT, false),
    LOCAL_FOLLOWER,
    APP_URL,
  );

  expect(await edgeCount(db, RECIPIENT)).toBe(1);
  expect(await followerCount(db, RECIPIENT)).toBe(1); // not 0 (skipped), not 2 (double)
});

test("[R6 #2] fresh dispatch then retry: followerCount converges to exactly 1", async () => {
  const db = await setup();
  const act = followActivity(FOLLOW_ACTIVITY, LOCAL_FOLLOWER, RECIPIENT);

  // Fresh delivery: edge + count commit atomically (count == 1).
  await handleFollow(
    ctxFor(db),
    act,
    recipientRow(RECIPIENT, false),
    LOCAL_FOLLOWER,
    APP_URL,
  );
  expect(await followerCount(db, RECIPIENT)).toBe(1);

  // Peer retry (re-dispatch of the SAME activity from the SAME actor): the
  // NOT-EXISTS guard is now false, so the increment cannot fire again.
  await handleFollow(
    ctxFor(db),
    act,
    recipientRow(RECIPIENT, false),
    LOCAL_FOLLOWER,
    APP_URL,
  );
  await handleFollow(
    ctxFor(db),
    act,
    recipientRow(RECIPIENT, false),
    LOCAL_FOLLOWER,
    APP_URL,
  );

  expect(await edgeCount(db, RECIPIENT)).toBe(1);
  expect(await followerCount(db, RECIPIENT)).toBe(1); // never inflated
});

test("[R6 #2] a private recipient stays pending with NO followerCount change", async () => {
  const db = await setup();
  await handleFollow(
    ctxFor(db),
    followActivity(
      "https://yuru.test/ap/activities/follow-private",
      LOCAL_FOLLOWER,
      PRIVATE_RECIPIENT,
    ),
    recipientRow(PRIVATE_RECIPIENT, true),
    LOCAL_FOLLOWER,
    APP_URL,
  );

  const edge = await db
    .select({ status: follows.status })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, LOCAL_FOLLOWER),
        eq(follows.followingApId, PRIVATE_RECIPIENT),
      ),
    )
    .get();
  expect(edge?.status).toBe("pending");
  expect(await followerCount(db, PRIVATE_RECIPIENT)).toBe(0); // pending: never counted
});

// Audit #18: a remote followee can Reject an ALREADY-ACCEPTED follow to terminate
// it (Mastodon does this on lock + remove-follower). handleReject must decrement
// the local follower's followingCount that handleAccept incremented — otherwise
// it stays permanently +1 over.
test("[audit#18] inbound Reject of an ACCEPTED follow decrements the local follower's followingCount", async () => {
  const db = await setup();
  const REMOTE_FOLLOWEE = "https://remote.example/users/rejector";
  await seedActor(db, REMOTE_FOLLOWEE, "rejector");
  const followActId = "https://yuru.test/ap/activities/follow-r1";
  await db.insert(follows).values({
    followerApId: LOCAL_FOLLOWER,
    followingApId: REMOTE_FOLLOWEE,
    status: "accepted",
    activityApId: followActId,
    acceptedAt: new Date().toISOString(),
  });
  await db
    .update(actors)
    .set({ followingCount: 1 })
    .where(eq(actors.apId, LOCAL_FOLLOWER));

  await handleReject(
    ctxFor(db),
    {
      id: "https://remote.example/activities/reject-1",
      type: "Reject",
      actor: REMOTE_FOLLOWEE,
      object: followActId,
    } as unknown as Activity,
    REMOTE_FOLLOWEE,
  );

  // The edge is deleted AND followingCount is reconciled back to 0.
  expect(
    (
      await db
        .select()
        .from(follows)
        .where(eq(follows.followerApId, LOCAL_FOLLOWER))
    ).length,
  ).toBe(0);
  const alice = await db
    .select({ fc: actors.followingCount })
    .from(actors)
    .where(eq(actors.apId, LOCAL_FOLLOWER))
    .get();
  expect(alice?.fc).toBe(0);
});

test("[audit#18] inbound Reject of a PENDING follow does NOT decrement (never counted)", async () => {
  const db = await setup();
  const REMOTE_FOLLOWEE = "https://remote.example/users/rejector2";
  await seedActor(db, REMOTE_FOLLOWEE, "rejector2");
  const followActId = "https://yuru.test/ap/activities/follow-r2";
  await db.insert(follows).values({
    followerApId: LOCAL_FOLLOWER,
    followingApId: REMOTE_FOLLOWEE,
    status: "pending",
    activityApId: followActId,
  });
  // A sentinel followingCount of 1 (from some OTHER accepted follow) must be
  // untouched: a pending edge was never counted, so rejecting it decrements nothing.
  await db
    .update(actors)
    .set({ followingCount: 1 })
    .where(eq(actors.apId, LOCAL_FOLLOWER));

  await handleReject(
    ctxFor(db),
    {
      id: "https://remote.example/activities/reject-2",
      type: "Reject",
      actor: REMOTE_FOLLOWEE,
      object: followActId,
    } as unknown as Activity,
    REMOTE_FOLLOWEE,
  );

  expect(
    (
      await db
        .select()
        .from(follows)
        .where(eq(follows.followerApId, LOCAL_FOLLOWER))
    ).length,
  ).toBe(0); // edge still deleted
  const alice = await db
    .select({ fc: actors.followingCount })
    .from(actors)
    .where(eq(actors.apId, LOCAL_FOLLOWER))
    .get();
  expect(alice?.fc).toBe(1); // sentinel untouched (pending was never counted)
});
