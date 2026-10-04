import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  actors,
  communities,
  mediaBlobDeletionJobs,
  mediaUploadAttempts,
  mediaUploadLifetimes,
  mediaUploads,
  objects,
  sessions,
  type Database,
} from "../../../db/index.ts";
import { mediaReferenceError } from "../../lib/errors.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { claimExpiredStagedMedia } from "../../lib/staged-media-retention.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import {
  createYurucommuBackendApp,
  runYurucommuRetention,
} from "../../public.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import type { Env } from "../../types.ts";
import { createTestDb, readMigration } from "../helpers/d1-semantics.ts";

const APP_URL = "https://staged-media-fence.test";
const SESSION_SALT = "staged-media-fence-session-salt";
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1_000;
const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1_000;
const WEBM_BYTES = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01]);
const FUTURE = "2099-01-01T00:00:00.000Z";

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

function storage() {
  const blobs = new Map<string, unknown>();
  const deletes: string[] = [];
  const media: ObjectStore = {
    async put(key, value) {
      blobs.set(key, value);
    },
    async get(key) {
      const value = blobs.get(key);
      return value === undefined ? null : ({ body: value } as never);
    },
    async delete(value) {
      const keys = typeof value === "string" ? [value] : [...value];
      for (const key of keys) {
        deletes.push(key);
        blobs.delete(key);
      }
    },
  };
  return { media, blobs, deletes };
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
  const objects = storage();
  const env = envFor(db, objects.media);
  const actor = await createActor(db, env, {
    username: `fence-${crypto.randomUUID().slice(0, 8)}`,
    name: "Fence owner",
    takosUserId: `password:${crypto.randomUUID()}`,
    role: "owner",
  });
  const rawSessionId = `fence-session-${crypto.randomUUID()}`;
  const sessionId = await hashSessionIdForEnv(env, rawSessionId);
  await db.insert(sessions).values({
    id: sessionId,
    memberId: actor.apId,
    accessToken: sessionId,
    expiresAt: FUTURE,
    provider: null,
  });
  return { db, actor, env, media: objects, rawSessionId };
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

function profileRequest(
  rawSessionId: string,
  body: Record<string, unknown>,
): Request {
  return new Request(`${APP_URL}/api/actors/me`, {
    method: "PUT",
    headers: {
      cookie: `session=${rawSessionId}`,
      origin: APP_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function upload(state: Awaited<ReturnType<typeof setup>>) {
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    uploadRequest(state.rawSessionId),
    state.env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    id: string;
    r2_key: string;
    url: string;
    expires_at: string;
  };
}

async function atTime<T>(run: (advance: (ms: number) => void) => Promise<T>) {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    return await run((ms) => {
      now += ms;
    });
  } finally {
    Date.now = originalNow;
  }
}

async function rejectWithMediaError<T>(promise: PromiseLike<T>): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    throw mediaReferenceError(error) ?? error;
  }
}

async function lifetime(db: Database, key: string) {
  return db
    .select()
    .from(mediaUploadLifetimes)
    .where(eq(mediaUploadLifetimes.r2Key, key))
    .get();
}

async function expireAndCollect(
  state: Awaited<ReturnType<typeof setup>>,
  advance: (ms: number) => void,
  ms = EIGHT_DAYS_MS,
) {
  advance(ms);
  await runYurucommuRetention(state.env);
}

async function assertStillPublished(
  state: Awaited<ReturnType<typeof setup>>,
  key: string,
) {
  expect((await lifetime(state.db, key))?.state).toBe("published");
  expect(state.media.blobs.has(key)).toBe(true);
  expect(state.media.deletes).not.toContain(key);
  expect(
    await state.db
      .select({ r2Key: mediaBlobDeletionJobs.r2Key })
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, key)),
  ).toHaveLength(0);
}

