import { expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";

import {
  accountDeletions,
  accountDeletionTargets,
  activities,
  actors,
  communities,
  communityMembers,
  mediaUploadAttempts,
  mediaUploads,
  sessions,
  type Database,
} from "../../../db/index.ts";
import { createYurucommuBackendApp } from "../../public.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import {
  deleteLocalAccount,
  resumeAbandonedAccountDeletions,
} from "../../routes/account-deletion-lifecycle.ts";
import type { Env } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://durable.test";
const SESSION_SALT = "durable-account-deletion-test-salt";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function envFor(db: Database, media?: ObjectStore): Env {
  const values = new Map<string, string>();
  const queue = { async send() {}, async sendBatch() {} };
  return {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: media,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
    KV: {
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async put(key: string, value: string) {
        values.set(key, value);
      },
      async delete(key: string) {
        values.delete(key);
      },
    },
    AUTH_PASSWORD_HASH: "durable-test-password",
    YURUCOMMU_SESSION_HASH_SALT: SESSION_SALT,
  } as unknown as Env;
}

function mediaStore(
  remove: (keys: readonly string[]) => Promise<void>,
): ObjectStore {
  return {
    async put() {},
    async get() {
      return null;
    },
    async delete(value: string | readonly string[]) {
      await remove(typeof value === "string" ? [value] : value);
    },
  } as unknown as ObjectStore;
}

async function owner(db: Database) {
  return createActor(db, envFor(db), {
    username: `durable-owner-${crypto.randomUUID().slice(0, 8)}`,
    name: "Durable owner",
    takosUserId: `password:${crypto.randomUUID()}`,
    role: "owner",
  });
}

async function session(
  db: Database,
  actorApId: string,
  rawId: string,
  lifetimeMs = 60_000,
) {
  const id = await hashSessionIdForEnv(envFor(db), rawId);
  await db.insert(sessions).values({
    id,
    memberId: actorApId,
    accessToken: id,
    expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
    provider: null,
  });
}

function request(rawId: string) {
  return new Request(`${APP_URL}/api/actors/me/delete`, {
    method: "POST",
    headers: { cookie: `session=${rawId}`, origin: APP_URL },
  });
}

async function upload(db: Database, apId: string, id: string) {
  await db.insert(mediaUploads).values({
    id,
    r2Key: `durable/${id}`,
    uploaderApId: apId,
    contentType: "image/jpeg",
    size: 1,
  });
}

