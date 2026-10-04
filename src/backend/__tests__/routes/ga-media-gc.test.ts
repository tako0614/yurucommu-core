import { expect, test } from "bun:test";

/**
 * GA MEDIA-GC #6 — object delete must purge the backing R2 blobs.
 *
 * Object cascades record durable deletion intent while retaining upload
 * metadata. After the source object is removed, a global-reference claim may
 * remove metadata and authorize physical deletion through MEDIA.
 *
 * These tests assert the reaped uploads' `r2_key`s are requested for deletion on
 * the object-store binding, that an unrelated object's blob is NOT requested,
 * and that an R2 error never fails the DB delete.
 */

import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  actors,
  announces,
  bookmarks,
  likes,
  mediaBlobDeletionJobs,
  mediaUploads,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
  reapReplacedMediaUrl,
} from "../../routes/posts/delete-cascade.ts";
import { cleanupExpiredStories } from "../../routes/stories/query-helpers.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";

function canonicalKey(label: string, extension = "jpg"): string {
  const digest = [...new TextEncoder().encode(label)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");
  return `uploads/${digest}.${extension}`;
}

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

async function seedWithMedia(
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
    endTime: type === "Story" ? "1970-01-01T00:00:00.000Z" : null,
  });
  await db.insert(mediaUploads).values({
    id: `media-${objectApId.slice(objectApId.lastIndexOf("/") + 1)}`,
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

/**
 * Minimal ObjectStore stub that only records the keys passed to `delete`.
 * `delete` accepts `string | string[]`; collect both shapes flat.
 */
function recordingStorage(opts?: { throwOnDelete?: boolean }): {
  storage: ObjectStore;
  deleted: string[];
} {
  const deleted: string[] = [];
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | string[]) {
      if (opts?.throwOnDelete) throw new Error("R2 unavailable");
      for (const k of Array.isArray(key) ? key : [key]) deleted.push(k);
    },
  } as unknown as ObjectStore;
  return { storage, deleted };
}

test("deleteObjectCascade requests R2 deletion of the reaped upload's r2_key", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/with-media`;
  const survivor = `${APP_URL}/ap/objects/survivor`;
  const targetKey = canonicalKey("target");
  const survivorKey = canonicalKey("survivor");

  await seedWithMedia(db, target, author, other, targetKey);
  await seedWithMedia(db, survivor, author, other, survivorKey);

  const { storage, deleted } = recordingStorage();

  // New contract: cascade returns the keys; the caller purges AFTER deleting
  // the objects row.
  const keys = await deleteObjectCascade(db, target, storage);
  expect(deleted).toEqual([]);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, targetKey))
      .get(),
  ).toBeDefined();
  await db.delete(objects).where(eq(objects.apId, target));
  await purgeMediaBlobs(db, storage, keys);

  // The reaped object's blob was requested for deletion ...
  expect(deleted).toContain(targetKey);
  // ... and the unrelated object's blob was NOT.
  expect(deleted).not.toContain(survivorKey);

  // DB row is gone too.
  const row = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, targetKey))
    .get();
  expect(row).toBeUndefined();
});

test("deleteObjectCascade retains metadata and intent without MEDIA", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/no-binding`;
  const key = canonicalKey("no-binding");
  await seedWithMedia(db, target, author, other, key);

  // Without MEDIA, retain both the upload metadata and durable job.
  const keys = await deleteObjectCascade(db, target);
  await db.delete(objects).where(eq(objects.apId, target));
  await purgeMediaBlobs(db, undefined, keys);

  const row = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, key))
    .get();
  expect(row).toBeDefined();
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(1);
});

