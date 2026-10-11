import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  accountDeletionTargets,
  accountDeletions,
  actors,
  mediaUploadAttempts,
  mediaUploads,
  sessions,
  type Database,
} from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import { createYurucommuBackendApp } from "../../public.ts";
import type { Env } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";

const APP_URL = "https://upload-reservation.test";
const SESSION_SALT = "upload-reservation-session-salt";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryKv() {
  const values = new Map<string, string>();
  return {
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async put(key: string, value: string) {
      values.set(key, value);
    },
    async delete(key: string) {
      values.delete(key);
    },
  };
}

function queue() {
  return {
    async send() {},
    async sendBatch() {},
  };
}

function envFor(db: Database, media: ObjectStore): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: media,
    KV: memoryKv(),
    DELIVERY_QUEUE: queue(),
    DELIVERY_DLQ: queue(),
    YURUCOMMU_SESSION_HASH_SALT: SESSION_SALT,
  } as unknown as Env;
}

async function createOwner(db: Database) {
  return createActor(db, envFor(db, emptyStorage()), {
    username: `upload-owner-${crypto.randomUUID().slice(0, 8)}`,
    name: "Upload owner",
    takosUserId: `password:${crypto.randomUUID()}`,
    role: "owner",
  });
}

function emptyStorage(): ObjectStore {
  return {
    async put() {},
    async get() {
      return null;
    },
    async delete() {},
  };
}

async function seedSession(
  db: Database,
  memberId: string,
  rawId: string,
): Promise<void> {
  const id = await hashSessionIdForEnv(envFor(db, emptyStorage()), rawId);
  await db.insert(sessions).values({
    id,
    memberId,
    accessToken: id,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    provider: null,
  });
}

const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);

function uploadRequest(rawSessionId: string): Request {
  const form = new FormData();
  form.set("file", new File([WEBM_BYTES], "clip.webm", { type: "video/webm" }));
  return new Request(`${APP_URL}/api/media/upload`, {
    method: "POST",
    headers: { cookie: `session=${rawSessionId}`, origin: APP_URL },
    body: form,
  });
}

function deleteRequest(rawSessionId: string): Request {
  return new Request(`${APP_URL}/api/actors/me/delete`, {
    method: "POST",
    headers: { cookie: `session=${rawSessionId}`, origin: APP_URL },
  });
}

function makeMedia(options?: {
  onPut?: (key: string, value: unknown) => Promise<void>;
  onDelete?: (keys: readonly string[]) => Promise<void>;
}) {
  const blobs = new Map<string, unknown>();
  const puts: string[] = [];
  const deletes: string[][] = [];
  const storage: ObjectStore = {
    async put(key, value) {
      puts.push(key);
      if (options?.onPut) {
        await options.onPut(key, value);
      } else {
        blobs.set(key, value);
      }
    },
    async get() {
      return null;
    },
    async delete(value) {
      const keys = typeof value === "string" ? [value] : [...value];
      deletes.push(keys);
      if (options?.onDelete) {
        await options.onDelete(keys);
      } else {
        for (const key of keys) blobs.delete(key);
      }
    },
  };
  return { storage, blobs, puts, deletes };
}

async function attemptRows(db: Database, uploaderApId: string) {
  return db
    .select()
    .from(mediaUploadAttempts)
    .where(eq(mediaUploadAttempts.uploaderApId, uploaderApId));
}

async function currentActorState(db: Database, apId: string) {
  return db
    .select({ deletedAt: actors.deletedAt })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
}

