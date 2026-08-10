import { expect, test } from "bun:test";

/**
 * GA #21 — object delete cascade completeness.
 *
 * (a) `deleteObjectCascade` previously reaped likes/announces/bookmarks/
 *     object_recipients/story_* but left the object-attached `media_uploads`
 *     rows orphaned (that edge has no engine-level FK to `objects`; the link is
 *     the upload's `r2_key` embedded in the object's `attachments_json`, owned
 *     by the object's author). It now also deletes those upload rows.
 *
 * (b) `cleanupExpiredStories` hand-rolled a partial child-delete list missing
 *     announces / bookmarks (and media). It now routes every expired story id
 *     through the shared `deleteObjectCascade`, so expiry reaps the full set.
 *
 * These tests assert ZERO orphan child rows (including media_uploads) survive a
 * delete, against a real libsql DB with the migrations' FK edges enabled.
 */

import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  announces,
  bookmarks,
  deliveryQueue,
  deliveryFanouts,
  deliveryResolutions,
  inboundActivityClaims,
  inbox as inboxTable,
  likes,
  mediaUploads,
  notificationArchived,
  notificationPushJobs,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import { deleteObjectCascade } from "../../routes/posts/delete-cascade.ts";
import { deleteActivitiesCascade } from "../../lib/activity-delete-cascade.ts";
import { cleanupExpiredStories } from "../../routes/stories/query-helpers.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function insertActor(db: Database, username: string): Promise<string> {
  const apId = `${APP_URL}/ap/users/${username}`;
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
  });
  return apId;
}

/**
 * Seed an object that embeds a media upload in its `attachments_json` (the same
 * URL/r2_key link the media auth path uses), plus the matching media_uploads
 * row owned by the author, plus one row in every CASCADE-keyed child table.
 */
async function seedWithMediaAndChildren(
  db: Database,
  objectApId: string,
  authorApId: string,
  interactorApId: string,
  r2Key: string,
  type = "Note",
): Promise<void> {
  const attachmentsJson = JSON.stringify([
    {
      type: "Document",
      mediaType: "image/jpeg",
      url: `/media/${r2Key.replace(/^uploads\//, "")}`,
      r2_key: r2Key,
    },
  ]);
  await db.insert(objects).values({
    apId: objectApId,
    type,
    attributedTo: authorApId,
    content: "hi",
    attachmentsJson,
    published: new Date().toISOString(),
    isLocal: type === "Story" ? 0 : 1,
    // Stories are reaped by end_time; set it in the past for the cleanup test.
    endTime: type === "Story" ? "1970-01-01T00:00:00.000Z" : null,
  });
  await db.insert(mediaUploads).values({
    id: `media-${r2Key}`,
    r2Key,
    uploaderApId: authorApId,
    contentType: "image/jpeg",
    size: 123,
  });
  await db.insert(likes).values({ actorApId: interactorApId, objectApId });
  await db.insert(announces).values({ actorApId: interactorApId, objectApId });
  await db.insert(bookmarks).values({ actorApId: interactorApId, objectApId });
  await db.insert(objectRecipients).values({
    objectApId,
    recipientApId: interactorApId,
    type: "to",
  });
  await db
    .insert(storyViews)
    .values({ actorApId: interactorApId, storyApId: objectApId });
  await db.insert(storyVotes).values({
    id: `vote-${objectApId}`,
    storyApId: objectApId,
    actorApId: interactorApId,
    optionIndex: 0,
  });
  await db.insert(storyShares).values({
    id: `share-${objectApId}`,
    storyApId: objectApId,
    actorApId: interactorApId,
  });
}

async function countAllChildRows(
  db: Database,
  objectApId: string,
  r2Key: string,
): Promise<number> {
  const [l, a, b, r, sv, vo, sh, m] = await Promise.all([
    db.select().from(likes).where(eq(likes.objectApId, objectApId)),
    db.select().from(announces).where(eq(announces.objectApId, objectApId)),
    db.select().from(bookmarks).where(eq(bookmarks.objectApId, objectApId)),
    db
      .select()
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, objectApId)),
    db.select().from(storyViews).where(eq(storyViews.storyApId, objectApId)),
    db.select().from(storyVotes).where(eq(storyVotes.storyApId, objectApId)),
    db.select().from(storyShares).where(eq(storyShares.storyApId, objectApId)),
    db.select().from(mediaUploads).where(eq(mediaUploads.r2Key, r2Key)),
  ]);
  return (
    l.length +
    a.length +
    b.length +
    r.length +
    sv.length +
    vo.length +
    sh.length +
    m.length
  );
}