test("deleteObjectCascade keeps the claimed retry job after R2 failure", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/throwing`;
  const key = canonicalKey("throwing");
  await seedWithMedia(db, target, author, other, key);

  const { storage } = recordingStorage({ throwOnDelete: true });

  // The source mutation and permanent claim commit before external storage.
  // Provider failure is swallowed and the durable job remains for retry.
  const keys = await deleteObjectCascade(db, target, storage);
  await db.delete(objects).where(eq(objects.apId, target));
  await purgeMediaBlobs(db, storage, keys); // provider failure keeps durable intent

  const row = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, key))
    .get();
  expect(row).toBeUndefined();
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(1);
});

test("deleteObjectCascade reaps a blob referenced by ONLY its /media URL (no r2_key field)", async () => {
  // Audit #16 #8: the GC historically matched only the r2_key substring. An
  // attachment carrying only the served /media URL (a client that omits r2_key)
  // slipped the reap and leaked its blob forever. The GC now matches both forms.
  const db = await freshDb();
  const author = await insertActor(db, "author");

  const objApId = `${APP_URL}/ap/objects/url-only`;
  const r2Key = canonicalKey("urlonly");
  await db.insert(objects).values({
    apId: objApId,
    type: "Note",
    attributedTo: author,
    content: "hi",
    // ONLY the /media URL — no r2_key field at all.
    attachmentsJson: JSON.stringify([
      { url: `/media/${r2Key.slice("uploads/".length)}` },
    ]),
    isLocal: 1,
  });
  await db.insert(mediaUploads).values({
    id: "media-urlonly",
    r2Key,
    uploaderApId: author,
    contentType: "image/jpeg",
    size: 1,
  });

  const { storage, deleted } = recordingStorage();
  const keys = await deleteObjectCascade(db, objApId, storage);
  await db.delete(objects).where(eq(objects.apId, objApId));
  await purgeMediaBlobs(db, storage, keys);

  expect(deleted).toContain(r2Key);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, r2Key))
      .get(),
  ).toBeUndefined();
});

test("reapReplacedMediaUrl reaps an unreferenced replaced avatar but KEEPS one still in use", async () => {
  // Audit #16 #6: profile/community image media attaches to no object, so no GC
  // path reclaims a replaced one. reapReplacedMediaUrl handles the replace.
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const r2Key = canonicalKey("old", "png");
  const oldUrl = `/media/${r2Key.slice("uploads/".length)}`;
  await db.insert(mediaUploads).values({
    id: "media-old",
    r2Key,
    uploaderApId: author,
    contentType: "image/png",
    size: 1,
  });

  // Case A: the actor's icon was just changed to a NEW url; the old blob is no
  // longer referenced anywhere → it is reaped.
  await db
    .update(actors)
    .set({ iconUrl: "/media/new.png" })
    .where(eq(actors.apId, author));
  const { storage, deleted } = recordingStorage();
  await reapReplacedMediaUrl(db, oldUrl, author, storage);
  expect(deleted).toContain(r2Key);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, r2Key))
      .get(),
  ).toBeUndefined();

  // Case B: an identical blob is still referenced as the header → it is KEPT.
  await db.insert(mediaUploads).values({
    id: "media-shared",
    r2Key: canonicalKey("shared", "png"),
    uploaderApId: author,
    contentType: "image/png",
    size: 1,
  });
  const sharedProfileKey = canonicalKey("shared", "png");
  const sharedProfileUrl = `/media/${sharedProfileKey.slice("uploads/".length)}`;
  await db
    .update(actors)
    .set({ iconUrl: "/media/new.png", headerUrl: sharedProfileUrl })
    .where(eq(actors.apId, author));
  const { storage: s2, deleted: d2 } = recordingStorage();
  // Pretend the icon was set to shared.png then changed away — but header still
  // uses shared.png, so the blob must NOT be reaped.
  await reapReplacedMediaUrl(db, sharedProfileUrl, author, s2);
  expect(d2).not.toContain(sharedProfileKey);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, sharedProfileKey))
      .get(),
  ).toBeDefined();
});

test("reapReplacedMediaUrl keeps a blob still embedded in one of the uploader's posts", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const r2Key = canonicalKey("inpost", "png");
  const url = `/media/${r2Key.slice("uploads/".length)}`;
  await db.insert(mediaUploads).values({
    id: "media-inpost",
    r2Key,
    uploaderApId: author,
    contentType: "image/png",
    size: 1,
  });
  // A post still embeds the blob (by URL form).
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p1`,
    type: "Note",
    attributedTo: author,
    content: "x",
    attachmentsJson: JSON.stringify([{ url }]),
    isLocal: 1,
  });

  const { storage, deleted } = recordingStorage();
  await reapReplacedMediaUrl(db, url, author, storage);
  expect(deleted).not.toContain(r2Key);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, r2Key))
      .get(),
  ).toBeDefined();
});

test("cleanupExpiredStories requests R2 deletion of expired stories' r2_keys", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const story = `${APP_URL}/ap/objects/expired-story`;
  const storyKey = canonicalKey("story");
  await seedWithMedia(db, story, author, other, storyKey, "Story");

  const { storage, deleted } = recordingStorage();

  const removed = await cleanupExpiredStories(db, storage);
  expect(removed).toBe(1);
  expect(deleted).toContain(storyKey);

  const row = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, storyKey))
    .get();
  expect(row).toBeUndefined();
});