test("new upload lifetime is seven days while legacy rows remain outside the lifecycle", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    expect(uploaded.r2_key).toMatch(/^uploads\/[a-f0-9]{64}\.webm$/);
    expect(uploaded.url).toMatch(/^\/media\/[a-f0-9]{64}\.webm$/);
    const created = await lifetime(state.db, uploaded.r2_key);
    expect(created).toMatchObject({
      r2Key: uploaded.r2_key,
      uploadId: uploaded.id,
      uploaderApId: state.actor.apId,
      publicKeyPem: state.actor.publicKeyPem,
      state: "staged",
    });
    expect(
      Date.parse(created!.expiresAt) - Date.parse(created!.createdAt),
    ).toBe(SEVEN_DAYS_MS);
    expect(uploaded.expires_at).toBe(created!.expiresAt);

    const legacyKey = "uploads/legacy-no-lifetime.png";
    await state.db.insert(mediaUploads).values({
      id: "legacy-no-lifetime",
      r2Key: legacyKey,
      uploaderApId: state.actor.apId,
      contentType: "image/png",
      size: 3,
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    state.media.blobs.set(legacyKey, new Uint8Array([1, 2, 3]));

    await expireAndCollect(state, advance);

    expect(await lifetime(state.db, legacyKey)).toBeUndefined();
    expect(state.media.blobs.has(legacyKey)).toBe(true);
    expect(state.media.deletes).not.toContain(legacyKey);
    expect(await lifetime(state.db, uploaded.r2_key)).toMatchObject({
      state: "deleting",
    });
    expect(state.media.deletes).toContain(uploaded.r2_key);
  });
});

test("an upload remains publishable before expiry and publication defeats a stale collection pass", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    advance(SEVEN_DAYS_MS - 1);
    const response = await createYurucommuBackendApp({
      singleOwner: true,
    }).fetch(
      profileRequest(state.rawSessionId, {
        icon_url: `/media/${uploaded.r2_key.slice("uploads/".length)}`,
      }),
      state.env,
    );
    expect(response.status).toBe(200);
    await expireAndCollect(state, advance, 2);
    await assertStillPublished(state, uploaded.r2_key);
  });
});

test("the database claim selects only expired staged lifetimes and excludes published references", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const staged = await upload(state);
    const published = await upload(state);
    await state.db
      .update(actors)
      .set({ iconUrl: `/media/${published.r2_key.slice("uploads/".length)}` })
      .where(eq(actors.apId, state.actor.apId));

    expect(await claimExpiredStagedMedia(state.db)).toBe(0);
    advance(SEVEN_DAYS_MS - 1);
    expect(await claimExpiredStagedMedia(state.db)).toBe(0);
    expect((await lifetime(state.db, staged.r2_key))?.state).toBe("staged");

    advance(2);
    expect(await claimExpiredStagedMedia(state.db)).toBe(1);
    expect((await lifetime(state.db, staged.r2_key))?.state).toBe("deleting");
    expect((await lifetime(state.db, published.r2_key))?.state).toBe(
      "published",
    );
    expect(state.media.deletes).toHaveLength(0);
    expect(
      await state.db
        .select({ r2Key: mediaBlobDeletionJobs.r2Key })
        .from(mediaBlobDeletionJobs)
        .where(eq(mediaBlobDeletionJobs.r2Key, staged.r2_key)),
    ).toHaveLength(1);
  });
});

