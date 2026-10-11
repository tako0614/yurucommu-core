import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  actors,
  communities,
  communityMembers,
  mediaBlobDeletionClaims,
  mediaBlobDeletionJobs,
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

function makeMedia() {
  const blobs = new Map<string, unknown>();
  const storage: ObjectStore = {
    async put(key, value) {
      blobs.set(key, value);
    },
    async get(key) {
      const value = blobs.get(key);
      return value === undefined ? null : ({ body: value } as never);
    },
    async delete(value) {
      const keys = typeof value === "string" ? [value] : [...value];
      for (const key of keys) blobs.delete(key);
    },
  };
  return { storage, blobs };
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
    // Keep the session valid throughout each route and retention call.
    expiresAt: "2099-01-01T00:00:00.000Z",
    provider: null,
  });
  return { db, actor, env, media, rawSessionId };
}

async function addActorSession(
  state: Awaited<ReturnType<typeof setup>>,
  username: string,
) {
  const actor = await createActor(state.db, state.env, {
    username,
    name: username,
    takosUserId: `password:${crypto.randomUUID()}`,
    role: "member",
  });
  const rawSessionId = `session-${crypto.randomUUID()}`;
  const sessionId = await hashSessionIdForEnv(state.env, rawSessionId);
  await state.db.insert(sessions).values({
    id: sessionId,
    memberId: actor.apId,
    accessToken: sessionId,
    expiresAt: "2099-01-01T00:00:00.000Z",
    provider: null,
  });
  return { actor, rawSessionId };
}

async function seedCommunity(
  state: Awaited<ReturnType<typeof setup>>,
  username: string,
  ownerApId: string,
  moderators: string[] = [],
) {
  const apId = `${APP_URL}/ap/communities/${username}`;
  await state.db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "community-public-key",
    privateKeyPem: "community-private-key",
    createdBy: ownerApId,
    memberCount: 1 + moderators.length,
  });
  await state.db.insert(communityMembers).values([
    { communityApId: apId, actorApId: ownerApId, role: "owner" },
    ...moderators.map((actorApId) => ({
      communityApId: apId,
      actorApId,
      role: "moderator",
    })),
  ]);
  return apId;
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

