import { expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import {
  activities,
  actors,
  mediaUploads,
  sessions,
  type Database,
} from "../../../db/index.ts";
import { createYurucommuBackendApp } from "../../public.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import type { Env } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const SESSION_SALT = "account-deletion-lifecycle-test-salt";
const PASSWORD = "account-deletion-lifecycle-test-password";

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

function envFor(db: Database, media?: ObjectStore): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    KV: memoryKv(),
    DELIVERY_QUEUE: queue(),
    DELIVERY_DLQ: queue(),
    MEDIA: media,
    AUTH_PASSWORD_HASH: PASSWORD,
    YURUCOMMU_SESSION_HASH_SALT: SESSION_SALT,
  } as unknown as Env;
}

function appFor() {
  return createYurucommuBackendApp({ singleOwner: true });
}

async function seedSession(
  db: Database,
  memberId: string,
  rawId: string,
): Promise<void> {
  const env = envFor(db);
  const id = await hashSessionIdForEnv(env, rawId);
  await db.insert(sessions).values({
    id,
    memberId,
    accessToken: id,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    provider: null,
  });
}

function cookieRequest(
  path: string,
  method: string,
  rawSessionId: string,
  body?: unknown,
): Request {
  const headers = new Headers({
    cookie: `session=${rawSessionId}`,
    origin: APP_URL,
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${APP_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function seedOwner(db: Database) {
  return createActor(db, envFor(db), {
    username: "lifecycle-owner",
    name: "Lifecycle owner",
    takosUserId: "password:lifecycle-owner",
    role: "owner",
  });
}

async function seedUpload(db: Database, actorApId: string, id: string) {
  await db.insert(mediaUploads).values({
    id,
    r2Key: `account-deletion/${id}.jpg`,
    uploaderApId: actorApId,
    contentType: "image/jpeg",
    size: 1,
  });
}

async function actorState(db: Database, apId: string) {
  return db
    .select({
      deletedAt: actors.deletedAt,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
    })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
}

async function outboundDeleteIntents(db: Database, apId: string) {
  return db
    .select({ apId: activities.apId })
    .from(activities)
    .where(
      and(
        eq(activities.actorApId, apId),
        eq(activities.type, "Delete"),
        eq(activities.direction, "outbound"),
      ),
    );
}

test("reserved deletion excludes a second teardown, new accounts, writes, and login", async () => {
  const { db } = await createTestDb();
  const owner = await seedOwner(db);
  const rawSessionId = "lifecycle-overlap-session";
  await seedSession(db, owner.apId, rawSessionId);
  await seedUpload(db, owner.apId, "overlap-owner-media");

  const enteredStorageDelete = deferred<readonly string[]>();
  const releaseStorageDelete = deferred();
  let storageCalls = 0;
  const media = objectStore(async (keys) => {
    storageCalls += 1;
    if (storageCalls === 1) {
      enteredStorageDelete.resolve(keys);
      await releaseStorageDelete.promise;
    }
  });
  const app = appFor();
  const env = envFor(db, media);
  let firstDelete: Promise<Response> | undefined;

  try {
    firstDelete = Promise.resolve(
      app.fetch(
        cookieRequest("/api/actors/me/delete", "POST", rawSessionId),
        env,
      ),
    );
    expect(await enteredStorageDelete.promise).toEqual([
      "account-deletion/overlap-owner-media.jpg",
    ]);

    const concurrentDelete = await app.fetch(
      cookieRequest("/api/actors/me/delete", "POST", rawSessionId),
      env,
    );
    expect(concurrentDelete.status).toBe(409);
    expect(await outboundDeleteIntents(db, owner.apId)).toHaveLength(1);

    const accountCreation = await app.fetch(
      cookieRequest("/api/auth/accounts", "POST", rawSessionId, {
        username: "during-deletion",
      }),
      env,
    );
    expect(accountCreation.status).toBe(409);
    expect(
      await db
        .select({ apId: actors.apId })
        .from(actors)
        .where(eq(actors.preferredUsername, "during-deletion")),
    ).toHaveLength(0);

    const profileWrite = await app.fetch(
      cookieRequest("/api/actors/me", "PUT", rawSessionId, {
        name: "Should not be written",
      }),
      env,
    );
    expect(profileWrite.status).toBe(409);
    expect((await actorState(db, owner.apId))?.preferredUsername).toBe(
      "lifecycle-owner",
    );
    expect((await actorState(db, owner.apId))?.name).toBe("Lifecycle owner");

    const beforeLogin = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.memberId, owner.apId));
    const login = await app.fetch(
      new Request(`${APP_URL}/api/auth/login`, {
        method: "POST",
        headers: { origin: APP_URL, "content-type": "application/json" },
        body: JSON.stringify({ password: PASSWORD }),
      }),
      env,
    );
    expect(login.status).toBe(409);
    expect(
      await db
        .select({ id: sessions.id })
        .from(sessions)
        .where(eq(sessions.memberId, owner.apId)),
    ).toEqual(beforeLogin);
  } finally {
    releaseStorageDelete.resolve();
    if (firstDelete) await firstDelete;
  }
});

test("storage failure preserves every actor and session for deletion retry only", async () => {
  const { db } = await createTestDb();
  const owner = await seedOwner(db);
  const first = await createActor(db, envFor(db), {
    username: "lifecycle-first",
    name: "First profile",
    takosUserId: "local:lifecycle-first",
    role: "member",
    ownerActorApId: owner.apId,
  });
  const second = await createActor(db, envFor(db), {
    username: "lifecycle-second",
    name: "Second profile",
    takosUserId: "local:lifecycle-second",
    role: "member",
    ownerActorApId: owner.apId,
  });
  const rawSessionId = "lifecycle-retry-session";
  await seedSession(db, owner.apId, rawSessionId);
  await seedUpload(db, owner.apId, "retry-owner-media");
  await seedUpload(db, first.apId, "retry-first-media");
  await seedUpload(db, second.apId, "retry-second-media");

  let shouldFail = true;
  const deletedKeys: string[] = [];
  const media = objectStore(async (keys) => {
    deletedKeys.push(...keys);
    if (
      shouldFail &&
      keys.includes("account-deletion/retry-second-media.jpg")
    ) {
      shouldFail = false;
      throw new Error("fixture storage failure");
    }
  });
  const app = appFor();
  const env = envFor(db, media);
  const deleteRequest = () =>
    app.fetch(
      cookieRequest("/api/actors/me/delete", "POST", rawSessionId),
      env,
    );

  const failed = await deleteRequest();
  expect(failed.status).toBe(500);
  expect((await actorState(db, owner.apId))?.deletedAt).toBeNull();
  expect((await actorState(db, first.apId))?.deletedAt).toBeNull();
  expect((await actorState(db, second.apId))?.deletedAt).toBeNull();
  expect(
    await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.memberId, owner.apId)),
  ).toHaveLength(1);

  const currentUser = await app.fetch(
    cookieRequest("/api/auth/me", "GET", rawSessionId),
    env,
  );
  expect(currentUser.status).toBe(409);
  const profileWrite = await app.fetch(
    cookieRequest("/api/actors/me", "PUT", rawSessionId, {
      name: "Still blocked",
    }),
    env,
  );
  expect(profileWrite.status).toBe(409);

  const retry = await deleteRequest();
  expect(retry.status).toBe(200);
  for (const apId of [owner.apId, first.apId, second.apId]) {
    expect((await actorState(db, apId))?.deletedAt).toBeTruthy();
    expect(await outboundDeleteIntents(db, apId)).toHaveLength(1);
  }
  expect(
    await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.memberId, owner.apId)),
  ).toHaveLength(0);
  expect(deletedKeys).toContain("account-deletion/retry-second-media.jpg");
});