test("an expired lease transfers work; the stale worker cannot acknowledge metadata", async () => {
  const { db } = await createTestDb();
  const actor = await owner(db);
  const rawId = "durable-lease-session";
  await session(db, actor.apId, rawId);
  await upload(db, actor.apId, "lease-photo");
  const entered = deferred();
  const release = deferred();
  let deletes = 0;
  const media = mediaStore(async () => {
    deletes += 1;
    if (deletes === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  const app = createYurucommuBackendApp({ singleOwner: true });
  const env = envFor(db, media);
  const first = app.fetch(request(rawId), env);
  try {
    await entered.promise;
    const operation = await db.select().from(accountDeletions).get();
    expect(operation).toBeDefined();
    await db
      .update(accountDeletions)
      .set({ leaseExpiresAt: new Date(0).toISOString() })
      .where(eq(accountDeletions.id, operation!.id));

    const successor = await app.fetch(request(rawId), env);
    expect(successor.status).toBe(200);
    expect(await db.select().from(accountDeletions)).toHaveLength(0);
    expect(await db.select().from(accountDeletionTargets)).toHaveLength(0);
    expect(await db.select().from(mediaUploads)).toHaveLength(0);
    expect(await db.select().from(sessions)).toHaveLength(0);
  } finally {
    release.resolve();
  }
  expect((await first).status).toBe(409);
  expect(deletes).toBe(2);
});

test("retention finishes a failed plan after the only session expires", async () => {
  const { db } = await createTestDb();
  const actor = await owner(db);
  const rawId = "durable-expiring-session";
  await session(db, actor.apId, rawId, 1_500);
  await upload(db, actor.apId, "retention-photo");
  let fail = true;
  const env = envFor(
    db,
    mediaStore(async () => {
      if (fail) {
        fail = false;
        throw new Error("storage temporarily unavailable");
      }
    }),
  );
  const app = createYurucommuBackendApp({ singleOwner: true });
  expect((await app.fetch(request(rawId), env)).status).toBe(500);

  // The reservation intentionally leaves sessions untouched, including this
  // one. Expiration removes its request authority, not the durable retry plan.
  const retained = await db.select().from(accountDeletions).get();
  expect(retained).toBeDefined();
  expect(await db.select().from(accountDeletionTargets)).toHaveLength(1);
  await Bun.sleep(1_600);
  expect((await app.fetch(request(rawId), env)).status).toBe(401);
  const expiredEnv = envFor(db, env.MEDIA);
  expect(await resumeAbandonedAccountDeletions(expiredEnv)).toBe(1);
  expect(await db.select().from(accountDeletions)).toHaveLength(0);
  expect(await db.select().from(sessions)).toHaveLength(0);
  expect(
    (
      await db
        .select({ deletedAt: actors.deletedAt })
        .from(actors)
        .where(eq(actors.apId, actor.apId))
        .get()
    )?.deletedAt,
  ).toBeTruthy();
});

test("a child deletion reserves only that child and stale route identity cannot start a plan", async () => {
  const { db } = await createTestDb();
  const parent = await owner(db);
  const child = await createActor(db, envFor(db), {
    username: `durable-child-${crypto.randomUUID().slice(0, 8)}`,
    name: "Child",
    takosUserId: `local:${crypto.randomUUID()}`,
    role: "member",
    ownerActorApId: parent.apId,
  });
  const stale = await deleteLocalAccount(db, envFor(db), parent.apId, {
    cascadeOwnedAccounts: true,
    expectedPublicKeyPem: "stale-public-key",
    expectedTakosUserId: parent.takosUserId,
    expectedOwnerActorApId: null,
  });
  expect(stale).toBe("busy");
  expect(await db.select().from(accountDeletions)).toHaveLength(0);

  const rawId = "durable-child-session";
  await session(db, child.apId, rawId);
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    request(rawId),
    envFor(db),
  );
  expect(response.status).toBe(200);
  const rows = await db
    .select({ apId: actors.apId, deletedAt: actors.deletedAt })
    .from(actors)
    .where(and(eq(actors.apId, parent.apId), isNull(actors.deletedAt)));
  expect(rows).toHaveLength(1);
  expect(
    (await db.select().from(actors).where(eq(actors.apId, child.apId)).get())
      ?.deletedAt,
  ).toBeTruthy();
  expect(
    await db
      .select()
      .from(activities)
      .where(
        and(
          eq(activities.actorApId, parent.apId),
          eq(activities.type, "Delete"),
        ),
      ),
  ).toHaveLength(0);
});

test("owner cascade retires a Group whose only apparent heir is also reserved for deletion", async () => {
  const { db } = await createTestDb();
  const parent = await owner(db);
  const child = await createActor(db, envFor(db), {
    username: `reserved-heir-${crypto.randomUUID().slice(0, 8)}`,
    name: "Reserved heir",
    takosUserId: `local:${crypto.randomUUID()}`,
    role: "member",
    ownerActorApId: parent.apId,
  });
  const groupApId = `${APP_URL}/ap/groups/reserved-heir-group`;
  await db.insert(communities).values({
    apId: groupApId,
    preferredUsername: "reserved-heir-group",
    name: "Reserved heir group",
    inbox: `${groupApId}/inbox`,
    outbox: `${groupApId}/outbox`,
    followersUrl: `${groupApId}/followers`,
    publicKeyPem: "group-public-key",
    privateKeyPem: "group-private-key",
    createdBy: parent.apId,
    memberCount: 2,
  });
  await db.insert(communityMembers).values([
    { communityApId: groupApId, actorApId: parent.apId, role: "owner" },
    { communityApId: groupApId, actorApId: child.apId, role: "member" },
  ]);
  const rawId = "durable-reserved-heir-session";
  await session(db, parent.apId, rawId);

  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    request(rawId),
    envFor(db),
  );
  expect(response.status).toBe(200);
  const group = await db
    .select({
      deletedAt: communities.deletedAt,
      createdBy: communities.createdBy,
      memberCount: communities.memberCount,
    })
    .from(communities)
    .where(eq(communities.apId, groupApId))
    .get();
  expect(group?.deletedAt).toBeTruthy();
  expect(group?.createdBy).toBe("");
  expect(group?.memberCount).toBe(0);
  expect(
    await db
      .select()
      .from(communityMembers)
      .where(eq(communityMembers.communityApId, groupApId)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(activities)
      .where(
        and(eq(activities.actorApId, groupApId), eq(activities.type, "Delete")),
      ),
  ).toHaveLength(1);
});

test("an aged in-flight upload keeps deletion reserved until its writer settles", async () => {
  const { db } = await createTestDb();
  const actor = await owner(db);
  const rawId = "durable-aged-put-session";
  await session(db, actor.apId, rawId);
  await db.insert(mediaUploadAttempts).values({
    id: "aged-put",
    r2Key: "durable/aged-put",
    uploaderApId: actor.apId,
    publicKeyPem: actor.publicKeyPem,
    phase: "putting",
    createdAt: new Date(0).toISOString(),
  });

  const env = envFor(db);
  const response = await createYurucommuBackendApp({ singleOwner: true }).fetch(
    request(rawId),
    env,
  );
  expect(response.status).toBe(409);
  expect(await db.select().from(accountDeletions)).toHaveLength(1);
  expect(await db.select().from(accountDeletionTargets)).toHaveLength(1);
  expect(await db.select().from(mediaUploadAttempts)).toHaveLength(1);
  expect(
    (
      await db
        .select({ deletedAt: actors.deletedAt })
        .from(actors)
        .where(eq(actors.apId, actor.apId))
        .get()
    )?.deletedAt,
  ).toBeNull();
  expect(await db.select().from(sessions)).toHaveLength(1);

  await expect(resumeAbandonedAccountDeletions(env)).rejects.toThrow();
  expect(await db.select().from(mediaUploadAttempts)).toHaveLength(1);
  expect(await db.select().from(accountDeletionTargets)).toHaveLength(1);
});
