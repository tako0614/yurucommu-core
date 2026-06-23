import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA MEDIA-GC #6 — object delete must purge the backing R2 blobs.
 *
 * `deleteObjectCascade` / `cleanupExpiredStories` delete the object-attached
 * `media_uploads` DB rows, but historically left the backing R2 objects behind
 * forever (there is no orphaned-key GC). They now best-effort delete the blobs
 * by `r2_key` through the threaded `MEDIA` (IObjectStorage) binding, mirroring
 * the account-delete teardown in `routes/actors.ts`.
 *
 * These tests assert the reaped uploads' `r2_key`s are requested for deletion on
 * the object-store binding, that an unrelated object's blob is NOT requested,
 * and that an R2 error never fails the DB delete.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  announces,
  bookmarks,
  likes,
  mediaUploads,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
  reapReplacedMediaUrl,
} from "../../routes/posts/delete-cascade.ts";
import { cleanupExpiredStories } from "../../routes/stories/query-helpers.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
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

/**
 * Minimal IObjectStorage stub that only records the keys passed to `delete`.
 * `delete` accepts `string | string[]`; collect both shapes flat.
 */
function recordingStorage(opts?: { throwOnDelete?: boolean }): {
  storage: IObjectStorage;
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
    async list() {
      return { objects: [], truncated: false } as never;
    },
    async head() {
      return null;
    },
  } as unknown as IObjectStorage;
  return { storage, deleted };
}

test("deleteObjectCascade requests R2 deletion of the reaped upload's r2_key", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/with-media`;
  const survivor = `${APP_URL}/ap/objects/survivor`;
  const targetKey = "uploads/target.jpg";
  const survivorKey = "uploads/survivor.jpg";

  await seedWithMedia(db, target, author, other, targetKey);
  await seedWithMedia(db, survivor, author, other, survivorKey);

  const { storage, deleted } = recordingStorage();

  // New contract: cascade returns the keys; the caller purges AFTER deleting
  // the objects row.
  const keys = await deleteObjectCascade(db, target, storage);
  await db.delete(objects).where(eq(objects.apId, target));
  await purgeMediaBlobs(storage, keys);

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

test("deleteObjectCascade with no MEDIA binding still deletes the DB row", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/no-binding`;
  const key = "uploads/no-binding.jpg";
  await seedWithMedia(db, target, author, other, key);

  // No storage argument: must not throw and must still reap the DB row.
  await deleteObjectCascade(db, target);

  const row = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, key))
    .get();
  expect(row).toBeUndefined();
});

test("deleteObjectCascade swallows R2 delete errors (DB delete still succeeds)", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/throwing`;
  const key = "uploads/throwing.jpg";
  await seedWithMedia(db, target, author, other, key);

  const { storage } = recordingStorage({ throwOnDelete: true });

  // R2 error must NOT propagate / fail the DB delete. The purge now lives in the
  // trailing purgeMediaBlobs step, so exercise it with a throwing storage too.
  const keys = await deleteObjectCascade(db, target, storage);
  await purgeMediaBlobs(storage, keys); // throwOnDelete — must swallow, not throw

  const row = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, key))
    .get();
  expect(row).toBeUndefined();
});

test("deleteObjectCascade reaps a blob referenced by ONLY its /media URL (no r2_key field)", async () => {
  // Audit #16 #8: the GC historically matched only the r2_key substring. An
  // attachment carrying only the served /media URL (a client that omits r2_key)
  // slipped the reap and leaked its blob forever. The GC now matches both forms.
  const db = await freshDb();
  const author = await insertActor(db, "author");

  const objApId = `${APP_URL}/ap/objects/url-only`;
  const r2Key = "uploads/urlonly.jpg";
  await db.insert(objects).values({
    apId: objApId,
    type: "Note",
    attributedTo: author,
    content: "hi",
    // ONLY the /media URL — no r2_key field at all.
    attachmentsJson: JSON.stringify([{ url: "/media/urlonly.jpg" }]),
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
  await purgeMediaBlobs(storage, keys);

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
  const oldUrl = "/media/old.png";
  const r2Key = "uploads/old.png";
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
    r2Key: "uploads/shared.png",
    uploaderApId: author,
    contentType: "image/png",
    size: 1,
  });
  await db
    .update(actors)
    .set({ iconUrl: "/media/new.png", headerUrl: "/media/shared.png" })
    .where(eq(actors.apId, author));
  const { storage: s2, deleted: d2 } = recordingStorage();
  // Pretend the icon was set to shared.png then changed away — but header still
  // uses shared.png, so the blob must NOT be reaped.
  await reapReplacedMediaUrl(db, "/media/shared.png", author, s2);
  expect(d2).not.toContain("uploads/shared.png");
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, "uploads/shared.png"))
      .get(),
  ).toBeDefined();
});

test("reapReplacedMediaUrl keeps a blob still embedded in one of the uploader's posts", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const url = "/media/inpost.png";
  const r2Key = "uploads/inpost.png";
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
  const storyKey = "uploads/story.jpg";
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
