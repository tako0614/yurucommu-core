import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import {
  mediaBlobDeletionClaims,
  mediaBlobDeletionJobs,
  mediaUploads,
  type Database,
} from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import { purgeActorMediaUploads } from "../../routes/account-teardown.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const OWNER = "https://yuru.test/ap/users/media-owner";
const OTHER = "https://yuru.test/ap/users/media-other";

function canonicalKey(label: string): string {
  const digest = [...new TextEncoder().encode(label)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");
  return `uploads/${digest}.jpg`;
}

type Upload = {
  id: string;
  r2Key: string;
  uploaderApId: string;
  contentType: string;
  size: number;
};

async function insertUploads(db: Database, uploads: readonly Upload[]) {
  // Six bind parameters per row including the createdAt default. Keep seeds below the
  // D1 100-parameter ceiling enforced by createTestDb().
  for (let offset = 0; offset < uploads.length; offset += 10) {
    await db.insert(mediaUploads).values(uploads.slice(offset, offset + 10));
  }
}

function upload(id: string, uploaderApId = OWNER): Upload {
  return {
    id,
    r2Key: canonicalKey(id),
    uploaderApId,
    contentType: "image/jpeg",
    size: 1,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function expectCauseMessage(
  pending: Promise<unknown>,
  expected: string,
): Promise<void> {
  let failure: unknown;
  try {
    await pending;
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  const messages: string[] = [];
  let current = failure;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  expect(messages.join("\n")).toContain(expected);
}

function objectStore(
  remove: (keys: readonly string[]) => Promise<void>,
): ObjectStore {
  return {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | readonly string[]) {
      await remove(typeof key === "string" ? [key] : key);
    },
  } as unknown as ObjectStore;
}

test("purge removes only snapshotted rows after storage deletion", async () => {
  const { db } = await createTestDb();
  const selected = upload("snapshot-old");
  await insertUploads(db, [selected, upload("snapshot-other", OTHER)]);
  const enteredDelete = deferred<readonly string[]>();
  const finishDelete = deferred();
  const store = objectStore(async (keys) => {
    enteredDelete.resolve(keys);
    await finishDelete.promise;
  });

  const purging = purgeActorMediaUploads(db, store, OWNER);
  expect(await enteredDelete.promise).toEqual([selected.r2Key]);
  const concurrent = upload("snapshot-new");
  await insertUploads(db, [concurrent]);
  finishDelete.resolve();
  await purging;

  expect(await db.select().from(mediaUploads).orderBy(mediaUploads.id)).toEqual(
    [
      expect.objectContaining({ id: concurrent.id, r2Key: concurrent.r2Key }),
      expect.objectContaining({
        id: "snapshot-other",
        r2Key: canonicalKey("snapshot-other"),
      }),
    ],
  );
});

test("claim permanently fences the key and retains its retry job until ack", async () => {
  const { db } = await createTestDb();
  const selected = upload("snapshot-replaced");
  await insertUploads(db, [selected]);
  const enteredDelete = deferred();
  const finishDelete = deferred();
  const store = objectStore(async () => {
    enteredDelete.resolve();
    await finishDelete.promise;
  });

  const purging = purgeActorMediaUploads(db, store, OWNER);
  await enteredDelete.promise;
  await expectCauseMessage(
    db
      .insert(mediaUploads)
      .values({ ...selected, id: "snapshot-replacement" })
      .execute(),
    "staged media deleted",
  );
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, selected.r2Key)),
  ).toHaveLength(1);
  finishDelete.resolve();
  await purging;

  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, selected.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, selected.r2Key)),
  ).toHaveLength(1);
});

test("R2 failure keeps the claimed retry job", async () => {
  const { db } = await createTestDb();
  const selected = upload("retry-r2");
  await insertUploads(db, [selected]);
  const failure = new Error("R2 unavailable");
  const failingStore = objectStore(async () => {
    throw failure;
  });

  await expect(purgeActorMediaUploads(db, failingStore, OWNER)).rejects.toBe(
    failure,
  );
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, selected.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, selected.r2Key)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, selected.r2Key)),
  ).toHaveLength(1);

  const retried: string[][] = [];
  await purgeActorMediaUploads(
    db,
    objectStore(async (keys) => {
      retried.push([...keys]);
    }),
    OWNER,
  );
  expect(retried).toEqual([[selected.r2Key]]);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, selected.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, selected.r2Key)),
  ).toHaveLength(0);
});

