import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";

import { mediaUploads, type Database } from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import { purgeActorMediaUploads } from "../../routes/account-teardown.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const OWNER = "https://yuru.test/ap/users/media-owner";
const OTHER = "https://yuru.test/ap/users/media-other";

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
    r2Key: `uploads/${id}.jpg`,
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
        r2Key: "uploads/snapshot-other.jpg",
      }),
    ],
  );
});

test("purge preserves a selected id whose key changed during storage deletion", async () => {
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
  const replacementKey = "uploads/snapshot-replaced-new-version.jpg";
  await db
    .update(mediaUploads)
    .set({ r2Key: replacementKey })
    .where(eq(mediaUploads.id, selected.id));
  finishDelete.resolve();
  await purging;

  expect(
    await db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.id, selected.id)),
  ).toEqual([
    expect.objectContaining({ id: selected.id, r2Key: replacementKey }),
  ]);
});

test("R2 failure keeps selected metadata for a successful retry", async () => {
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
});

test("database failure after R2 deletion keeps metadata and can be retried", async () => {
  const { db } = await createTestDb();
  const selected = upload("retry-database");
  await insertUploads(db, [selected]);
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_account_media_delete
    BEFORE DELETE ON media_uploads
    BEGIN
      SELECT RAISE(ABORT, 'simulated media metadata failure');
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
});

test("later metadata failure preserves outstanding rows after partial acknowledgement", async () => {
  const { db } = await createTestDb();
  const selected = Array.from({ length: 100 }, (_, index) =>
    upload(`partial-${String(index).padStart(3, "0")}`),
  );
  await insertUploads(db, selected);
  await db.run(
    sql.raw(`
    CREATE TRIGGER reject_later_media_delete
    BEFORE DELETE ON media_uploads WHEN OLD.id = 'partial-050'
    BEGIN SELECT RAISE(ABORT, 'later acknowledgement failed'); END
  `),
  );
  const requests: string[][] = [];
  const store = objectStore(async (keys) => {
    requests.push([...keys]);
  });

  await expect(purgeActorMediaUploads(db, store, OWNER)).rejects.toThrow();
  const remaining = await db.select().from(mediaUploads);
  // Some successful independent acknowledgements may commit. Every row
  // still present retains its original key for retry, with no new key minted.
  expect(remaining.length).toBeGreaterThan(0);
  expect(remaining.length).toBeLessThan(selected.length);
  expect(requests[0]?.sort()).toEqual(selected.map((row) => row.r2Key).sort());
  expect(remaining.every((row) => row.r2Key === `uploads/${row.id}.jpg`)).toBe(
    true,
  );
  await db.run(sql.raw("DROP TRIGGER reject_later_media_delete"));
  await purgeActorMediaUploads(db, store, OWNER);
  expect(requests[1]?.sort()).toEqual(remaining.map((row) => row.r2Key).sort());
  expect(await db.select().from(mediaUploads)).toHaveLength(0);
});

test("without MEDIA, purge removes only the selected uploader rows", async () => {
  const { db } = await createTestDb();
  await insertUploads(db, [
    upload("no-media-owner"),
    upload("no-media-other", OTHER),
  ]);

  await purgeActorMediaUploads(db, undefined, OWNER);

  expect(await db.select().from(mediaUploads)).toEqual([
    expect.objectContaining({ id: "no-media-other", uploaderApId: OTHER }),
  ]);
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
});