test("lifetime tombstones reject state replay, metadata replay, and upload-attempt key reuse", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    const original = await lifetime(state.db, uploaded.r2_key);
    await expireAndCollect(state, advance);

    expect(await lifetime(state.db, uploaded.r2_key)).toMatchObject({
      state: "deleting",
      r2Key: uploaded.r2_key,
      uploadId: uploaded.id,
    });
    await expect(
      rejectWithMediaError(
        state.db
          .update(mediaUploadLifetimes)
          .set({ state: "staged" })
          .where(eq(mediaUploadLifetimes.r2Key, uploaded.r2_key)),
      ),
    ).rejects.toThrow(/Attachment expired/i);
    await expect(
      rejectWithMediaError(
        state.db
          .delete(mediaUploadLifetimes)
          .where(eq(mediaUploadLifetimes.r2Key, uploaded.r2_key)),
      ),
    ).rejects.toThrow(/Attachment expired/i);
    await expect(
      rejectWithMediaError(
        state.db.insert(mediaUploadLifetimes).values({
          ...original!,
          state: "staged",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      rejectWithMediaError(
        state.db.insert(mediaUploadAttempts).values({
          id: uploaded.id,
          r2Key: uploaded.r2_key,
          uploaderApId: state.actor.apId,
          publicKeyPem: state.actor.publicKeyPem,
          phase: "putting",
          createdAt: new Date().toISOString(),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      rejectWithMediaError(
        state.db.insert(mediaUploads).values({
          id: uploaded.id,
          r2Key: uploaded.r2_key,
          uploaderApId: state.actor.apId,
          contentType: "video/webm",
          size: WEBM_BYTES.byteLength,
        }),
      ),
    ).rejects.toThrow();
  });
});

test("a late SQL profile or object reference is rejected after an expiry claim", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    await expireAndCollect(state, advance);
    const mediaUrl = `/media/${uploaded.r2_key.slice("uploads/".length)}`;

    await expect(
      rejectWithMediaError(
        state.db
          .update(actors)
          .set({ iconUrl: mediaUrl })
          .where(eq(actors.apId, state.actor.apId)),
      ),
    ).rejects.toThrow(/Attachment expired/i);
    await expect(
      rejectWithMediaError(
        state.db.insert(objects).values({
          apId: `${state.actor.apId}/objects/late-ref-${crypto.randomUUID()}`,
          type: "Note",
          attributedTo: state.actor.apId,
          content: "late reference",
          attachmentsJson: JSON.stringify([{ url: mediaUrl }]),
          published: new Date().toISOString(),
          isLocal: 1,
        }),
      ),
    ).rejects.toThrow(/Attachment expired/i);
    expect(state.media.blobs.has(uploaded.r2_key)).toBe(false);
  });
});

test("collected staged media rejects new profile and post references with HTTP 409", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    await expireAndCollect(state, advance);
    const mediaUrl = `/media/${uploaded.r2_key.slice("uploads/".length)}`;
    const app = createYurucommuBackendApp({ singleOwner: true });

    const profileResponse = await app.fetch(
      profileRequest(state.rawSessionId, { icon_url: mediaUrl }),
      state.env,
    );
    expect(profileResponse.status).toBe(409);
    const postResponse = await app.fetch(
      new Request(`${APP_URL}/api/posts`, {
        method: "POST",
        headers: {
          cookie: `session=${state.rawSessionId}`,
          origin: APP_URL,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          content: "expired attachment",
          attachments: [
            { type: "Image", url: mediaUrl, r2_key: uploaded.r2_key },
          ],
        }),
      }),
      state.env,
    );
    expect(postResponse.status).toBe(409);
    expect((await lifetime(state.db, uploaded.r2_key))?.state).toBe("deleting");
    expect(state.media.blobs.has(uploaded.r2_key)).toBe(false);
    expect(
      await state.db
        .select({ apId: objects.apId })
        .from(objects)
        .where(eq(objects.attributedTo, state.actor.apId)),
    ).toHaveLength(0);
  });
});

test("a reference written before expiry publishes the lifetime atomically", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    await state.db
      .update(actors)
      .set({ headerUrl: `/media/${uploaded.r2_key.slice("uploads/".length)}` })
      .where(eq(actors.apId, state.actor.apId));

    expect((await lifetime(state.db, uploaded.r2_key))?.state).toBe(
      "published",
    );
    await expireAndCollect(state, advance);
    await assertStillPublished(state, uploaded.r2_key);
  });
});

