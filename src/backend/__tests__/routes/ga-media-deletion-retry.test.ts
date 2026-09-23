import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, inArray, sql } from "drizzle-orm";

import {
  actors,
  communities,
  mediaBlobDeletionJobs,
  mediaUploads,
  objects,
  runBatch,
  type D1Statement,
  type Database,
} from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import {
  drainMediaBlobDeletionJobs,
  prepareObjectDeleteCascade,
  purgeMediaBlobDeletionJobs,
} from "../../routes/posts/delete-cascade.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const JOB_OWNER = `${APP_URL}/ap/users/job-owner`;

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

async function insertMediaPost(
  db: Database,
  apId: string,
  authorApId: string,
  r2Key: string,
  includeUpload = true,
): Promise<void> {
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: authorApId,
    content: "media post",
    attachmentsJson: JSON.stringify([
      {
        type: "Document",
        url: `/media/${r2Key.slice("uploads/".length)}`,
        r2_key: r2Key,
      },
    ]),
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    published: new Date().toISOString(),
    isLocal: 1,
  });
  if (includeUpload) {
    await db.insert(mediaUploads).values({
      id: `media-${r2Key}`,
      r2Key,
      uploaderApId: authorApId,
      contentType: "image/jpeg",
      size: 1,
    });
  }
}

function recordingStorage(options?: {
  fail?: boolean;
  partialThenFail?: boolean;
}): { storage: ObjectStore; deleted: string[]; calls: string[][] } {
  const deleted: string[] = [];
  const calls: string[][] = [];
  let callCount = 0;
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | readonly string[]) {
      const keys = Array.isArray(key) ? [...key] : [key];
      calls.push(keys);
      callCount += 1;
      if (options?.partialThenFail && callCount === 1) {
        deleted.push(keys[0]!);
        throw new Error("partial storage failure");
      }
      if (options?.fail) throw new Error("storage unavailable");
      deleted.push(...keys);
    },
  } as unknown as ObjectStore;
  return { storage, deleted, calls };
}

test("prepared canonical delete atomically rolls back object, media row, and job", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "atomic-media");
  const objectApId = `${APP_URL}/ap/objects/atomic-media`;
  const r2Key = "uploads/atomic-media.jpg";
  await insertMediaPost(db, objectApId, author, r2Key);
  await db.run(sql`
    CREATE TRIGGER reject_media_object_delete
    AFTER DELETE ON objects
    BEGIN
      SELECT RAISE(ABORT, 'simulated object delete failure');
    END
  `);

  const cascade = await prepareObjectDeleteCascade(db, objectApId);
  await expect(
    runBatch(db, [
      ...cascade.statements,
      db.delete(objects).where(eq(objects.apId, objectApId)),
    ] as [D1Statement, ...D1Statement[]]),
  ).rejects.toThrow("simulated object delete failure");

  expect(
    await db.select().from(objects).where(eq(objects.apId, objectApId)),
  ).toHaveLength(1);
  expect(
    await db.select().from(mediaUploads).where(eq(mediaUploads.r2Key, r2Key)),
  ).toHaveLength(1);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("canonical post DELETE commits a job before trailing storage completion", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "canonical-media");
  const objectApId = `${APP_URL}/ap/objects/canonical-media`;
  const r2Key = "uploads/canonical-media.jpg";
  await insertMediaPost(db, objectApId, author, r2Key);
  await db.update(actors).set({ postCount: 1 }).where(eq(actors.apId, author));
  const { storage, deleted } = recordingStorage({ fail: true });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", {
      ap_id: author,
      preferred_username: "canonical-media",
    } as Actor);
    await next();
  });
  app.route("/api/posts", postsRoutes);

  const response = await app.fetch(
    new Request(`${APP_URL}/api/posts/${encodeURIComponent(objectApId)}`, {
      method: "DELETE",
    }),
    { APP_URL, DB_INSTANCE: db, MEDIA: storage } as unknown as Env,
  );

  expect(response.status).toBe(200);
  expect(deleted).toEqual([]);
  expect(
    await db.select().from(objects).where(eq(objects.apId, objectApId)),
  ).toHaveLength(0);
  expect(
    await db.select().from(mediaUploads).where(eq(mediaUploads.r2Key, r2Key)),
  ).toHaveLength(0);
  expect(await db.select().from(mediaBlobDeletionJobs)).toEqual([
    expect.objectContaining({ r2Key }),
  ]);
});