test("a held object put stays reserved until failed compensation is retried by account deletion", async () => {
  const { db } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-held-session";
  await seedSession(db, actor.apId, rawSessionId);
  const putEntered = deferred<{ key: string; value: unknown }>();
  const releasePut = deferred();
  let failCompensation = true;
  const media = makeMedia({
    async onPut(key, value) {
      putEntered.resolve({ key, value });
      await releasePut.promise;
      media.blobs.set(key, value);
    },
    async onDelete(keys) {
      if (failCompensation) {
        failCompensation = false;
        throw new Error("compensating delete unavailable");
      }
      for (const key of keys) media.blobs.delete(key);
    },
  });
  const app = createYurucommuBackendApp({ singleOwner: true });
  const env = envFor(db, media.storage);
  let uploadResponse: Promise<Response> | undefined;

  try {
    uploadResponse = Promise.resolve(
      app.fetch(uploadRequest(rawSessionId), env),
    );
    const { key } = await putEntered.promise;
    const firstDelete = await app.fetch(deleteRequest(rawSessionId), env);
    expect(firstDelete.status).toBe(409);
    expect(await db.select().from(accountDeletions)).toHaveLength(1);
    expect(await db.select().from(accountDeletionTargets)).toHaveLength(1);
    expect((await currentActorState(db, actor.apId))?.deletedAt).toBeNull();
    const puttingAttempt = await attemptRows(db, actor.apId);
    expect(puttingAttempt).toHaveLength(1);
    expect(puttingAttempt[0]).toMatchObject({
      r2Key: key,
      phase: "putting",
      publicKeyPem: actor.publicKeyPem,
    });

    releasePut.resolve();
    const failedUpload = await uploadResponse;
    expect(failedUpload.status).toBe(500);
    expect(media.deletes).toEqual([[key]]);
    expect(media.blobs.has(key)).toBe(true);
    const cleanupAttempt = await attemptRows(db, actor.apId);
    expect(cleanupAttempt).toHaveLength(1);
    expect(cleanupAttempt[0]).toMatchObject({ r2Key: key, phase: "cleanup" });

    const retry = await app.fetch(deleteRequest(rawSessionId), env);
    expect(retry.status).toBe(200);
    expect(media.deletes).toEqual([[key], [key]]);
    expect(media.blobs.has(key)).toBe(false);
    expect(await attemptRows(db, actor.apId)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(mediaUploads)
        .where(eq(mediaUploads.uploaderApId, actor.apId)),
    ).toHaveLength(0);
    expect((await currentActorState(db, actor.apId))?.deletedAt).toBeTruthy();
    expect(await db.select().from(accountDeletions)).toHaveLength(0);
  } finally {
    releasePut.resolve();
    if (uploadResponse) await uploadResponse;
  }
});

test("a normal upload adopts its attempt into media metadata and leaves no attempt", async () => {
  const { db } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-normal-session";
  await seedSession(db, actor.apId, rawSessionId);
  const media = makeMedia();
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(rawSessionId),
    envFor(db, media.storage),
  );

  expect(response.status).toBe(200);
  const body = (await response.json()) as { r2_key: string; id: string };
  expect(body.r2_key).toBe(media.puts[0]);
  expect(body.id).toBeTruthy();
  expect(media.blobs.has(body.r2_key)).toBe(true);
  expect(await attemptRows(db, actor.apId)).toHaveLength(0);
  expect(
    await db
      .select({
        r2Key: mediaUploads.r2Key,
        uploaderApId: mediaUploads.uploaderApId,
      })
      .from(mediaUploads)
      .where(eq(mediaUploads.id, body.id)),
  ).toEqual([{ r2Key: body.r2_key, uploaderApId: actor.apId }]);
});

test("a put that writes then rejects is compensated before its attempt is cleared", async () => {
  const { db } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-put-failure-session";
  await seedSession(db, actor.apId, rawSessionId);
  const media = makeMedia({
    async onPut(key, value) {
      media.blobs.set(key, value);
      throw new Error("provider rejected after accepting bytes");
    },
  });
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(rawSessionId),
    envFor(db, media.storage),
  );

  expect(response.status).toBe(500);
  expect(media.puts).toHaveLength(1);
  expect(media.deletes).toEqual([[media.puts[0]!]]);
  expect(media.blobs.has(media.puts[0]!)).toBe(false);
  expect(await attemptRows(db, actor.apId)).toHaveLength(0);
  expect(await db.select().from(mediaUploads)).toHaveLength(0);
});