const referenceSurfaces = [
  {
    name: "actor icon URL",
    async write(state: Awaited<ReturnType<typeof setup>>, key: string) {
      await state.db
        .update(actors)
        .set({ iconUrl: `/media/${key.slice("uploads/".length)}` })
        .where(eq(actors.apId, state.actor.apId));
    },
  },
  {
    name: "actor header URL",
    async write(state: Awaited<ReturnType<typeof setup>>, key: string) {
      await state.db
        .update(actors)
        .set({ headerUrl: `/media/${key.slice("uploads/".length)}` })
        .where(eq(actors.apId, state.actor.apId));
    },
  },
  ...["Note", "Story", "DM", "community chat Note"].map((type) => ({
    name: `object ${type} attachment`,
    async write(state: Awaited<ReturnType<typeof setup>>, key: string) {
      const mediaUrl = `/media/${key.slice("uploads/".length)}`;
      await state.db.insert(objects).values({
        apId: `${state.actor.apId}/objects/${crypto.randomUUID()}`,
        type: type === "community chat Note" ? "Note" : type,
        attributedTo: state.actor.apId,
        content: "",
        attachmentsJson: JSON.stringify([
          { type: "Document", url: mediaUrl, r2_key: key },
        ]),
        published: new Date().toISOString(),
        isLocal: 1,
        visibility: type === "DM" ? "direct" : "public",
        conversation:
          type === "DM" ? `conversation-${crypto.randomUUID()}` : null,
      });
    },
  })),
  {
    name: "community icon URL",
    async write(state: Awaited<ReturnType<typeof setup>>, key: string) {
      const communityId = `${APP_URL}/ap/communities/${crypto.randomUUID()}`;
      await state.db.insert(communities).values({
        apId: communityId,
        preferredUsername: `community-${crypto.randomUUID().slice(0, 8)}`,
        name: "Community media reference",
        iconUrl: `/media/${key.slice("uploads/".length)}`,
        inbox: `${communityId}/inbox`,
        outbox: `${communityId}/outbox`,
        followersUrl: `${communityId}/followers`,
        publicKeyPem: "community-public-key",
        privateKeyPem: "community-private-key",
        createdBy: state.actor.apId,
      });
    },
  },
] as const;

for (const surface of referenceSurfaces) {
  test(`an independent ${surface.name} reference protects its upload`, async () => {
    const state = await setup();
    await atTime(async (advance) => {
      const uploaded = await upload(state);
      await surface.write(state, uploaded.r2_key);
      expect((await lifetime(state.db, uploaded.r2_key))?.state).toBe(
        "published",
      );
      await expireAndCollect(state, advance);
      await assertStillPublished(state, uploaded.r2_key);
    });
  });
}

const markerForms: {
  name: string;
  value: (key: string, url: string) => unknown;
  escapeSlashes?: boolean;
}[] = [
  {
    name: "nested reference object",
    value: (key: string, url: string) => ({ attachment: { r2_key: key, url } }),
  },
  {
    name: "JSON escaped slash URL and key",
    value: (key: string, url: string) => ({ attachment: { r2_key: key, url } }),
    escapeSlashes: true,
  },
  {
    name: "absolute URL with query and fragment",
    value: (_key: string, url: string) => ({
      url: `${APP_URL}${url}?size=large#preview`,
    }),
  },
  {
    name: "foreign-origin URL with the exact uploaded filename",
    value: (_key: string, url: string) => ({
      url: `https://foreign.test${url}`,
    }),
  },
  {
    name: "percent-encoded URL",
    value: (_key: string, url: string) => ({
      url: encodeURI(`${APP_URL}${url}`),
    }),
  },
  {
    name: "double-encoded URL",
    value: (_key: string, url: string) => ({
      url: encodeURIComponent(encodeURIComponent(url)),
    }),
  },
  {
    name: "embedded media marker in ordinary text",
    value: (key: string, url: string) => ({
      caption: `quoted ${key} and ${url} in text`,
    }),
  },
  {
    name: "marker used as a JSON key",
    value: (key: string, _url: string) => ({ [key]: "opaque metadata" }),
  },
  {
    name: "multiple media markers in one object",
    value: (key: string, url: string) => ({
      images: [{ r2_key: key }, { url }],
    }),
  },
  {
    name: "Unicode adjacent to marker",
    value: (key: string, url: string) => ({
      caption: `画像📷前後${key}—${url}`,
    }),
  },
] as const;

for (const form of markerForms) {
  test(`an object reference survives ${form.name}`, async () => {
    const state = await setup();
    await atTime(async (advance) => {
      const uploaded = await upload(state);
      const url = `/media/${uploaded.r2_key.slice("uploads/".length)}`;
      let serialized = JSON.stringify(form.value(uploaded.r2_key, url));
      if (form.escapeSlashes) serialized = serialized.replaceAll("/", "\\/");
      await state.db.insert(objects).values({
        apId: `${state.actor.apId}/objects/${crypto.randomUUID()}`,
        type: "Note",
        attributedTo: state.actor.apId,
        content: "reference encoding",
        attachmentsJson: serialized,
        published: new Date().toISOString(),
        isLocal: 1,
      });
      await expireAndCollect(state, advance);
      await assertStillPublished(state, uploaded.r2_key);
    });
  });
}