test("successful trailing deletion removes the blob job and missing blobs replay idempotently", async () => {
  const db = await freshDb();
  const r2Key = "uploads/replay.jpg";
  await db.insert(mediaBlobDeletionJobs).values({
    r2Key,
    uploaderApId: JOB_OWNER,
  });
  const { storage, deleted, calls } = recordingStorage();

  // A lost acknowledgement may leave the job after the provider already
  // accepted a deletion. The next drain is safe and removes the durable row.
  await storage.delete(r2Key);
  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(1);

  expect(calls).toEqual([[r2Key], [r2Key]]);
  expect(deleted).toEqual([r2Key, r2Key]);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("failed and partial storage deletion retains jobs for replay", async () => {
  const db = await freshDb();
  const oldDue = "2020-01-01T00:00:00.000Z";
  await db.insert(mediaBlobDeletionJobs).values([
    {
      r2Key: "uploads/partial-a.jpg",
      uploaderApId: JOB_OWNER,
      createdAt: oldDue,
      nextAttemptAt: oldDue,
    },
    {
      r2Key: "uploads/partial-b.jpg",
      uploaderApId: JOB_OWNER,
      createdAt: oldDue,
      nextAttemptAt: oldDue,
    },
  ]);
  const { storage, deleted } = recordingStorage({ partialThenFail: true });

  await expect(drainMediaBlobDeletionJobs(db, storage)).rejects.toThrow(
    "partial storage failure",
  );
  expect(deleted).toEqual(["uploads/partial-a.jpg"]);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(2);

  await db
    .update(mediaBlobDeletionJobs)
    .set({ nextAttemptAt: oldDue })
    .where(
      inArray(mediaBlobDeletionJobs.r2Key, [
        "uploads/partial-a.jpg",
        "uploads/partial-b.jpg",
      ]),
    );
  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(2);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("shared references prevent a job and remain protected without MEDIA", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "shared-media");
  const first = `${APP_URL}/ap/objects/shared-first`;
  const second = `${APP_URL}/ap/objects/shared-second`;
  const r2Key = "uploads/shared.jpg";
  await insertMediaPost(db, first, author, r2Key);
  await insertMediaPost(db, second, author, r2Key, false);

  const cascade = await prepareObjectDeleteCascade(db, first);
  await runBatch(db, [
    ...cascade.statements,
    db.delete(objects).where(eq(objects.apId, first)),
  ] as [D1Statement, ...D1Statement[]]);

  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
  expect(
    await db.select().from(mediaUploads).where(eq(mediaUploads.r2Key, r2Key)),
  ).toHaveLength(1);
  expect(
    await db.select().from(objects).where(eq(objects.apId, second)),
  ).toHaveLength(1);
});

test("retention drains at most 50 media deletion jobs per pass", async () => {
  const db = await freshDb();
  const keys = Array.from(
    { length: 51 },
    (_, index) => `uploads/bounded-${String(index).padStart(2, "0")}.jpg`,
  );
  for (const r2Key of keys) {
    await db.insert(mediaBlobDeletionJobs).values({
      r2Key,
      uploaderApId: JOB_OWNER,
    });
  }
  const { storage, calls } = recordingStorage();

  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(50);
  expect(calls[0]).toHaveLength(50);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(1);
  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(1);
  expect(calls[1]).toHaveLength(1);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("a failed oldest page is rescheduled so newer due work progresses", async () => {
  const db = await freshDb();
  const oldDue = "2020-01-01T00:00:00.000Z";
  await db.insert(mediaBlobDeletionJobs).values([
    {
      r2Key: "uploads/poison-a.jpg",
      uploaderApId: JOB_OWNER,
      createdAt: oldDue,
      nextAttemptAt: oldDue,
    },
    {
      r2Key: "uploads/poison-b.jpg",
      uploaderApId: JOB_OWNER,
      createdAt: oldDue,
      nextAttemptAt: oldDue,
    },
  ]);
  const { storage, calls } = recordingStorage({ partialThenFail: true });

  await expect(drainMediaBlobDeletionJobs(db, storage)).rejects.toThrow(
    "partial storage failure",
  );

  const newerKey = "uploads/newer-eligible.jpg";
  await db.insert(mediaBlobDeletionJobs).values({
    r2Key: newerKey,
    uploaderApId: JOB_OWNER,
  });
  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(1);
  expect(calls).toEqual([
    ["uploads/poison-a.jpg", "uploads/poison-b.jpg"],
    [newerKey],
  ]);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(
        inArray(mediaBlobDeletionJobs.r2Key, [
          "uploads/poison-a.jpg",
          "uploads/poison-b.jpg",
        ]),
      ),
  ).toHaveLength(2);
});

test("referenced oldest jobs do not starve a later eligible job", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "fair-media");
  const oldDue = "2020-01-01T00:00:00.000Z";
  const referencedKeys = Array.from(
    { length: 50 },
    (_, index) => `uploads/ref-${String(index).padStart(2, "0")}.jpg`,
  );
  for (const [index, r2Key] of referencedKeys.entries()) {
    await insertMediaPost(
      db,
      `${APP_URL}/ap/objects/fair-${String(index).padStart(2, "0")}`,
      author,
      r2Key,
    );
    await db.insert(mediaBlobDeletionJobs).values({
      r2Key,
      uploaderApId: author,
      createdAt: oldDue,
      nextAttemptAt: oldDue,
    });
  }
  const eligibleKey = "uploads/zz-eligible.jpg";
  await db.insert(mediaBlobDeletionJobs).values({
    r2Key: eligibleKey,
    uploaderApId: author,
    createdAt: oldDue,
    nextAttemptAt: oldDue,
  });
  const { storage, calls } = recordingStorage();

  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(0);
  expect(calls).toEqual([]);
  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(1);
  expect(calls).toEqual([[eligibleKey]]);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(inArray(mediaBlobDeletionJobs.r2Key, referencedKeys)),
  ).toHaveLength(50);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, eligibleKey)),
  ).toHaveLength(0);
});