function postRequest(
  rawSessionId: string,
  attachments: Record<string, unknown>[],
): Request {
  return new Request(`${APP_URL}/api/posts`, {
    method: "POST",
    headers: {
      cookie: `session=${rawSessionId}`,
      origin: APP_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify({ content: "media fence regression", attachments }),
  });
}

function deletePostRequest(rawSessionId: string, apId: string): Request {
  return new Request(`${APP_URL}/api/posts/${encodeURIComponent(apId)}`, {
    method: "DELETE",
    headers: { cookie: `session=${rawSessionId}`, origin: APP_URL },
  });
}

function communitySettingsRequest(
  rawSessionId: string,
  username: string,
  iconUrl: string,
): Request {
  return new Request(`${APP_URL}/api/communities/${username}/settings`, {
    method: "PATCH",
    headers: {
      cookie: `session=${rawSessionId}`,
      origin: APP_URL,
      "content-type": "application/json",
    },
    body: JSON.stringify({ icon_url: iconUrl }),
  });
}

function mediaAttachment(key: string) {
  return {
    type: "Video",
    url: `/media/${key.slice("uploads/".length)}`,
    r2_key: key,
  };
}

async function upload(
  setupState: Awaited<ReturnType<typeof setup>>,
  app = createYurucommuBackendApp({ singleOwner: true }),
) {
  const response = await app.fetch(
    uploadRequest(setupState.rawSessionId),
    setupState.env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    r2_key: string;
  };
}

test("published profile replacement fences a late reattachment during physical deletion", async () => {
  const state = await setup();
  const app = createYurucommuBackendApp({ singleOwner: true });
  const body = await upload(state);
  const url = `/media/${body.r2_key.slice("uploads/".length)}`;
  expect(
    (
      await app.fetch(
        profileRequest(state.rawSessionId, { icon_url: url }),
        state.env,
      )
    ).status,
  ).toBe(200);

  const entered = deferred<readonly string[]>();
  const release = deferred();
  state.env.MEDIA = {
    ...state.media.storage,
    async delete(value) {
      const keys = typeof value === "string" ? [value] : [...value];
      entered.resolve(keys);
      await release.promise;
      for (const key of keys) state.media.blobs.delete(key);
    },
  } as ObjectStore;
  const replacing = Promise.resolve(
    app.fetch(profileRequest(state.rawSessionId, { icon_url: "" }), state.env),
  );
  try {
    expect(
      await Promise.race([
        entered.promise,
        replacing.then(() => {
          throw new Error("replacement never entered storage deletion");
        }),
      ]),
    ).toContain(body.r2_key);
    const late = await app.fetch(
      profileRequest(state.rawSessionId, { icon_url: url }),
      state.env,
    );
    expect(late.status).toBe(409);
    const actor = await state.db
      .select({ iconUrl: actors.iconUrl })
      .from(actors)
      .where(eq(actors.apId, state.actor.apId))
      .get();
    expect(actor?.iconUrl).not.toBe(url);
  } finally {
    release.resolve();
    expect((await replacing).status).toBe(200);
  }
  expect(state.media.blobs.has(body.r2_key)).toBe(false);
});

test("profile same-key updates retain metadata and the blob while another profile slot references it", async () => {
  const state = await setup();
  const app = createYurucommuBackendApp({ singleOwner: true });
  const body = await upload(state);
  const url = `/media/${body.r2_key.slice("uploads/".length)}`;

  expect(
    (
      await app.fetch(
        profileRequest(state.rawSessionId, {
          icon_url: url,
          header_url: url,
        }),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await app.fetch(
        profileRequest(state.rawSessionId, {
          icon_url: url,
          header_url: url,
        }),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await app.fetch(
        profileRequest(state.rawSessionId, {
          icon_url: "",
        }),
        state.env,
      )
    ).status,
  ).toBe(200);

  await runYurucommuRetention(state.env);
  expect(state.media.blobs.has(body.r2_key)).toBe(true);
  expect(
    await state.db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, body.r2_key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, body.r2_key)),
  ).toHaveLength(0);
  const profile = await state.db
    .select({ headerUrl: actors.headerUrl })
    .from(actors)
    .where(eq(actors.apId, state.actor.apId))
    .get();
  expect(profile?.headerUrl).toBe(url);
});

test("published post deletion keeps a permanent claim across provider failure, retry, and late post reference", async () => {
  const state = await setup();
  const app = createYurucommuBackendApp({ singleOwner: true });
  const uploaded = await upload(state);
  const key = uploaded.r2_key;

  const created = await app.fetch(
    postRequest(state.rawSessionId, [mediaAttachment(key)]),
    state.env,
  );
  expect(created.status).toBe(200);
  const post = (await created.json()) as {
    ap_id: string;
    post: { ap_id: string };
  };
  expect(post.post.ap_id).toBe(post.ap_id);
  state.env.MEDIA = {
    ...state.media.storage,
    async delete() {
      throw new Error("simulated provider failure");
    },
  } as ObjectStore;
  expect(
    (
      await app.fetch(
        deletePostRequest(state.rawSessionId, post.ap_id),
        state.env,
      )
    ).status,
  ).toBe(200);

  expect(state.media.blobs.has(key)).toBe(true);
  expect(
    await state.db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, key)),
  ).toHaveLength(1);

  const latePost = await app.fetch(
    postRequest(state.rawSessionId, [mediaAttachment(key)]),
    state.env,
  );
  expect(latePost.status).toBe(409);
  expect(
    await state.db
      .select()
      .from(objects)
      .where(eq(objects.attributedTo, state.actor.apId)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, key)),
  ).toHaveLength(1);

  await state.db
    .update(mediaBlobDeletionJobs)
    .set({ nextAttemptAt: "2000-01-01T00:00:00.000Z" })
    .where(eq(mediaBlobDeletionJobs.r2Key, key));
  state.env.MEDIA = state.media.storage;
  await runYurucommuRetention(state.env);
  expect(state.media.blobs.has(key)).toBe(false);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, key)),
  ).toHaveLength(1);
  await expect(
    state.db
      .insert(mediaUploads)
      .values({
        id: `replayed-${crypto.randomUUID()}`,
        r2Key: key,
        uploaderApId: state.actor.apId,
        contentType: "video/webm",
        size: WEBM_BYTES.byteLength,
        createdAt: new Date().toISOString(),
      })
      .execute(),
  ).rejects.toThrow();
});

test("post deletion preserves an unsupported noncanonical legacy upload", async () => {
  const state = await setup();
  const app = createYurucommuBackendApp({ singleOwner: true });
  const key = "uploads/legacy-name-without-canonical-digest.webm";
  await state.db.insert(mediaUploads).values({
    id: "legacy-noncanonical-upload",
    r2Key: key,
    uploaderApId: state.actor.apId,
    contentType: "video/webm",
    size: WEBM_BYTES.byteLength,
    createdAt: "2000-01-01T00:00:00.000Z",
  });
  await state.db.insert(mediaBlobDeletionJobs).values({
    r2Key: key,
    uploaderApId: state.actor.apId,
    createdAt: "2000-01-01T00:00:00.000Z",
    nextAttemptAt: "2000-01-01T00:00:00.000Z",
  });
  state.media.blobs.set(key, WEBM_BYTES);

  const created = await app.fetch(
    postRequest(state.rawSessionId, [mediaAttachment(key)]),
    state.env,
  );
  expect(created.status).toBe(200);
  const post = (await created.json()) as {
    ap_id: string;
    post: { ap_id: string };
  };
  expect(post.post.ap_id).toBe(post.ap_id);
  expect(
    (
      await app.fetch(
        deletePostRequest(state.rawSessionId, post.ap_id),
        state.env,
      )
    ).status,
  ).toBe(200);
  await runYurucommuRetention(state.env);

  expect(state.media.blobs.has(key)).toBe(true);
  expect(
    await state.db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, key)),
  ).toHaveLength(0);
});