test("a failed DB transition keeps the upload attempt as durable retry identity", async () => {
  const { db, client } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-transition-session";
  await seedSession(db, actor.apId, rawSessionId);
  const media = makeMedia();
  await client.executeMultiple(`
    CREATE TRIGGER reject_upload_attempt_transition
    BEFORE UPDATE ON media_upload_attempts
    BEGIN
      SELECT RAISE(ABORT, 'fixture_upload_attempt_transition_failed');
    END;
  `);
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(rawSessionId),
    envFor(db, media.storage),
  );

  expect(response.status).toBe(500);
  expect(media.puts).toHaveLength(1);
  expect(await attemptRows(db, actor.apId)).toHaveLength(1);
  expect((await attemptRows(db, actor.apId))[0]).toMatchObject({
    r2Key: media.puts[0],
    phase: "putting",
  });
  expect(await db.select().from(mediaUploads)).toHaveLength(0);
});

test("a failed attempt registration never starts an object put", async () => {
  const { db, client } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-registration-session";
  await seedSession(db, actor.apId, rawSessionId);
  const media = makeMedia();
  await client.executeMultiple(`
    CREATE TRIGGER reject_upload_attempt_registration
    BEFORE INSERT ON media_upload_attempts
    BEGIN
      SELECT RAISE(ABORT, 'fixture_upload_attempt_registration_failed');
    END;
  `);
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(rawSessionId),
    envFor(db, media.storage),
  );

  expect(response.status).toBe(500);
  expect(media.puts).toHaveLength(0);
  expect(media.deletes).toHaveLength(0);
  expect(await attemptRows(db, actor.apId)).toHaveLength(0);
  expect(await db.select().from(mediaUploads)).toHaveLength(0);
});

test("request admission rejects a reserved actor before an object put starts", async () => {
  const { db } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-admission-session";
  await seedSession(db, actor.apId, rawSessionId);
  const operationId = "reserved-before-upload";
  await db.insert(accountDeletions).values({
    id: operationId,
    rootActorApId: actor.apId,
    rootPublicKeyPem: actor.publicKeyPem,
    workerToken: "reserved-before-upload-worker",
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await db.insert(accountDeletionTargets).values({
    actorApId: actor.apId,
    operationId,
    publicKeyPem: actor.publicKeyPem,
    followersUrl: actor.followersUrl,
    deleteActivityApId: `${APP_URL}/ap/activities/reserved-before-upload`,
    cascadeComplete: false,
  });
  const media = makeMedia();
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(rawSessionId),
    envFor(db, media.storage),
  );

  expect(response.status).toBe(409);
  expect(media.puts).toHaveLength(0);
  expect(await attemptRows(db, actor.apId)).toHaveLength(0);
  expect(await db.select().from(mediaUploads)).toHaveLength(0);
});

test("an old putting attempt is not expired by a deletion retry", async () => {
  const { db } = await createTestDb();
  const actor = await createOwner(db);
  const rawSessionId = "upload-reservation-old-attempt-session";
  await seedSession(db, actor.apId, rawSessionId);
  await db.insert(mediaUploadAttempts).values({
    id: "old-putting-attempt",
    r2Key: "uploads/old-putting.webm",
    uploaderApId: actor.apId,
    publicKeyPem: actor.publicKeyPem,
    phase: "putting",
    createdAt: "2000-01-01T00:00:00.000Z",
  });
  let deletes = 0;
  const media = makeMedia({
    async onDelete() {
      deletes += 1;
    },
  });
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    deleteRequest(rawSessionId),
    envFor(db, media.storage),
  );

  expect(response.status).toBe(409);
  expect(deletes).toBe(0);
  expect(await attemptRows(db, actor.apId)).toEqual([
    expect.objectContaining({
      id: "old-putting-attempt",
      r2Key: "uploads/old-putting.webm",
      phase: "putting",
      createdAt: "2000-01-01T00:00:00.000Z",
    }),
  ]);
  expect(await db.select().from(accountDeletionTargets)).toHaveLength(1);
  expect((await currentActorState(db, actor.apId))?.deletedAt).toBeNull();
});
