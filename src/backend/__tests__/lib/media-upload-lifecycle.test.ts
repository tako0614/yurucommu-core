import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { mediaUploadAttempts } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import {
  cleanupMediaUploadAttempt,
  drainSettledMediaUploadAttempts,
  settleMediaUploadAttempt,
} from "../../lib/media-upload-lifecycle.ts";
import type { Env } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import { createActor } from "../../routes/auth-helpers.ts";

const APP_URL = "https://media-lifecycle.test";

function errorCauseMessages(error: unknown): string[] {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    messages.push(current.message);
    current = current.cause;
  }
  return messages;
}

function mediaStore(options: {
  remove(keys: readonly string[]): Promise<void>;
}): ObjectStore {
  return {
    async put() {},
    async get() {
      return null;
    },
    async delete(value) {
      await options.remove(typeof value === "string" ? [value] : value);
    },
  };
}

function envFor(db: Database, MEDIA?: ObjectStore): Env {
  return { APP_URL, DB_INSTANCE: db, MEDIA } as unknown as Env;
}

async function createUploader(db: Database) {
  return createActor(db, envFor(db), {
    username: `media-cleanup-${crypto.randomUUID().slice(0, 8)}`,
    name: "Media cleanup fixture",
    takosUserId: `local:${crypto.randomUUID()}`,
    role: "member",
  });
}

async function addPuttingAttempt(
  db: Database,
  uploaderApId: string,
  publicKeyPem: string,
  id: string,
  createdAt = new Date().toISOString(),
) {
  await db.insert(mediaUploadAttempts).values({
    id,
    r2Key: `uploads/${id}.webm`,
    uploaderApId,
    publicKeyPem,
    phase: "putting",
    createdAt,
  });
  return db
    .select()
    .from(mediaUploadAttempts)
    .where(eq(mediaUploadAttempts.id, id))
    .get();
}

test("bounded settled-attempt drain removes 50 cleanup keys and retains the 51st plus active puts", async () => {
  const { db } = await createTestDb();
  const uploader = await createUploader(db);
  const keys = new Set<string>();
  for (let index = 0; index < 51; index += 1) {
    const attempt = await addPuttingAttempt(
      db,
      uploader.apId,
      uploader.publicKeyPem,
      `cleanup-${index.toString().padStart(2, "0")}`,
      new Date(Date.now() + index).toISOString(),
    );
    if (!attempt)
      throw new Error("test fixture upload attempt was not inserted");
    await settleMediaUploadAttempt(db, attempt);
    keys.add(attempt.r2Key);
  }
  const active = await addPuttingAttempt(
    db,
    uploader.apId,
    uploader.publicKeyPem,
    "still-putting",
    "2000-01-01T00:00:00.000Z",
  );
  if (!active) throw new Error("test fixture active attempt was not inserted");

  const deleted: string[] = [];
  const env = envFor(
    db,
    mediaStore({
      async remove(batch) {
        deleted.push(...batch);
      },
    }),
  );
  expect(await drainSettledMediaUploadAttempts(env)).toBe(50);
  expect(deleted).toHaveLength(50);
  expect(deleted.every((key) => keys.has(key))).toBe(true);
  const remaining = await db
    .select({ id: mediaUploadAttempts.id, phase: mediaUploadAttempts.phase })
    .from(mediaUploadAttempts)
    .orderBy(mediaUploadAttempts.id);
  expect(remaining).toEqual([
    { id: "cleanup-50", phase: "cleanup" },
    { id: "still-putting", phase: "putting" },
  ]);
});

test("missing storage or a failed physical delete preserves cleanup identity", async () => {
  const { db } = await createTestDb();
  const uploader = await createUploader(db);
  const attempt = await addPuttingAttempt(
    db,
    uploader.apId,
    uploader.publicKeyPem,
    "cleanup-storage-failure",
  );
  if (!attempt) throw new Error("test fixture upload attempt was not inserted");
  await settleMediaUploadAttempt(db, attempt);

  let missingStorageError: unknown;
  try {
    await cleanupMediaUploadAttempt(db, envFor(db), {
      ...attempt,
      phase: "cleanup",
    });
  } catch (error) {
    missingStorageError = error;
  }
  expect(missingStorageError).toBeInstanceOf(Error);
  expect((missingStorageError as Error).message).toMatch(
    /storage unavailable/i,
  );
  expect(
    await db
      .select({ phase: mediaUploadAttempts.phase })
      .from(mediaUploadAttempts)
      .where(eq(mediaUploadAttempts.id, attempt.id))
      .get(),
  ).toEqual({ phase: "cleanup" });

  let storageError: unknown;
  try {
    await cleanupMediaUploadAttempt(
      db,
      envFor(
        db,
        mediaStore({
          async remove() {
            throw new Error("temporary object store outage");
          },
        }),
      ),
      { ...attempt, phase: "cleanup" },
    );
  } catch (error) {
    storageError = error;
  }
  expect(storageError).toBeInstanceOf(Error);
  expect((storageError as Error).message).toMatch(
    /temporary object store outage/,
  );
  expect(
    await db
      .select({
        r2Key: mediaUploadAttempts.r2Key,
        phase: mediaUploadAttempts.phase,
      })
      .from(mediaUploadAttempts)
      .where(eq(mediaUploadAttempts.id, attempt.id))
      .get(),
  ).toEqual({ r2Key: attempt.r2Key, phase: "cleanup" });
});

test("a DB acknowledgment failure after physical success retains cleanup for retry", async () => {
  const { db, client } = await createTestDb();
  const uploader = await createUploader(db);
  const attempt = await addPuttingAttempt(
    db,
    uploader.apId,
    uploader.publicKeyPem,
    "cleanup-ack-failure",
  );
  if (!attempt) throw new Error("test fixture upload attempt was not inserted");
  await settleMediaUploadAttempt(db, attempt);
  await client.executeMultiple(`
    CREATE TRIGGER reject_upload_attempt_ack
    BEFORE DELETE ON media_upload_attempts
    WHEN OLD.id = 'cleanup-ack-failure'
    BEGIN
      SELECT RAISE(ABORT, 'fixture_upload_attempt_ack_failed');
    END;
  `);

  const deleted: string[] = [];
  const env = envFor(
    db,
    mediaStore({
      async remove(keys) {
        deleted.push(...keys);
      },
    }),
  );
  let ackError: unknown;
  try {
    await cleanupMediaUploadAttempt(db, env, { ...attempt, phase: "cleanup" });
  } catch (error) {
    ackError = error;
  }
  expect(ackError).toBeInstanceOf(Error);
  expect(errorCauseMessages(ackError).join("\n")).toContain(
    "fixture_upload_attempt_ack_failed",
  );
  expect(deleted).toEqual([attempt.r2Key]);
  expect(
    await db
      .select({ phase: mediaUploadAttempts.phase })
      .from(mediaUploadAttempts)
      .where(eq(mediaUploadAttempts.id, attempt.id))
      .get(),
  ).toEqual({ phase: "cleanup" });

  await client.execute("DROP TRIGGER reject_upload_attempt_ack");
  await cleanupMediaUploadAttempt(db, env, { ...attempt, phase: "cleanup" });
  expect(deleted).toEqual([attempt.r2Key, attempt.r2Key]);
  expect(
    await db
      .select({ id: mediaUploadAttempts.id })
      .from(mediaUploadAttempts)
      .where(eq(mediaUploadAttempts.id, attempt.id)),
  ).toHaveLength(0);
});