test("deleteObjectCascade reaps the object-attached media_uploads row (no orphan)", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/with-media`;
  const survivor = `${APP_URL}/ap/objects/survivor`;
  const targetKey = "uploads/target.jpg";
  const survivorKey = "uploads/survivor.jpg";

  await seedWithMediaAndChildren(db, target, author, other, targetKey);
  await seedWithMediaAndChildren(db, survivor, author, other, survivorKey);

  // 7 cascade-keyed rows + 1 media_uploads row = 8 each.
  expect(await countAllChildRows(db, target, targetKey)).toBe(8);
  expect(await countAllChildRows(db, survivor, survivorKey)).toBe(8);

  await deleteObjectCascade(db, target);
  await db.delete(objects).where(eq(objects.apId, target));

  // Target fully reaped, including its media_uploads row.
  expect(await countAllChildRows(db, target, targetKey)).toBe(0);
  // Unrelated object's media + children untouched.
  expect(await countAllChildRows(db, survivor, survivorKey)).toBe(8);
});

test("deleteObjectCascade cancels every durable projection of retained object activities", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "projection-author");
  const recipient = await insertActor(db, "projection-recipient");
  const targetObject = `${APP_URL}/ap/objects/projection-target`;
  const survivorObject = `${APP_URL}/ap/objects/projection-survivor`;
  const targetActivity = `${APP_URL}/ap/activities/projection-target`;
  const survivorActivity = `${APP_URL}/ap/activities/projection-survivor`;

  for (const objectApId of [targetObject, survivorObject]) {
    await db.insert(objects).values({
      apId: objectApId,
      type: "Note",
      attributedTo: author,
      content: "projected",
      visibility: "public",
    });
  }
  for (const [activityApId, objectApId, suffix] of [
    [targetActivity, targetObject, "target"],
    [survivorActivity, survivorObject, "survivor"],
  ] as const) {
    await db.insert(activities).values({
      apId: activityApId,
      type: "Create",
      actorApId: author,
      objectApId,
      rawJson: "{}",
      direction: "outbound",
    });
    await db.insert(deliveryQueue).values({
      id: `projection-delivery-${suffix}`,
      activityApId,
      inboxUrl: "https://remote.example/inbox",
      status: "processing",
    });
    await db.insert(deliveryResolutions).values({
      id: `projection-resolution-${suffix}`,
      activityApId,
      recipientActorApId: "https://remote.example/users/bob",
      status: "processing",
      processingToken: `projection-resolution-token-${suffix}`,
    });
    await db.insert(deliveryFanouts).values({
      id: `projection-fanout-${suffix}`,
      activityApId,
      kind: "followers",
      targetApId: author,
      status: "published",
    });
    await db.insert(inboxTable).values({ actorApId: recipient, activityApId });
    await db
      .update(notificationPushJobs)
      .set({
        status: "processing",
        processingToken: `projection-push-${suffix}`,
      })
      .where(eq(notificationPushJobs.activityApId, activityApId));
    await db.insert(notificationArchived).values({
      actorApId: recipient,
      activityApId,
    });
    await db.insert(inboundActivityClaims).values({
      activityApId,
      processingToken: `projection-claim-${suffix}`,
    });
  }

  await deleteObjectCascade(db, targetObject);

  // The ledger Activity stays available for history/Undo, but no notification
  // or delivery worker may continue projecting the deleted object.
  expect(
    (await db.select({ apId: activities.apId }).from(activities))
      .map((row) => row.apId)
      .sort(),
  ).toEqual([survivorActivity, targetActivity].sort());
  for (const ids of [
    (await db.select().from(deliveryQueue)).map((row) => row.activityApId),
    (await db.select().from(deliveryResolutions)).map(
      (row) => row.activityApId,
    ),
    (await db.select().from(deliveryFanouts)).map((row) => row.activityApId),
    (await db.select().from(inboxTable)).map((row) => row.activityApId),
    (await db.select().from(notificationArchived)).map(
      (row) => row.activityApId,
    ),
    (await db.select().from(notificationPushJobs)).map(
      (row) => row.activityApId,
    ),
    (await db.select().from(inboundActivityClaims)).map(
      (row) => row.activityApId,
    ),
  ]) {
    expect(ids).toEqual([survivorActivity]);
  }
});

test("activity cascade removes a community fanout keyed by its Announce activity", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "announce-author");
  const createId = `${APP_URL}/ap/activities/create-for-announce`;
  const announceId = `${APP_URL}/ap/activities/group-announce`;
  const survivorAnnounceId = `${APP_URL}/ap/activities/survivor-announce`;

  for (const [apId, type, actorApId] of [
    [createId, "Create", author],
    [announceId, "Announce", `${APP_URL}/ap/groups/retired`],
    [survivorAnnounceId, "Announce", `${APP_URL}/ap/groups/live`],
  ] as const) {
    await db.insert(activities).values({
      apId,
      type,
      actorApId,
      rawJson: "{}",
      direction: "outbound",
    });
  }
  await db.insert(deliveryFanouts).values([
    {
      id: "fanout-by-retired-announce",
      activityApId: createId,
      announceActivityApId: announceId,
      kind: "community",
      targetApId: `${APP_URL}/ap/groups/retired`,
      status: "published",
    },
    {
      id: "fanout-by-live-announce",
      activityApId: createId,
      announceActivityApId: survivorAnnounceId,
      kind: "community",
      targetApId: `${APP_URL}/ap/groups/live`,
      status: "published",
    },
  ]);

  await deleteActivitiesCascade(db, eq(activities.apId, announceId));

  expect(
    (await db.select({ id: deliveryFanouts.id }).from(deliveryFanouts)).map(
      (row) => row.id,
    ),
  ).toEqual(["fanout-by-live-announce"]);
  expect(
    await db
      .select({ apId: activities.apId })
      .from(activities)
      .where(eq(activities.apId, announceId))
      .get(),
  ).toBeUndefined();
});

test("deleteObjectCascade does not reap another author's media that shares no attachment", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/mine`;
  await seedWithMediaAndChildren(db, target, author, other, "uploads/mine.jpg");

  // Unrelated upload owned by a different actor, not referenced by this object.
  await db.insert(mediaUploads).values({
    id: "media-unrelated",
    r2Key: "uploads/unrelated.jpg",
    uploaderApId: other,
    contentType: "image/jpeg",
    size: 9,
  });

  await deleteObjectCascade(db, target);
  await db.delete(objects).where(eq(objects.apId, target));

  const survivingUpload = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, "uploads/unrelated.jpg"))
    .get();
  expect(survivingUpload?.r2Key).toBe("uploads/unrelated.jpg");
});