test("foreign-origin text without an exact supported filename is not a reference", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    await state.db.insert(objects).values({
      apId: `${state.actor.apId}/objects/foreign-origin-lookalike`,
      type: "Note",
      attributedTo: state.actor.apId,
      content: "foreign URL contains a similar path",
      attachmentsJson: JSON.stringify({
        url: `https://foreign.test/media/${"f".repeat(64)}.txt`,
      }),
      published: new Date().toISOString(),
      isLocal: 1,
    });
    await expireAndCollect(state, advance);

    expect(await lifetime(state.db, uploaded.r2_key)).toMatchObject({
      state: "deleting",
    });
    expect(state.media.blobs.has(uploaded.r2_key)).toBe(false);
    expect(state.media.deletes).toContain(uploaded.r2_key);
  });
});

test("four supported URL decoding passes resolve an existing media reference", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    let encodedUrl = [...`/media/${uploaded.r2_key.slice("uploads/".length)}`]
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("");
    for (let pass = 1; pass < 4; pass += 1) {
      encodedUrl = encodeURIComponent(encodedUrl);
    }
    await state.db.insert(objects).values({
      apId: `${state.actor.apId}/objects/four-decode-${crypto.randomUUID()}`,
      type: "Note",
      attributedTo: state.actor.apId,
      content: "four-level encoded reference",
      attachmentsJson: JSON.stringify({ url: encodedUrl }),
      published: new Date().toISOString(),
      isLocal: 1,
    });
    await expireAndCollect(state, advance);
    await assertStillPublished(state, uploaded.r2_key);
  });
});

test("over-depth encoded new references fail closed before collection", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    const uploaded = await upload(state);
    let encodedUrl = [...`/media/${uploaded.r2_key.slice("uploads/".length)}`]
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("");
    for (let pass = 1; pass < 5; pass += 1) {
      encodedUrl = encodeURIComponent(encodedUrl);
    }
    await expect(
      rejectWithMediaError(
        state.db.insert(objects).values({
          apId: `${state.actor.apId}/objects/over-depth-${crypto.randomUUID()}`,
          type: "Note",
          attributedTo: state.actor.apId,
          content: "over-depth encoded reference",
          attachmentsJson: JSON.stringify({ url: encodedUrl }),
          published: new Date().toISOString(),
          isLocal: 1,
        }),
      ),
    ).rejects.toThrow(/cannot be normalized safely/i);
    await expireAndCollect(state, advance);

    expect(await lifetime(state.db, uploaded.r2_key)).toMatchObject({
      state: "deleting",
    });
    expect(state.media.blobs.has(uploaded.r2_key)).toBe(false);
    expect(state.media.deletes).toContain(uploaded.r2_key);
  });
});

test("migration leaves legacy media rows untouched and does not backfill lifetimes", async () => {
  const { db, client } = await createTestDb({
    through: "0033_delivery_reconciliation.sql",
  });
  const legacy = {
    id: "pre-lifetime-legacy-upload",
    r2Key: "uploads/pre-lifetime-legacy.jpg",
    uploaderApId: `${APP_URL}/ap/users/migration-owner`,
    contentType: "image/jpeg",
    size: 123,
    createdAt: "2001-01-01T00:00:00.000Z",
  };
  await db.insert(mediaUploads).values(legacy);
  const migration = await readMigration("0034_staged_media_retention.sql");
  await client.executeMultiple(migration);

  expect(await db.select().from(mediaUploads)).toEqual([legacy]);
  expect(await db.select().from(mediaUploadLifetimes)).toHaveLength(0);
});