test("deleting another actor's post cannot claim or remove the media uploader's blob", async () => {
  const state = await setup();
  const other = await addActorSession(
    state,
    `other-${crypto.randomUUID().slice(0, 8)}`,
  );
  const app = createYurucommuBackendApp();
  const uploaded = await upload(state, app);
  const url = `/media/${uploaded.r2_key.slice("uploads/".length)}`;
  await state.db
    .update(actors)
    .set({ iconUrl: url })
    .where(eq(actors.apId, other.actor.apId))
    .execute();
  const created = await app.fetch(
    postRequest(other.rawSessionId, [mediaAttachment(uploaded.r2_key)]),
    state.env,
  );
  expect(created.status).toBe(200);
  const post = (await created.json()) as {
    ap_id: string;
    post: { ap_id: string };
  };

  expect(
    (
      await app.fetch(
        profileRequest(other.rawSessionId, { icon_url: "" }),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await app.fetch(
        deletePostRequest(other.rawSessionId, post.ap_id),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    await state.db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(state.media.blobs.has(uploaded.r2_key)).toBe(true);
});

test("community icon same-key and foreign-manager removal preserve another uploader's blob; owner removal claims and retries", async () => {
  const state = await setup();
  const otherManager = await addActorSession(
    state,
    `manager-${crypto.randomUUID().slice(0, 8)}`,
  );
  const app = createYurucommuBackendApp();
  const uploaded = await upload(state, app);
  const url = `/media/${uploaded.r2_key.slice("uploads/".length)}`;
  const username = `community-${crypto.randomUUID().slice(0, 8)}`;
  const communityApId = await seedCommunity(state, username, state.actor.apId, [
    otherManager.actor.apId,
  ]);
  await state.db
    .update(communities)
    .set({ iconUrl: url })
    .where(eq(communities.apId, communityApId))
    .execute();

  expect(
    (
      await app.fetch(
        communitySettingsRequest(state.rawSessionId, username, url),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(
    (
      await app.fetch(
        communitySettingsRequest(otherManager.rawSessionId, username, ""),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    await state.db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(state.media.blobs.has(uploaded.r2_key)).toBe(true);

  await state.db
    .update(communities)
    .set({ iconUrl: url })
    .where(eq(communities.apId, communityApId))
    .execute();
  state.env.MEDIA = {
    ...state.media.storage,
    async delete() {
      throw new Error("simulated provider failure");
    },
  } as ObjectStore;
  expect(
    (
      await app.fetch(
        communitySettingsRequest(state.rawSessionId, username, ""),
        state.env,
      )
    ).status,
  ).toBe(200);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
  expect(state.media.blobs.has(uploaded.r2_key)).toBe(true);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
  state.env.MEDIA = state.media.storage;
  await state.db
    .update(mediaBlobDeletionJobs)
    .set({ nextAttemptAt: "2000-01-01T00:00:00.000Z" })
    .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key))
    .execute();
  await runYurucommuRetention(state.env);
  expect(state.media.blobs.has(uploaded.r2_key)).toBe(false);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
});

test("direct owning profile source removal commits deletion intent for a later retention drain", async () => {
  const state = await setup();
  const app = createYurucommuBackendApp({ singleOwner: true });
  const uploaded = await upload(state);
  const url = `/media/${uploaded.r2_key.slice("uploads/".length)}`;
  expect(
    (
      await app.fetch(
        profileRequest(state.rawSessionId, { icon_url: url }),
        state.env,
      )
    ).status,
  ).toBe(200);

  await state.db
    .update(actors)
    .set({ iconUrl: null })
    .where(eq(actors.apId, state.actor.apId))
    .execute();
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaUploads)
      .where(eq(mediaUploads.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
  expect(state.media.blobs.has(uploaded.r2_key)).toBe(true);

  await runYurucommuRetention(state.env);
  expect(state.media.blobs.has(uploaded.r2_key)).toBe(false);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionJobs)
      .where(eq(mediaBlobDeletionJobs.r2Key, uploaded.r2_key)),
  ).toHaveLength(0);
  expect(
    await state.db
      .select()
      .from(mediaBlobDeletionClaims)
      .where(eq(mediaBlobDeletionClaims.r2Key, uploaded.r2_key)),
  ).toHaveLength(1);
});
