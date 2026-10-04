import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  actors,
  mediaBlobDeletionJobs,
  mediaUploadAttempts,
  mediaUploads,
  objects,
  sessions,
  type Database,
} from "../../../db/index.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import {
  createYurucommuBackendApp,
  runYurucommuRetention,
} from "../../public.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import type { Env } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://staged-media-retention.test";
const SESSION_SALT = "staged-media-retention-session-salt";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1_000;
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);

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

function makeMedia(options?: {
  onDelete?: (keys: readonly string[]) => Promise<void>;
}) {
  const blobs = new Map<string, unknown>();
  const puts: string[] = [];
  const deletes: string[][] = [];
  const storage: ObjectStore = {
    async put(key, value) {
      puts.push(key);
      blobs.set(key, value);
    },
    async get(key) {
      const value = blobs.get(key);
      return value === undefined ? null : ({ body: value } as never);
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

async function setup() {
  const { db } = await createTestDb();
  const media = makeMedia();
  const env = envFor(db, media.storage);
  const actor = await createActor(db, env, {
    username: `staged-media-${crypto.randomUUID().slice(0, 8)}`,
    name: "Staged media owner",
    takosUserId: `password:${crypto.randomUUID()}`,
    role: "owner",
  });
  const rawSessionId = `staged-media-session-${crypto.randomUUID()}`;
  const sessionId = await hashSessionIdForEnv(env, rawSessionId);
  await db.insert(sessions).values({
    id: sessionId,
    memberId: actor.apId,
    accessToken: sessionId,
    // Keep the session valid while the test advances only the retention clock.
    expiresAt: "2099-01-01T00:00:00.000Z",
    provider: null,
  });
  return { db, actor, env, media, rawSessionId };
}

function uploadRequest(rawSessionId: string): Request {
  const form = new FormData();
  form.set("file", new File([WEBM_BYTES], "clip.webm", { type: "video/webm" }));
  return new Request(`${APP_URL}/api/media/upload`, {
    method: "POST",
    headers: { cookie: `session=${rawSessionId}`, origin: APP_URL },
    body: form,
  });
}

function profileRequest(rawSessionId: string, iconUrl: string): Request {
  return new Request(`${APP_URL}/api/actors/me`, {
    method: "PUT",
    headers: {
      cookie: `session=${rawSessionId}`,
      origin: APP_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify({ icon_url: iconUrl }),
  });
}

async function upload(setupState: Awaited<ReturnType<typeof setup>>) {
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(setupState.rawSessionId),
    setupState.env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    r2_key: string;
    id: string;
    expires_at?: string;
  };
}

async function runAt<T>(
  initialTime: number,
  run: (advance: (ms: number) => void) => Promise<T>,
) {
  const originalNow = Date.now;
  let now = initialTime;
  Date.now = () => now;
  try {
    return await run((ms) => {
      now += ms;
    });
  } finally {
    Date.now = originalNow;
  }
}

async function uploadRows(db: Database, key: string) {
  return db
    .select({ id: mediaUploads.id, r2Key: mediaUploads.r2Key })
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, key));
}

test("a successful upload discloses an expiry seven days after upload", async () => {
  const state = await setup();
  await runAt(Date.now(), async () => {
    const uploadedAt = Date.now();
    const body = await upload(state);

    expect(body.expires_at).toBeDefined();
    const expiresAt = Date.parse(body.expires_at!);
    expect(Number.isFinite(expiresAt)).toBe(true);
    expect(
      Math.abs(expiresAt - (uploadedAt + SEVEN_DAYS_MS)),
    ).toBeLessThanOrEqual(1_000);
    expect(state.media.blobs.has(body.r2_key)).toBe(true);
  });
});

test("retention keeps an unreferenced upload before its seven-day expiry", async () => {
  const state = await setup();
  await runAt(Date.now(), async (advance) => {
    const body = await upload(state);
    advance(SEVEN_DAYS_MS - 1);

    await runYurucommuRetention(state.env);

    expect(await uploadRows(state.db, body.r2_key)).toHaveLength(1);
    expect(state.media.blobs.has(body.r2_key)).toBe(true);
    expect(state.media.deletes).not.toContainEqual([body.r2_key]);
  });
});

test("retention removes a successful upload that stayed unreferenced for eight days", async () => {
  const state = await setup();
  await runAt(Date.now(), async (advance) => {
    const body = await upload(state);
    advance(EIGHT_DAYS_MS);

    await runYurucommuRetention(state.env);

    expect(await uploadRows(state.db, body.r2_key)).toHaveLength(0);
    expect(state.media.blobs.has(body.r2_key)).toBe(false);
    expect(state.media.deletes).toContainEqual([body.r2_key]);
  });
});

test("retention preserves legacy uploads and uploads referenced by profile, Story, and DM data", async () => {
  const state = await setup();
  await runAt(Date.now(), async (advance) => {
    const body = await upload(state);
    const legacyKey = "uploads/legacy-without-expiry.png";
    state.media.blobs.set(legacyKey, new Uint8Array([1, 2, 3]));
    await state.db.insert(mediaUploads).values({
      id: "legacy-upload-without-expiry",
      r2Key: legacyKey,
      uploaderApId: state.actor.apId,
      contentType: "image/png",
      size: 3,
      createdAt: "2000-01-01T00:00:00.000Z",
    });

    const mediaUrl = `/media/${body.r2_key.slice("uploads/".length)}`;
    await state.db
      .update(actors)
      .set({ iconUrl: mediaUrl })
      .where(eq(actors.apId, state.actor.apId));
    await state.db.insert(objects).values([
      {
        apId: `${state.actor.apId}/objects/story-media-ref`,
        type: "Story",
        attributedTo: state.actor.apId,
        content: "",
        attachmentsJson: JSON.stringify({
          attachment: { r2_key: body.r2_key, url: mediaUrl },
        }),
        published: new Date().toISOString(),
        isLocal: 1,
        endTime: "2099-01-01T00:00:00.000Z",
      },
      {
        apId: `${state.actor.apId}/objects/dm-media-ref`,
        type: "Note",
        attributedTo: state.actor.apId,
        content: "",
        attachmentsJson: JSON.stringify([
          { attachment: { r2_key: body.r2_key, url: mediaUrl } },
        ]),
        published: new Date().toISOString(),
        isLocal: 1,
        visibility: "direct",
        toJson: "[]",
        ccJson: "[]",
        conversation: "staged-media-dm-ref",
      },
    ]);

    advance(EIGHT_DAYS_MS);
    await runYurucommuRetention(state.env);

    expect(await uploadRows(state.db, body.r2_key)).toHaveLength(1);
    expect(state.media.blobs.has(body.r2_key)).toBe(true);
    expect(await uploadRows(state.db, legacyKey)).toHaveLength(1);
    expect(state.media.blobs.has(legacyKey)).toBe(true);
    expect(state.media.deletes).not.toContainEqual([body.r2_key]);
    expect(state.media.deletes).not.toContainEqual([legacyKey]);
  });
});

test("a failed claimed-object delete remains retryable on a later retention pass", async () => {
  const state = await setup();
  let failDelete = true;
  state.media.storage = {
    ...state.media.storage,
    async delete(value) {
      const keys = typeof value === "string" ? [value] : [...value];
      state.media.deletes.push(keys);
      if (failDelete) {
        failDelete = false;
        throw new Error("temporary object store outage");
      }
      for (const key of keys) state.media.blobs.delete(key);
    },
  } as ObjectStore;
  state.env.MEDIA = state.media.storage;

  await runAt(Date.now(), async (advance) => {
    const body = await upload(state);
    advance(EIGHT_DAYS_MS);

    await expect(runYurucommuRetention(state.env)).rejects.toThrow();
    expect(state.media.deletes).toContainEqual([body.r2_key]);
    expect(state.media.blobs.has(body.r2_key)).toBe(true);
    expect(
      await state.db
        .select({ r2Key: mediaBlobDeletionJobs.r2Key })
        .from(mediaBlobDeletionJobs)
        .where(eq(mediaBlobDeletionJobs.r2Key, body.r2_key)),
    ).toEqual([{ r2Key: body.r2_key }]);

    advance(60_001);
    await runYurucommuRetention(state.env);
    expect(state.media.deletes).toContainEqual([body.r2_key]);
    expect(state.media.blobs.has(body.r2_key)).toBe(false);
    expect(
      await state.db
        .select({ r2Key: mediaBlobDeletionJobs.r2Key })
        .from(mediaBlobDeletionJobs)
        .where(eq(mediaBlobDeletionJobs.r2Key, body.r2_key)),
    ).toHaveLength(0);
  });
});

test("a late profile reference fails after collection claims an expired upload", async () => {
  const state = await setup();
  const enteredDelete = deferred<readonly string[]>();
  const releaseDelete = deferred();
  state.media.storage = {
    ...state.media.storage,
    async delete(value) {
      const keys = typeof value === "string" ? [value] : [...value];
      state.media.deletes.push(keys);
      enteredDelete.resolve(keys);
      await releaseDelete.promise;
      for (const key of keys) state.media.blobs.delete(key);
    },
  } as ObjectStore;
  state.env.MEDIA = state.media.storage;

  await runAt(Date.now(), async (advance) => {
    const body = await upload(state);
    advance(EIGHT_DAYS_MS);
    const retention = runYurucommuRetention(state.env);

    try {
      expect(
        await Promise.race([
          enteredDelete.promise,
          retention.then(() => {
            throw new Error(
              "retention finished without claiming expired upload",
            );
          }),
        ]),
      ).toContain(body.r2_key);
      const response = await createYurucommuBackendApp({
        singleOwner: true,
      }).fetch(
        profileRequest(
          state.rawSessionId,
          `/media/${body.r2_key.slice("uploads/".length)}`,
        ),
        state.env,
      );

      expect(response.status).toBe(409);
      const updatedActor = await state.db
        .select({ iconUrl: actors.iconUrl })
        .from(actors)
        .where(eq(actors.apId, state.actor.apId))
        .get();
      expect(updatedActor?.iconUrl).toBeNull();
    } finally {
      releaseDelete.resolve();
      await retention;
    }
  });
});

test("an old putting attempt remains present through staged-upload retention", async () => {
  const state = await setup();
  const key = "uploads/old-still-putting.webm";
  state.media.blobs.set(key, WEBM_BYTES);
  await state.db.insert(mediaUploadAttempts).values({
    id: "old-still-putting-attempt",
    r2Key: key,
    uploaderApId: state.actor.apId,
    publicKeyPem: state.actor.publicKeyPem,
    phase: "putting",
    createdAt: "2000-01-01T00:00:00.000Z",
  });

  await runAt(Date.now(), async (advance) => {
    advance(EIGHT_DAYS_MS);
    await runYurucommuRetention(state.env);

    const attempt = await state.db
      .select({ id: mediaUploadAttempts.id, phase: mediaUploadAttempts.phase })
      .from(mediaUploadAttempts)
      .where(eq(mediaUploadAttempts.id, "old-still-putting-attempt"));
    expect(attempt).toEqual([
      { id: "old-still-putting-attempt", phase: "putting" },
    ]);
    expect(state.media.blobs.has(key)).toBe(true);
    expect(state.media.deletes).not.toContainEqual([key]);
  });
});
