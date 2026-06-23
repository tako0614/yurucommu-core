import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA MEDIA-REF (Round-5 LOW) — shared-blob reference counting on delete.
 *
 * An author can embed the SAME uploaded media (one unique `media_uploads` row,
 * one `r2_key`) in more than one object's `attachments_json`. The
 * `media_uploads` row is unique by `r2_key`, but the *reference* is the
 * substring match against each object's `attachments_json`, so the same blob
 * can be shared by several objects.
 *
 * `deleteObjectCascade` reaps the `media_uploads` rows attached to the deleted
 * object and best-effort purges the backing R2 blobs. Historically it purged
 * the blob unconditionally — so deleting ONE of two posts sharing an `r2_key`
 * would data-loss the blob still shown by the other post.
 *
 * The fix gates the R2 blob delete on a reference-count check: the blob is only
 * purged when no OTHER still-present object of the same author references that
 * `r2_key`. These tests assert: deleting one of two sharers keeps the blob;
 * deleting the last sharer finally purges it. (DB-row reap behaviour is
 * unchanged and covered by ga-media-gc.test.ts.)
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, mediaUploads, objects } from "../../../db/index.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../../routes/posts/delete-cascade.ts";

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
function recordingStorage(): { storage: IObjectStorage; deleted: string[] } {
  const deleted: string[] = [];
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | string[]) {
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

test("deleting one of two posts sharing an r2_key keeps the shared R2 blob", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");

  const postA = `${APP_URL}/ap/objects/post-a`;
  const postB = `${APP_URL}/ap/objects/post-b`;
  const sharedKey = "uploads/shared.jpg";

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

  const { storage, deleted } = recordingStorage();

  // Delete post A (post B still references sharedKey). New contract: cascade
  // returns the keys, the caller purges AFTER deleting the objects row.
  const keysA = await deleteObjectCascade(db, postA, storage);
  await db.delete(objects).where(eq(objects.apId, postA));
  await purgeMediaBlobs(storage, keysA);

  // The shared blob must NOT be purged — post B still shows it.
  expect(deleted).not.toContain(sharedKey);
});

test("deleting the last post referencing a shared r2_key finally purges the blob", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");

  const postA = `${APP_URL}/ap/objects/post-a`;
  const postB = `${APP_URL}/ap/objects/post-b`;
  const sharedKey = "uploads/shared.jpg";

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
  const keysA = await deleteObjectCascade(db, postA, first.storage);
  await db.delete(objects).where(eq(objects.apId, postA));
  await purgeMediaBlobs(first.storage, keysA);
  expect(first.deleted).not.toContain(sharedKey);

  // The shared media_uploads row survived the first delete; confirm it is still
  // present so the last-referencer delete below has a row to reap.
  const surviving = await db
    .select({ id: mediaUploads.id })
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, sharedKey));
  expect(surviving.length).toBe(1);

  const second = recordingStorage();
  const keysB = await deleteObjectCascade(db, postB, second.storage);
  await db.delete(objects).where(eq(objects.apId, postB));
  await purgeMediaBlobs(second.storage, keysB);

  // No other present object references sharedKey now — purge it.
  expect(second.deleted).toContain(sharedKey);
});