test("profile and live community references protect reattached jobs without upload rows", async () => {
  const db = await freshDb();
  const owner = await insertActor(db, "reattached-media");
  const profileKey = "uploads/profile-reattach.jpg";
  const communityKey = "uploads/community-reattach.jpg";
  await db.insert(mediaBlobDeletionJobs).values([
    { r2Key: profileKey, uploaderApId: owner },
    { r2Key: communityKey, uploaderApId: owner },
  ]);
  await db
    .update(actors)
    .set({ iconUrl: "/media/profile-reattach.jpg" })
    .where(eq(actors.apId, owner));
  await db.insert(communities).values({
    apId: `${APP_URL}/ap/communities/reattached-media`,
    preferredUsername: "reattached-media",
    name: "Reattached media",
    inbox: `${APP_URL}/ap/communities/reattached-media/inbox`,
    outbox: `${APP_URL}/ap/communities/reattached-media/outbox`,
    followersUrl: `${APP_URL}/ap/communities/reattached-media/followers`,
    publicKeyPem: "community-pub",
    privateKeyPem: "community-priv",
    createdBy: owner,
    iconUrl: "/media/community-reattach.jpg",
  });
  const { storage, calls } = recordingStorage();

  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(0);
  expect(calls).toEqual([]);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(2);
});

test("foreign-owner object references do not block an uploader-owned job", async () => {
  const db = await freshDb();
  const owner = await insertActor(db, "media-owner");
  const foreign = await insertActor(db, "foreign-media-owner");
  const r2Key = "uploads/foreign-object.jpg";
  await db.insert(mediaBlobDeletionJobs).values({
    r2Key,
    uploaderApId: owner,
  });
  await insertMediaPost(
    db,
    `${APP_URL}/ap/objects/foreign-media-object`,
    foreign,
    r2Key,
    false,
  );
  const { storage, calls } = recordingStorage();

  expect(await drainMediaBlobDeletionJobs(db, storage)).toBe(1);
  expect(calls).toEqual([[r2Key]]);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("immediate completion chunks job-row deletion beyond the D1 parameter ceiling", async () => {
  const db = await freshDb();
  const keys = Array.from(
    { length: 101 },
    (_, index) => `uploads/immediate-${String(index).padStart(3, "0")}.jpg`,
  );
  for (const r2Key of keys) {
    await db.insert(mediaBlobDeletionJobs).values({
      r2Key,
      uploaderApId: JOB_OWNER,
    });
  }
  const { storage, calls } = recordingStorage();

  await purgeMediaBlobDeletionJobs(db, storage, keys);
  expect(calls).toEqual([keys]);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("missing MEDIA fails the retention step without discarding jobs", async () => {
  const db = await freshDb();
  const r2Key = "uploads/no-media-binding.jpg";
  await db.insert(mediaBlobDeletionJobs).values({
    r2Key,
    uploaderApId: JOB_OWNER,
  });

  await expect(drainMediaBlobDeletionJobs(db, undefined)).rejects.toThrow(
    "requires MEDIA",
  );
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(1);
});

test("canonical completion keeps a job when MEDIA is absent", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "no-media-canonical");
  const objectApId = `${APP_URL}/ap/objects/no-media-canonical`;
  const r2Key = "uploads/no-media-canonical.jpg";
  await insertMediaPost(db, objectApId, author, r2Key);

  const cascade = await prepareObjectDeleteCascade(db, objectApId);
  await runBatch(db, [
    ...cascade.statements,
    db.delete(objects).where(eq(objects.apId, objectApId)),
  ] as [D1Statement, ...D1Statement[]]);
  await purgeMediaBlobDeletionJobs(db, undefined, cascade.mediaKeys);

  expect(await db.select().from(mediaBlobDeletionJobs)).toEqual([
    expect.objectContaining({ r2Key }),
  ]);
});