test("collection claims no more than fifty staged uploads per retention pass", async () => {
  const state = await setup();
  await atTime(async (advance) => {
    for (let index = 0; index < 51; index += 1) {
      const id = String(index).padStart(64, "0");
      const key = `uploads/${id}.webm`;
      await state.db.insert(mediaUploadAttempts).values({
        id,
        r2Key: key,
        uploaderApId: state.actor.apId,
        publicKeyPem: state.actor.publicKeyPem,
        phase: "putting",
        createdAt: "2000-01-01T00:00:00.000Z",
      });
      await state.db
        .update(mediaUploadAttempts)
        .set({ phase: "cleanup" })
        .where(eq(mediaUploadAttempts.id, id));
      await state.db.insert(mediaUploads).values({
        id,
        r2Key: key,
        uploaderApId: state.actor.apId,
        contentType: "video/webm",
        size: WEBM_BYTES.byteLength,
        createdAt: "2000-01-01T00:00:00.000Z",
      });
      await state.db.insert(mediaUploadLifetimes).values({
        r2Key: key,
        uploadId: id,
        uploaderApId: state.actor.apId,
        publicKeyPem: state.actor.publicKeyPem,
        state: "staged",
        createdAt: "2000-01-01T00:00:00.000Z",
        expiresAt: "2000-01-08T00:00:00.000Z",
      });
      await state.db
        .delete(mediaUploadAttempts)
        .where(eq(mediaUploadAttempts.id, id));
      state.media.blobs.set(key, WEBM_BYTES);
    }
    advance(EIGHT_DAYS_MS);

    await runYurucommuRetention(state.env);
    expect(
      await state.db
        .select({ r2Key: mediaUploadLifetimes.r2Key })
        .from(mediaUploadLifetimes)
        .where(eq(mediaUploadLifetimes.state, "deleting")),
    ).toHaveLength(50);
    expect(state.media.deletes).toHaveLength(50);

    await runYurucommuRetention(state.env);
    expect(
      await state.db
        .select({ r2Key: mediaUploadLifetimes.r2Key })
        .from(mediaUploadLifetimes)
        .where(eq(mediaUploadLifetimes.state, "deleting")),
    ).toHaveLength(51);
    expect(state.media.deletes).toHaveLength(51);
  });
});

test("the database envelope preserves Japanese and emoji payloads admitted by attachment limits", async () => {
  const state = await setup();
  const uploaded = await upload(state);
  const payload = JSON.stringify([
    { url: uploaded.url, name: "界".repeat(15_500) + "📷".repeat(100) },
  ]);
  expect(payload.length).toBeLessThanOrEqual(16_384);
  expect(new TextEncoder().encode(payload).length).toBeGreaterThan(16_384);
  await state.db.insert(objects).values({
    apId: `${state.actor.apId}/objects/unicode-envelope`,
    type: "Note",
    attributedTo: state.actor.apId,
    attachmentsJson: payload,
    published: new Date().toISOString(),
    isLocal: 1,
  });
  expect((await lifetime(state.db, uploaded.r2_key))?.state).toBe("published");
});

for (const [label, payload] of [
  ["oversized", JSON.stringify({ text: "x".repeat(16_384) })],
  ["dense dot search", JSON.stringify({ text: ".".repeat(257) })],
  ["wide JSON tree", JSON.stringify(Array.from({ length: 256 }, () => "%"))],
  ["embedded NUL", JSON.stringify({ url: "before\u0000after" })],
] as const) {
  test(`a ${label} source is refused atomically`, async () => {
    const state = await setup();
    const id = `${state.actor.apId}/objects/bounded-input`;
    await expect(
      rejectWithMediaError(
        state.db.insert(objects).values({
          apId: id,
          type: "Note",
          attributedTo: state.actor.apId,
          attachmentsJson: payload,
          published: new Date().toISOString(),
          isLocal: 1,
        }),
      ),
    ).rejects.toThrow(/cannot be normalized safely/i);
    expect(
      await state.db.select().from(objects).where(eq(objects.apId, id)),
    ).toHaveLength(0);
  });
}

test("a long source at the dot-search boundary still publishes its referenced media", async () => {
  const state = await setup();
  const uploaded = await upload(state);
  const payload = JSON.stringify({
    url: uploaded.url,
    text: ".".repeat(253) + "x".repeat(15_000),
  });
  await state.db.insert(objects).values({
    apId: `${state.actor.apId}/objects/dot-boundary`,
    type: "Note",
    attributedTo: state.actor.apId,
    attachmentsJson: payload,
    published: new Date().toISOString(),
    isLocal: 1,
  });
  expect((await lifetime(state.db, uploaded.r2_key))?.state).toBe("published");
});
