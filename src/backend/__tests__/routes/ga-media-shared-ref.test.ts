import { expect, test } from "bun:test";

/**
 * GA MEDIA-REF (Round-5 LOW) — shared-blob reference counting on delete.
 *
 * An author can embed the SAME uploaded media (one unique `media_uploads` row,
 * one `r2_key`) in more than one object's `attachments_json`. The
 * `media_uploads` row is unique by `r2_key`, but the *reference* is the
 * substring match against each object's `attachments_json`, so the same blob
 * can be shared by several objects.
 *
 * `deleteObjectCascade` records durable intent and returns candidate keys;
 * upload metadata remains until a global-reference claim authorizes deletion.
 *
 * The claim checks every current object reference, including foreign owners.
 * Deleting one sharer keeps metadata and the blob; deleting the last sharer
 * permits the claim to remove metadata and purge the blob.
 */

import { eq, inArray } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { actors, mediaUploads, objects } from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import {
  deleteObjectCascade,
  deleteObjectsCascade,
  purgeMediaBlobs,
} from "../../routes/posts/delete-cascade.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";

function canonicalKey(label: string): string {
  const digest = [...new TextEncoder().encode(label)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");
  return `uploads/${digest}.jpg`;
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

/** Insert an object whose attachments embed `r2Key` (no media_uploads row). */
async function insertObjectRefingKey(
  db: Database,
  objectApId: string,
  authorApId: string,
  r2Key: string,
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
    type: "Note",
    attributedTo: authorApId,
    content: "hi",
    attachmentsJson,
    published: new Date().toISOString(),
    isLocal: 1,
    endTime: null,
  });
}

/** Records the keys passed to `delete`. */
function recordingStorage(): {
  storage: ObjectStore;
  deleted: string[];
  blobs: Set<string>;
} {
  const deleted: string[] = [];
  const blobs = new Set<string>();
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) {
        deleted.push(k);
        blobs.delete(k);
      }
    },
  } as unknown as ObjectStore;
  return { storage, deleted, blobs };
}

test("deleting one of two posts sharing an r2_key keeps the shared R2 blob", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");

  const postA = `${APP_URL}/ap/objects/post-a`;
  const postB = `${APP_URL}/ap/objects/post-b`;
  const sharedKey = canonicalKey("shared");

  // Both posts reference the same blob; the upload row is unique (one upload).
  await insertObjectRefingKey(db, postA, author, sharedKey);
  await insertObjectRefingKey(db, postB, author, sharedKey);
  await db.insert(mediaUploads).values({
    id: "media-shared",
    r2Key: sharedKey,
    uploaderApId: author,
    contentType: "image/jpeg",
    size: 123,
  });

  const { storage, deleted, blobs } = recordingStorage();
  blobs.add(sharedKey);

  // Delete post A (post B still references sharedKey). New contract: cascade
  // returns the keys, the caller purges AFTER deleting the objects row.
  const keysA = await deleteObjectCascade(db, postA, storage);
  await db.delete(objects).where(eq(objects.apId, postA));
  expect(keysA).toContain(sharedKey);
  await purgeMediaBlobs(db, storage, keysA);

  // The shared blob must NOT be purged — post B still shows it.
  expect(deleted).not.toContain(sharedKey);
  expect(blobs.has(sharedKey)).toBe(true);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, sharedKey)),
  ).toHaveLength(1);
});

test("deleting the last post referencing a shared r2_key finally purges the blob", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");

  const postA = `${APP_URL}/ap/objects/post-a`;
  const postB = `${APP_URL}/ap/objects/post-b`;
  const sharedKey = canonicalKey("shared");

  await insertObjectRefingKey(db, postA, author, sharedKey);
  await insertObjectRefingKey(db, postB, author, sharedKey);
  await db.insert(mediaUploads).values({
    id: "media-shared",
    r2Key: sharedKey,
    uploaderApId: author,
    contentType: "image/jpeg",
    size: 123,
  });

  // First delete post A: blob kept (covered above). The media_uploads row is
  // ALSO kept (not reaped) precisely because its r2_key is still referenced by
  // post B — so a later delete of the final referencer can still find the row
  // and GC the now-orphaned blob (the leak this guards against).
  const first = recordingStorage();
  first.blobs.add(sharedKey);
  const keysA = await deleteObjectCascade(db, postA, first.storage);
  await db.delete(objects).where(eq(objects.apId, postA));
  await purgeMediaBlobs(db, first.storage, keysA);
  expect(first.deleted).not.toContain(sharedKey);

  // The shared media_uploads row survived the first delete; confirm it is still
  // present so the last-referencer delete below has a row to reap.
  const surviving = await db
    .select({ id: mediaUploads.id })
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, sharedKey));
  expect(surviving.length).toBe(1);

  const second = recordingStorage();
  second.blobs.add(sharedKey);
  const keysB = await deleteObjectCascade(db, postB, second.storage);
  await db.delete(objects).where(eq(objects.apId, postB));
  await purgeMediaBlobs(db, second.storage, keysB);

  // No other present object references sharedKey now — purge it.
  expect(second.deleted).toContain(sharedKey);
  expect(second.blobs.has(sharedKey)).toBe(false);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, sharedKey)),
  ).toHaveLength(0);
});

test("deleting every sharer in one cascade purges the shared blob once", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "batch-author");
  const postA = `${APP_URL}/ap/objects/batch-a`;
  const postB = `${APP_URL}/ap/objects/batch-b`;
  const sharedKey = canonicalKey("batch-shared");

  await insertObjectRefingKey(db, postA, author, sharedKey);
  await insertObjectRefingKey(db, postB, author, sharedKey);
  await db.insert(mediaUploads).values({
    id: "media-batch-shared",
    r2Key: sharedKey,
    uploaderApId: author,
    contentType: "image/jpeg",
    size: 123,
  });

  const { storage, deleted } = recordingStorage();
  const keys = await deleteObjectsCascade(db, [postA, postB], storage);
  await db.delete(objects).where(inArray(objects.apId, [postA, postB]));
  await purgeMediaBlobs(db, storage, keys);

  expect(deleted).toEqual([sharedKey]);
  expect(
    await db
      .select({ id: mediaUploads.id })
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, sharedKey)),
  ).toEqual([]);
});
