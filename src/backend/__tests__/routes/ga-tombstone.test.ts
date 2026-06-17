import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA Wave-8 ACTORS — account-deletion tombstone correctness.
 *
 * Covers the Round-3 regressions on POST /me/delete + the tombstone reaper:
 *
 *  - #1: the tombstone must FREE the original `preferredUsername` (UNIQUE) by
 *    renaming it to a `deleted-*` sentinel, so the handle can be re-registered.
 *  - #12: a tombstoned local actor must NOT be served by GET /:identifier
 *    (notDeleted filter).
 *  - #7: teardown must not orphan the actor's story_votes / story_views on
 *    OTHER (remote) stories, nor its community_join_requests /
 *    community_invites rows.
 *  - #6/#8: reapDrainedTombstones must keep a tombstone whose Delete still has
 *    a pending delivery job, and hard-delete it once those jobs have drained
 *    and `deletedAt` is older than the retry horizon.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  communityInvites,
  communityJoinRequests,
  deliveryQueue,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoutes, { reapDrainedTombstones } from "../../routes/actors.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name: `Display ${username}`,
    summary: "bio",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "PUBLIC-KEY",
    privateKeyPem: "PRIVATE-KEY",
    takosUserId: `takos-${username}`,
  });
  return apId;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: `Display ${username}`,
    summary: "bio",
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "PUBLIC-KEY",
    private_key_pem: "PRIVATE-KEY",
    takos_user_id: `takos-${username}`,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "member",
    created_at: new Date().toISOString(),
  } as unknown as Actor;
}

function captureQueue() {
  const sent: unknown[] = [];
  return {
    queue: {
      async send(msg: unknown) {
        sent.push(msg);
      },
      async sendBatch(batch: Array<{ body: unknown }>) {
        for (const m of batch) sent.push(m.body);
      },
    },
    sent,
  };
}

function envFor(
  db: Database,
  queue: ReturnType<typeof captureQueue>["queue"],
): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
}

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", actorsRoutes);
  return app;
}