test("job-ack failure after R2 deletion keeps retry intent", async () => {
  const { db } = await createTestDb();
  const selected = upload("retry-database");
  await insertUploads(db, [selected]);
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_account_media_delete
    BEFORE DELETE ON media_blob_deletion_jobs
    BEGIN
      SELECT RAISE(ABORT, 'simulated job acknowledgment failure');
    END
  `),
  );
  let deleteCalls = 0;
  const store = objectStore(async () => {
    deleteCalls += 1;
  });

  await expect(purgeActorMediaUploads(db, store, OWNER)).rejects.toThrow();
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, selected.id)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, selected.r2Key)),
  ).toHaveLength(1);
  await db.run(sql.raw("DROP TRIGGER reject_account_media_delete"));
  await purgeActorMediaUploads(db, store, OWNER);

  expect(deleteCalls).toBe(2);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, selected.id)),
  ).toHaveLength(0);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("later job-ack failure preserves outstanding keys after partial acknowledgement", async () => {
  const { db } = await createTestDb();
  const selected = Array.from({ length: 100 }, (_, index) =>
    upload(`partial-${String(index).padStart(3, "0")}`),
  );
  await insertUploads(db, selected);
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_later_media_delete
    BEFORE DELETE ON media_blob_deletion_jobs WHEN OLD.r2_key = '${canonicalKey("partial-095")}'
    BEGIN SELECT RAISE(ABORT, 'later acknowledgement failed'); END
  `),
  );
  const requests: string[][] = [];
  const store = objectStore(async (keys) => {
    requests.push([...keys]);
  });

  await expect(purgeActorMediaUploads(db, store, OWNER)).rejects.toThrow();
  const remaining = await db.select().from(mediaBlobDeletionJobs);
  // The first 90 job acknowledgments commit; the final page remains durable.
  expect(remaining.length).toBeGreaterThan(0);
  expect(remaining.length).toBeLessThan(selected.length);
  expect(requests[0]?.sort()).toEqual(selected.map((row) => row.r2Key).sort());
  expect(remaining.map((row) => row.r2Key).sort()).toEqual(
    selected
      .slice(90)
      .map((row) => row.r2Key)
      .sort(),
  );
  await db.run(sql.raw("DROP TRIGGER reject_later_media_delete"));
  await purgeActorMediaUploads(db, store, OWNER);
  expect(requests[1]?.sort()).toEqual(remaining.map((row) => row.r2Key).sort());
  expect(await db.select().from(mediaUploads)).toHaveLength(0);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("unsupported legacy key preserves metadata and account retry intent", async () => {
  const { db } = await createTestDb();
  const legacy = upload("legacy-arbitrary-key");
  legacy.r2Key = "uploads/legacy arbitrary.jpg";
  await insertUploads(db, [legacy]);
  let deleteCalls = 0;

  await expect(
    purgeActorMediaUploads(
      db,
      objectStore(async () => {
        deleteCalls += 1;
      }),
      OWNER,
    ),
  ).rejects.toThrow("legacy-key reconciliation");

  expect(deleteCalls).toBe(0);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, legacy.r2Key)),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, legacy.r2Key)),
  ).toHaveLength(1);
});

test("without MEDIA, purge retains claimed job for a successful retry", async () => {
  const { db } = await createTestDb();
  await insertUploads(db, [
    upload("no-media-owner"),
    upload("no-media-other", OTHER),
  ]);

  await expect(purgeActorMediaUploads(db, undefined, OWNER)).rejects.toThrow(
    "requires MEDIA",
  );

  expect(await db.select().from(mediaUploads)).toEqual([
    expect.objectContaining({ id: "no-media-other", uploaderApId: OTHER }),
  ]);
  expect(await db.select().from(mediaBlobDeletionClaims)).toHaveLength(1);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(1);

  const retried: string[][] = [];
  await purgeActorMediaUploads(
    db,
    objectStore(async (keys) => {
      retried.push([...keys]);
    }),
    OWNER,
  );
  expect(retried).toEqual([[canonicalKey("no-media-owner")]]);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});

test("empty snapshot skips object-store deletion", async () => {
  const { db } = await createTestDb();
  let deleteCalls = 0;

  await purgeActorMediaUploads(
    db,
    objectStore(async () => {
      deleteCalls += 1;
    }),
    OWNER,
  );

  expect(deleteCalls).toBe(0);
});

test("large purge respects R2 chunks and keeps uploads added during a later chunk", async () => {
  // createTestDb rejects every emitted statement above D1_MAX_BOUND_PARAMS
  // (100), including both these chunked seeds and the purge's SQL statements.
  const { db } = await createTestDb();
  const oldUploads = Array.from({ length: 1001 }, (_, index) =>
    upload(`large-old-${index}`),
  );
  const other = upload("large-other", OTHER);
  await insertUploads(db, [...oldUploads, other]);

  const calls: string[][] = [];
  const secondChunkStarted = deferred();
  const finishSecondChunk = deferred();
  const store = objectStore(async (keys) => {
    calls.push([...keys]);
    if (calls.length === 2) {
      secondChunkStarted.resolve();
      await finishSecondChunk.promise;
    }
  });

  const purging = purgeActorMediaUploads(db, store, OWNER);
  await secondChunkStarted.promise;
  const concurrent = upload("large-new-during-second-chunk");
  await insertUploads(db, [concurrent]);
  finishSecondChunk.resolve();
  await purging;

  expect(calls).toHaveLength(2);
  expect(calls.every((keys) => keys.length <= 1000)).toBe(true);
  expect(calls.flat().sort()).toEqual(
    oldUploads.map((row) => row.r2Key).sort(),
  );
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.uploaderApId, OWNER)),
  ).toEqual([
    expect.objectContaining({ id: concurrent.id, r2Key: concurrent.r2Key }),
  ]);
  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.uploaderApId, OTHER)),
  ).toHaveLength(1);
  expect(await db.select().from(mediaBlobDeletionClaims)).toHaveLength(1001);
  expect(await db.select().from(mediaBlobDeletionJobs)).toHaveLength(0);
});