test("owner deletion completes for legacy ownership sets larger than the account cap", async () => {
  const { db } = await createTestDb();
  const owner = await seedOwner(db);
  const rawSessionId = "lifecycle-large-set-session";
  await seedSession(db, owner.apId, rawSessionId);

  // The HTTP creation route caps new profiles at 20. Legacy data may exceed
  // that value, so exercise the persisted owner relation directly.
  const legacyProfiles = Array.from({ length: 23 }, (_, index) => {
    const username = `legacy-profile-${index}`;
    const apId = `${APP_URL}/ap/users/${username}`;
    return {
      apId,
      type: "Person",
      preferredUsername: username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "legacy-public-key",
      privateKeyPem: "legacy-private-key",
      takosUserId: `local:${username}`,
      role: "member",
      ownerActorApId: owner.apId,
    };
  });
  for (let offset = 0; offset < legacyProfiles.length; offset += 5) {
    await db.insert(actors).values(legacyProfiles.slice(offset, offset + 5));
  }

  const response = await appFor().fetch(
    cookieRequest("/api/actors/me/delete", "POST", rawSessionId),
    envFor(db),
  );
  expect(response.status).toBe(200);
  for (const profile of legacyProfiles) {
    expect((await actorState(db, profile.apId))?.deletedAt).toBeTruthy();
  }
});
