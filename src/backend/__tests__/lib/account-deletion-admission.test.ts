import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  accountDeletionTargets,
  accountDeletions,
  activities,
  actors,
  communities,
  deliveryQueue,
  sessions,
} from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { admitSessionRequest } from "../../lib/account-deletion-admission.ts";
import { AccountDeletionConflictError } from "../../lib/errors.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import type { Actor, Env, Variables } from "../../types.ts";

const APP_URL = "https://yuru.test";
const OWNER = `${APP_URL}/ap/users/admission-owner`;
const COMMUNITY = `${APP_URL}/ap/groups/admission-group`;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixtureActor(overrides: Partial<Actor> = {}): Actor {
  return {
    ap_id: OWNER,
    type: "Person",
    preferred_username: "admission-owner",
    name: "Admission owner",
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${OWNER}/inbox`,
    outbox: `${OWNER}/outbox`,
    followers_url: `${OWNER}/followers`,
    following_url: `${OWNER}/following`,
    public_key_pem: "captured-public-key",
    private_key_pem: "captured-private-key",
    takos_user_id: "password:admission-owner",
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "owner",
    created_at: new Date().toISOString(),
    ...overrides,
  } as Actor;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

async function seedActor(db: Database): Promise<void> {
  await db.insert(actors).values({
    apId: OWNER,
    type: "Person",
    preferredUsername: "admission-owner",
    name: "Admission owner",
    inbox: `${OWNER}/inbox`,
    outbox: `${OWNER}/outbox`,
    followersUrl: `${OWNER}/followers`,
    followingUrl: `${OWNER}/following`,
    publicKeyPem: "captured-public-key",
    privateKeyPem: "captured-private-key",
    takosUserId: "password:admission-owner",
    role: "owner",
  });
  await db.insert(communities).values({
    apId: COMMUNITY,
    preferredUsername: "admission-group",
    name: "Before reservation",
    inbox: `${COMMUNITY}/inbox`,
    outbox: `${COMMUNITY}/outbox`,
    followersUrl: `${COMMUNITY}/followers`,
    publicKeyPem: "group-public-key",
    privateKeyPem: "group-private-key",
    createdBy: OWNER,
  });
}

async function reserveActor(db: Database, apId = OWNER): Promise<void> {
  const id = "account-deletion-admission-reservation";
  await db.insert(accountDeletions).values({
    id,
    rootActorApId: OWNER,
    rootPublicKeyPem: "captured-public-key",
    workerToken: "worker-token",
    // Even a lease that expired long ago retains the durable reservation.
    leaseExpiresAt: "2000-01-01T00:00:00.000Z",
  });
  await db.insert(accountDeletionTargets).values({
    actorApId: apId,
    operationId: id,
    publicKeyPem: "captured-public-key",
    followersUrl: `${apId}/followers`,
    deleteActivityApId: `${APP_URL}/ap/activities/admission-delete`,
    cascadeComplete: false,
  });
}

function guardedApp(
  db: Database,
  actor = fixtureActor(),
  env = envFor(db),
  afterAdmission?: (restoredEnv: Env) => void,
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await admitSessionRequest(c, next);
    afterAdmission?.(c.env);
  });
  app.onError((error, c) => {
    if (error instanceof AccountDeletionConflictError) {
      return c.json({ error: "Account deletion in progress" }, 409);
    }
    throw error;
  });
  return { app, env };
}

async function communityName(db: Database): Promise<string | undefined> {
  return (
    await db
      .select({ name: communities.name })
      .from(communities)
      .where(eq(communities.apId, COMMUNITY))
      .get()
  )?.name;
}

test("a mutation admitted before reservation fails at its atomic write fence", async () => {
  const { db } = await createTestDb();
  await seedActor(db);
  const { app, env } = guardedApp(db);
  const handlerEntered = deferred();
  const releaseHandler = deferred();
  app.put("/mutate", async (c) => {
    // Authentication and Actor capture have already happened. Pause before
    // obtaining the request database and issuing an unrelated shared-row write.
    handlerEntered.resolve();
    await releaseHandler.promise;
    try {
      await c
        .get("db")
        .update(communities)
        .set({ name: "Must remain unchanged" })
        .where(eq(communities.apId, COMMUNITY));
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof AccountDeletionConflictError) {
        return c.json({ error: "Account deletion in progress" }, 409);
      }
      throw error;
    }
  });

  let request: Promise<Response> | undefined;
  try {
    request = Promise.resolve(app.request("/mutate", { method: "PUT" }, env));
    await handlerEntered.promise;
    await reserveActor(db);
    releaseHandler.resolve();
    const response = await request;
    expect(response.status).toBe(409);
    expect(await communityName(db)).toBe("Before reservation");
  } finally {
    releaseHandler.resolve();
    if (request) await request;
  }
});

test("reservation fences writes through DB_INSTANCE and restores the original environment", async () => {
  const { db } = await createTestDb();
  await seedActor(db);
  const baseEnv = envFor(db);
  const envEntriesBefore = Object.entries(baseEnv);
  let restoredEnv: Env | undefined;
  const { app, env } = guardedApp(db, fixtureActor(), baseEnv, (value) => {
    restoredEnv = value;
  });
  const handlerEntered = deferred<{
    sameBaseEnv: boolean;
    guardedDb: boolean;
  }>();
  const releaseHandler = deferred();
  app.put("/mutate", async (c) => {
    const wasBaseEnv = c.env === baseEnv;
    const guardedDb = c.env.DB_INSTANCE !== db;
    handlerEntered.resolve({ sameBaseEnv: wasBaseEnv, guardedDb });
    await releaseHandler.promise;
    try {
      await c.env.DB_INSTANCE.update(communities)
        .set({ name: "Must remain unchanged" })
        .where(eq(communities.apId, COMMUNITY));
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof AccountDeletionConflictError) {
        return c.json({ error: "Account deletion in progress" }, 409);
      }
      throw error;
    }
  });

  let request: Promise<Response> | undefined;
  try {
    request = Promise.resolve(app.request("/mutate", { method: "PUT" }, env));
    const captured = await handlerEntered.promise;
    expect(captured.sameBaseEnv).toBe(false);
    expect(captured.guardedDb).toBe(true);
    await reserveActor(db);
    releaseHandler.resolve();
    expect((await request).status).toBe(409);
    expect(await communityName(db)).toBe("Before reservation");
  } finally {
    releaseHandler.resolve();
    if (request) await request;
    expect(restoredEnv).toBe(baseEnv);
    expect(Object.entries(baseEnv)).toEqual(envEntriesBefore);
  }
});

test("a captured Actor whose identity key changed cannot commit a later write", async () => {
  const { db } = await createTestDb();
  await seedActor(db);
  const { app, env } = guardedApp(db);
  const handlerEntered = deferred();
  const releaseHandler = deferred();
  app.put("/mutate", async (c) => {
    handlerEntered.resolve();
    await releaseHandler.promise;
    try {
      await c
        .get("db")
        .update(communities)
        .set({ name: "Must remain unchanged" })
        .where(eq(communities.apId, COMMUNITY));
      return c.json({ success: true });
    } catch (error) {
      if (error instanceof AccountDeletionConflictError) {
        return c.json({ error: "Account changed" }, 409);
      }
      throw error;
    }
  });

  let request: Promise<Response> | undefined;
  try {
    request = Promise.resolve(app.request("/mutate", { method: "PUT" }, env));
    await handlerEntered.promise;
    await db
      .update(actors)
      .set({ publicKeyPem: "rotated-public-key" })
      .where(eq(actors.apId, OWNER));
    releaseHandler.resolve();
    expect((await request).status).toBe(409);
    expect(await communityName(db)).toBe("Before reservation");
  } finally {
    releaseHandler.resolve();
    if (request) await request;
  }
});

test("generic tombstone revival respects a deletion target and preserves its Delete recovery state", async () => {
  const { db } = await createTestDb();
  const tombstone = await createActor(db, envFor(db), {
    username: "reserved-revival",
    name: "Original identity",
    takosUserId: "local:reserved-revival-old",
    role: "member",
  });
  const deleteActivityApId = `${APP_URL}/ap/activities/reserved-revival-delete`;
  await db.insert(sessions).values({
    id: "reserved-revival-session-hash",
    memberId: tombstone.apId,
    accessToken: "reserved-revival-session-hash",
    expiresAt: "2099-01-01T00:00:00.000Z",
    provider: null,
  });
  await db.insert(activities).values({
    apId: deleteActivityApId,
    type: "Delete",
    actorApId: tombstone.apId,
    objectApId: tombstone.apId,
    rawJson: JSON.stringify({ type: "Delete", object: tombstone.apId }),
    direction: "outbound",
  });
  await db.insert(deliveryQueue).values({
    id: "reserved-revival-delivery",
    activityApId: deleteActivityApId,
    inboxUrl: "https://remote.test/inbox",
    status: "retry_wait",
  });
  await db
    .update(actors)
    .set({
      preferredUsername: "deleted-reserved-revival",
      deletedAt: new Date().toISOString(),
    })
    .where(eq(actors.apId, tombstone.apId));
  await reserveActor(db, tombstone.apId);

  await expect(
    createActor(db, envFor(db), {
      username: "reserved-revival",
      name: "Replacement identity",
      takosUserId: "local:reserved-revival-new",
      role: "member",
    }),
  ).rejects.toBeInstanceOf(AccountDeletionConflictError);

  const actor = await db
    .select({
      preferredUsername: actors.preferredUsername,
      publicKeyPem: actors.publicKeyPem,
      takosUserId: actors.takosUserId,
      deletedAt: actors.deletedAt,
    })
    .from(actors)
    .where(eq(actors.apId, tombstone.apId))
    .get();
  expect(actor).toMatchObject({
    preferredUsername: "deleted-reserved-revival",
    publicKeyPem: tombstone.publicKeyPem,
    takosUserId: "local:reserved-revival-old",
  });
  expect(actor?.deletedAt).toBeTruthy();
  expect(
    await db
      .select({ apId: activities.apId })
      .from(activities)
      .where(eq(activities.apId, deleteActivityApId)),
  ).toHaveLength(1);
  expect(
    await db
      .select({ id: deliveryQueue.id, status: deliveryQueue.status })
      .from(deliveryQueue)
      .where(eq(deliveryQueue.id, "reserved-revival-delivery")),
  ).toEqual([{ id: "reserved-revival-delivery", status: "retry_wait" }]);
  expect(
    await db
      .select({ memberId: sessions.memberId })
      .from(sessions)
      .where(eq(sessions.id, "reserved-revival-session-hash")),
  ).toEqual([{ memberId: tombstone.apId }]);
});