test("cleanupExpiredStories reaps the FULL child set (announces, bookmarks, media) per expired story", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const story = `${APP_URL}/ap/objects/expired-story`;
  const storyKey = "uploads/story.jpg";
  await seedWithMediaAndChildren(db, story, author, other, storyKey, "Story");

  expect(await countAllChildRows(db, story, storyKey)).toBe(8);

  const removed = await cleanupExpiredStories(db);
  expect(removed).toBe(1);

  // Object row gone.
  const obj = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, story))
    .get();
  expect(obj).toBeUndefined();

  // Every child row reaped — including announces/bookmarks/media the old
  // partial cleanup list missed.
  expect(await countAllChildRows(db, story, storyKey)).toBe(0);
});

test("cleanupExpiredStories decrements each author's postCount by their expired count (mirrors create +1)", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "storyauthor");
  const other = await insertActor(db, "storyother");
  // Creation had bumped postCount: author 3, other 1.
  await db.update(actors).set({ postCount: 3 }).where(eq(actors.apId, author));
  await db.update(actors).set({ postCount: 1 }).where(eq(actors.apId, other));

  const past = "1970-01-01T00:00:00.000Z";
  const mkStory = (id: string, who: string) =>
    db.insert(objects).values({
      apId: `${APP_URL}/ap/objects/${id}`,
      type: "Story",
      attributedTo: who,
      content: "s",
      published: new Date().toISOString(),
      endTime: past,
    });
  await mkStory("exp-a1", author);
  await mkStory("exp-a2", author);
  await mkStory("exp-a3", author);
  await mkStory("exp-o1", other);

  await cleanupExpiredStories(db);

  const a = await db
    .select({ postCount: actors.postCount })
    .from(actors)
    .where(eq(actors.apId, author))
    .get();
  const o = await db
    .select({ postCount: actors.postCount })
    .from(actors)
    .where(eq(actors.apId, other))
    .get();
  expect(a?.postCount).toBe(0); // 3 - 3
  expect(o?.postCount).toBe(0); // 1 - 1
});

test("cleanupExpiredStories postCount decrement never underflows below 0", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "zerocount"); // postCount defaults to 0
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/exp-u1`,
    type: "Story",
    attributedTo: author,
    content: "s",
    published: new Date().toISOString(),
    endTime: "1970-01-01T00:00:00.000Z",
  });

  await cleanupExpiredStories(db);

  const a = await db
    .select({ postCount: actors.postCount })
    .from(actors)
    .where(eq(actors.apId, author))
    .get();
  expect(a?.postCount).toBe(0); // MAX(0, 0 - 1) = 0, not -1
});

test("deleteObjectCascade reaps the notification inbox rows that pointed at the deleted object", async () => {
  const db = await freshDb();
  const alice = await insertActor(db, "alice");
  const bob = await insertActor(db, "bob");
  const postApId = `${APP_URL}/ap/objects/p-notif`;
  await db.insert(objects).values({
    apId: postApId,
    type: "Note",
    attributedTo: alice,
    content: "hi",
    visibility: "public",
    isLocal: 1,
  });
  // bob liked alice's post → a Like activity referencing the post + a
  // notification inbox row for alice (read=0, inflating her unread badge).
  const likeActId = `${APP_URL}/ap/activities/like-1`;
  await db.insert(activities).values({
    apId: likeActId,
    type: "Like",
    actorApId: bob,
    objectApId: postApId,
    direction: "inbound",
    rawJson: "{}",
  });
  await db
    .insert(inboxTable)
    .values({ actorApId: alice, activityApId: likeActId, read: 0 });

  await deleteObjectCascade(db, postApId);

  // The dangling notification inbox row is gone (no stale notification, no
  // permanent unread-badge inflation).
  const remaining = await db
    .select()
    .from(inboxTable)
    .where(eq(inboxTable.activityApId, likeActId));
  expect(remaining.length).toBe(0);
});