test("tombstone frees the username, hides the actor, and leaves no orphan rows", async () => {
  const db = await freshDb();
  const { queue } = captureQueue();
  const env = envFor(db, queue);

  const aliceApId = await insertLocalActor(db, "alice");

  // Story interactions BY alice on a REMOTE actor's story (the objectIds-scoped
  // teardown only reaps interactions on alice's OWN stories, so these must be
  // reaped by the explicit actorApId deletes).
  // Another actor authors the story; alice merely interacts with it. (The FK
  // on objects.attributed_to requires the author row to exist.)
  const carolApId = await insertLocalActor(db, "carol");
  const remoteStory = "https://remote.test/ap/objects/story-1";
  await db.insert(schema.objects).values({
    apId: remoteStory,
    type: "Story",
    attributedTo: carolApId,
    content: "remote story",
    visibility: "public",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 0,
  });
  await db.insert(storyViews).values({
    actorApId: aliceApId,
    storyApId: remoteStory,
  });
  await db.insert(storyVotes).values({
    id: "vote-1",
    storyApId: remoteStory,
    actorApId: aliceApId,
    optionIndex: 0,
  });

  // Community lifecycle rows referencing alice.
  const adminApId = await insertLocalActor(db, "admin");
  const community = "https://yuru.test/ap/communities/c1";
  await db.insert(schema.communities).values({
    apId: community,
    type: "Group",
    preferredUsername: "c1",
    name: "C1",
    inbox: `${community}/inbox`,
    outbox: `${community}/outbox`,
    followersUrl: `${community}/followers`,
    publicKeyPem: "PUB",
    privateKeyPem: "PRIV",
    createdBy: adminApId,
  });
  await db.insert(communityJoinRequests).values({
    communityApId: community,
    actorApId: aliceApId,
    status: "pending",
  });
  await db.insert(communityInvites).values({
    id: "inv-1",
    communityApId: community,
    invitedByApId: aliceApId,
  });
  await db.insert(communityInvites).values({
    id: "inv-2",
    communityApId: community,
    invitedByApId: adminApId,
    usedByApId: aliceApId,
  });

  const app = appWith(db, fakeActor(aliceApId, "alice"));
  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    env,
  );
  expect(res.status).toBe(200);

  // --- #1: original handle freed (renamed to a deleted-* sentinel) ---
  const tombstone = await db
    .select({ preferredUsername: actors.preferredUsername })
    .from(actors)
    .where(eq(actors.apId, aliceApId))
    .get();
  expect(tombstone).toBeTruthy();
  expect(tombstone?.preferredUsername).not.toBe("alice");
  expect(tombstone?.preferredUsername?.startsWith("deleted-")).toBe(true);

  // The original handle is now re-registrable (UNIQUE constraint satisfied).
  await db.insert(actors).values({
    apId: localApId("alice-2"),
    type: "Person",
    preferredUsername: "alice", // would throw if the tombstone still squatted it
    inbox: `${localApId("alice-2")}/inbox`,
    outbox: `${localApId("alice-2")}/outbox`,
    followersUrl: `${localApId("alice-2")}/followers`,
    followingUrl: `${localApId("alice-2")}/following`,
    publicKeyPem: "PUB2",
    privateKeyPem: "PRIV2",
  });

  // --- #12: GET /:identifier no longer serves the tombstoned actor ---
  const profileRes = await app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(aliceApId)}`),
    env,
  );
  expect(profileRes.status).toBe(404);

  // --- #7: no orphan story_votes / story_views / community rows for alice ---
  const orphanViews = await db
    .select()
    .from(storyViews)
    .where(eq(storyViews.actorApId, aliceApId));
  expect(orphanViews.length).toBe(0);

  const orphanVotes = await db
    .select()
    .from(storyVotes)
    .where(eq(storyVotes.actorApId, aliceApId));
  expect(orphanVotes.length).toBe(0);

  const orphanRequests = await db
    .select()
    .from(communityJoinRequests)
    .where(eq(communityJoinRequests.actorApId, aliceApId));
  expect(orphanRequests.length).toBe(0);

  const orphanInvitesByAlice = await db
    .select()
    .from(communityInvites)
    .where(eq(communityInvites.invitedByApId, aliceApId));
  expect(orphanInvitesByAlice.length).toBe(0);

  const orphanInvitesUsedByAlice = await db
    .select()
    .from(communityInvites)
    .where(eq(communityInvites.usedByApId, aliceApId));
  expect(orphanInvitesUsedByAlice.length).toBe(0);
});

test("reapDrainedTombstones keeps live tombstones and reaps drained ones", async () => {
  const db = await freshDb();
  const apId = await insertLocalActor(db, "ghost");

  // Make this a tombstone whose deletedAt is well past the reap horizon.
  const oldIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  await db
    .update(actors)
    .set({ preferredUsername: "deleted-ghost", deletedAt: oldIso })
    .where(eq(actors.apId, apId));

  // The preserved Delete activity for this actor.
  const deleteActivityId = `${APP_URL}/ap/activities/del-ghost`;
  await db.insert(activities).values({
    apId: deleteActivityId,
    type: "Delete",
    actorApId: apId,
    objectApId: apId,
    rawJson: "{}",
    direction: "outbound",
  });

  // A still-pending delivery job for the Delete: must BLOCK reaping (the signer
  // may still need the key).
  await db.insert(deliveryQueue).values({
    id: "job-pending",
    activityApId: deleteActivityId,
    inboxUrl: "https://remote.test/inbox",
    status: "pending",
  });

  const keptCount = await reapDrainedTombstones(db);
  expect(keptCount).toBe(0);
  const stillHere = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  expect(stillHere).toBeTruthy();

  // Drain the job (terminal status) → now the tombstone is reapable.
  await db
    .update(deliveryQueue)
    .set({ status: "delivered" })
    .where(eq(deliveryQueue.id, "job-pending"));

  const reaped = await reapDrainedTombstones(db);
  expect(reaped).toBe(1);

  const gone = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  expect(gone).toBeUndefined();

  // The preserved Delete activity + its terminal delivery rows are reaped too.
  const activityGone = await db
    .select()
    .from(activities)
    .where(eq(activities.apId, deleteActivityId));
  expect(activityGone.length).toBe(0);

  const jobGone = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.activityApId, deleteActivityId));
  expect(jobGone.length).toBe(0);
});

test("reapDrainedTombstones does not touch recent tombstones", async () => {
  const db = await freshDb();
  const apId = await insertLocalActor(db, "fresh");
  await db
    .update(actors)
    .set({
      preferredUsername: "deleted-fresh",
      deletedAt: new Date().toISOString(),
    })
    .where(eq(actors.apId, apId));

  const reaped = await reapDrainedTombstones(db);
  expect(reaped).toBe(0);

  const stillHere = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(and(eq(actors.apId, apId)))
    .get();
  expect(stillHere).toBeTruthy();
});
