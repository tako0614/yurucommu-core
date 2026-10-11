import { expect, test } from "bun:test";
import { and, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  deliveryQueue,
  sessions,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import authRoutes from "../../routes/auth.ts";
import { createErrorMiddleware } from "../../middleware/error-handler.ts";
import { createYurucommuBackendApp } from "../../index.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";
import {
  createActor,
  createActorFromOAuth,
  findOrCreateOAuthActor,
  rotateSession,
} from "../../routes/auth-helpers.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const BOOTSTRAP_TOKEN = "atomic-owner-bootstrap-token";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

function envFor(db: Database, extra: Record<string, unknown> = {}): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    singleOwner: true,
    KV: memoryKv(),
    AUTH_PASSWORD_HASH: BOOTSTRAP_TOKEN,
    YURUCOMMU_SESSION_HASH_SALT: "atomic-owner-test-salt",
    ...extra,
  } as unknown as Env;
}

function genericEnvFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
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

function authApp(db: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(createErrorMiddleware({ logger: () => {} }));
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.route("/api/auth", authRoutes);
  return app;
}

async function passwordLogin(db: Database, path = "/api/auth/login") {
  return authApp(db).fetch(
    new Request(`${APP_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: BOOTSTRAP_TOKEN }),
    }),
    envFor(db),
  );
}

function actorOptions(username: string, takosUserId: string, role = "member") {
  return {
    username,
    name: username,
    takosUserId,
    role,
  };
}

/** Let concurrent owner reads both obtain their real result before release. */
function synchronizeOwnerCountReads(db: Database, readers: number): Database {
  let arrived = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });

  const wrapBuilder = (builder: unknown): unknown =>
    new Proxy(builder as object, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = value.apply(target, args);
          if (property === "get" || property === "all") {
            const query = (
              target as { toSQL?: () => { sql?: string } }
            ).toSQL?.();
            const sql = query?.sql?.toLowerCase() ?? "";
            const ownerRead =
              sql.includes('"actors"') &&
              (sql.includes("count(*)") ||
                (sql.includes('"role"') && sql.includes('"deleted_at"')));
            if (ownerRead) {
              return Promise.resolve(next).then(async (result) => {
                if (arrived < readers) {
                  arrived += 1;
                  if (arrived === readers) release();
                  await barrier;
                }
                return result;
              });
            }
            return next;
          }
          return next && typeof next === "object" ? wrapBuilder(next) : next;
        };
      },
    });

  return new Proxy(db as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "select" || typeof value !== "function") return value;
      return (...args: unknown[]) => wrapBuilder(value.apply(target, args));
    },
  }) as Database;
}

const oauthInfo = (id: string, username = id) => ({
  id,
  name: username,
  username,
});

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function seedDeleteTombstone(db: Database, username: string) {
  const apId = localApId(username);
  const deleteActivityId = `${APP_URL}/ap/activities/delete-${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: `deleted-${username}`,
    name: `Deleted ${username}`,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "OLD-PUBLIC-KEY",
    privateKeyPem: "OLD-PRIVATE-KEY",
    takosUserId: `old:${username}`,
    role: "member",
    deletedAt: new Date().toISOString(),
  });
  await db.insert(activities).values({
    apId: deleteActivityId,
    type: "Delete",
    actorApId: apId,
    objectApId: apId,
    rawJson: "{}",
    direction: "outbound",
  });
  await db.insert(deliveryQueue).values({
    id: `delete-job-${username}`,
    activityApId: deleteActivityId,
    inboxUrl: "https://remote.test/inbox",
    status: "pending",
  });
  return { apId, deleteActivityId };
}

async function seedSession(db: Database, memberId: string, fixtureId: string) {
  const env = envFor(db);
  const id = await hashSessionIdForEnv(
    env,
    `atomic-owner-session-${fixtureId}`,
  );
  await db.insert(sessions).values({
    id,
    memberId,
    accessToken: id,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    provider: null,
  });
  return id;
}

function pauseExistingOAuthLookup(db: Database): {
  db: Database;
  selected: Promise<void>;
  release(): void;
} {
  let signalSelected!: () => void;
  let release!: () => void;
  const selected = new Promise<void>((resolve) => {
    signalSelected = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const wrapBuilder = (builder: unknown): unknown =>
    new Proxy(builder as object, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          const next = value.apply(target, args);
          if (property === "get") {
            const sql =
              (target as { toSQL?: () => { sql?: string } })
                .toSQL?.()
                .sql?.toLowerCase() ?? "";
            if (sql.includes('"actors"') && sql.includes('"takos_user_id"')) {
              return Promise.resolve(next).then(async (result) => {
                signalSelected();
                await held;
                return result;
              });
            }
            return next;
          }
          return next && typeof next === "object" ? wrapBuilder(next) : next;
        };
      },
    });
  const gatedDb = new Proxy(db as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (property !== "select" || typeof value !== "function") return value;
      return (...args: unknown[]) => wrapBuilder(value.apply(target, args));
    },
  }) as Database;
  return { db: gatedDb, selected, release: () => release() };
}

function sessionRotationApp(
  db: Database,
  memberApId: string,
  expectedActor: { publicKeyPem: string; takosUserId: string | null },
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(createErrorMiddleware({ logger: () => {} }));
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });
  app.get("/rotate", async (c) => {
    await rotateSession(
      c,
      memberApId,
      null,
      null,
      undefined,
      "atomic-owner stale identity test",
      { expectedActor },
    );
    return c.text("rotated");
  });
  return app;
}

test("single-owner mode rejects a second direct owner without weakening generic creation", async () => {
  const db = await freshDb();
  const first = await createActor(
    db,
    envFor(db),
    actorOptions("one", "local:one", "owner"),
  );
  expect(first.role).toBe("owner");

  let conflict: unknown;
  try {
    await createActor(
      db,
      envFor(db),
      actorOptions("two", "local:two", "owner"),
    );
  } catch (error) {
    conflict = error;
  }
  expect(conflict).toMatchObject({
    code: "OWNER_CLAIM_CONFLICT",
    statusCode: 409,
  });
  expect(await db.select().from(actors).all()).toHaveLength(1);

  const genericDb = await freshDb();
  await createActor(
    genericDb,
    genericEnvFor(genericDb),
    actorOptions("one", "local:one", "owner"),
  );
  await createActor(
    genericDb,
    genericEnvFor(genericDb),
    actorOptions("two", "local:two", "owner"),
  );
  expect(
    await genericDb.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(2);
});

test("password login claims a rootless owner slot and then resolves the same owner", async () => {
  const db = await freshDb();
  expect((await passwordLogin(db)).status).toBe(200);
  expect((await passwordLogin(db)).status).toBe(200);
  const owners = await db
    .select()
    .from(actors)
    .where(eq(actors.role, "owner"))
    .all();
  expect(owners).toHaveLength(1);
  expect(owners[0]?.takosUserId).toBe("password:owner");
});

test("browser and mobile password login races both resolve the sole owner", async () => {
  const db = await freshDb();
  const concurrentDb = synchronizeOwnerCountReads(db, 2);
  const [browser, mobile] = await Promise.all([
    passwordLogin(concurrentDb),
    passwordLogin(concurrentDb, "/api/auth/mobile/login"),
  ]);
  expect(browser.status).toBe(200);
  expect(mobile.status).toBe(200);
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(1);
});

test("OAuth and password race leave one owner while the loser re-resolves", async () => {
  const db = await freshDb();
  const concurrentDb = synchronizeOwnerCountReads(db, 2);
  const env = envFor(concurrentDb, {
    ALLOW_UNPINNED_OWNER_CLAIM: "true",
    OIDC_OWNER_SUB: "takos:operator",
  });
  const [password, oauth] = await Promise.allSettled([
    passwordLogin(concurrentDb),
    findOrCreateOAuthActor(concurrentDb, env, "takos", oauthInfo("operator")),
  ]);
  expect(password.status).toBe("fulfilled");
  expect(password.status === "fulfilled" ? password.value.status : 0).toBe(200);
  expect(oauth.status).toBe("fulfilled");
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(1);
});

test("password owner provisioning chooses a free username when a rootless member owns tako", async () => {
  const db = await freshDb();
  await createActor(db, envFor(db), actorOptions("tako", "local:tako"));

  const response = await passwordLogin(db);
  expect(response.status).toBe(200);
  const rows = await db.select().from(actors).all();
  expect(rows.find((row) => row.takosUserId === "local:tako")?.role).toBe(
    "member",
  );
  const passwordOwner = rows.find(
    (row) => row.takosUserId === "password:owner",
  );
  expect(passwordOwner?.role).toBe("owner");
  expect(passwordOwner?.preferredUsername).not.toBe("tako");
});

test("password login can reclaim the owner slot while existing members remain members", async () => {
  const db = await freshDb();
  await createActor(db, envFor(db), actorOptions("guest", "local:guest"));

  const response = await passwordLogin(db);
  expect(response.status).toBe(200);
  const rows = await db.select().from(actors).all();
  expect(rows.find((row) => row.takosUserId === "local:guest")?.role).toBe(
    "member",
  );
  expect(rows.filter((row) => row.role === "owner")).toHaveLength(1);
});

test("password login refuses and preserves a legacy state with multiple live owners", async () => {
  const db = await freshDb();
  await createActor(db, envFor(db), actorOptions("one", "legacy:one", "owner"));
  await createActor(
    db,
    envFor(db, { singleOwner: false }),
    actorOptions("two", "legacy:two", "owner"),
  );
  const before = await db.select().from(actors).all();

  const response = await passwordLogin(db);
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "OWNER_STATE_CONFLICT" });
  expect(await db.select().from(actors).all()).toEqual(before);
});

test("public app singleOwner option is isolated and overrides request bindings", async () => {
  const db = await freshDb();
  await createActor(
    db,
    genericEnvFor(db),
    actorOptions("one", "legacy:one", "owner"),
  );
  await createActor(
    db,
    genericEnvFor(db),
    actorOptions("two", "legacy:two", "owner"),
  );
  const baseEnv = {
    APP_URL,
    DB_INSTANCE: db,
    KV: memoryKv(),
    AUTH_PASSWORD_HASH: BOOTSTRAP_TOKEN,
    YURUCOMMU_SESSION_HASH_SALT: "public-option-isolation-salt",
  };
  const restrictedEnv = { ...baseEnv, singleOwner: false };
  const genericEnv = { ...baseEnv, singleOwner: true };
  const restrictedApp = createYurucommuBackendApp({ singleOwner: true });
  const genericApp = createYurucommuBackendApp();
  const request = () =>
    new Request(`${APP_URL}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: APP_URL,
      },
      body: JSON.stringify({ password: BOOTSTRAP_TOKEN }),
    });

  const refused = await restrictedApp.fetch(request(), restrictedEnv as never);
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "OWNER_STATE_CONFLICT" });
  const legacyLogin = await genericApp.fetch(request(), genericEnv as never);
  expect(legacyLogin.status).toBe(200);
  expect(restrictedEnv.singleOwner).toBe(false);
  expect(genericEnv.singleOwner).toBe(true);
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(2);
});

test("OAuth creates an allowlisted member after an owner exists", async () => {
  const db = await freshDb();
  const env = envFor(db, {
    OIDC_OWNER_SUB: "operator",
    OIDC_ALLOWED_SUBS: "takos:guest",
  });
  const operator = await createActorFromOAuth(
    db,
    env,
    oauthInfo("operator"),
    "takos:operator",
  );
  expect(operator?.role).toBe("owner");

  const guest = await createActorFromOAuth(
    db,
    env,
    oauthInfo("guest"),
    "takos:guest",
  );
  expect(guest?.role).toBe("member");
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(1);
});

test("allowlisted OAuth member in a rootless instance remains a member", async () => {
  const db = await freshDb();
  await createActor(db, envFor(db), actorOptions("guest", "takos:guest"));
  const env = envFor(db, { OIDC_OWNER_SUB: "takos:operator" });

  const guest = await findOrCreateOAuthActor(
    db,
    env,
    "takos",
    oauthInfo("guest"),
  );
  expect(guest?.role).toBe("member");
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(0);
});

test("OAuth profile fast path cannot update a deleted and revived actor", async () => {
  const db = await freshDb();
  const original = await createActor(
    db,
    envFor(db),
    actorOptions("reused", "takos:subject"),
  );
  const gated = pauseExistingOAuthLookup(db);
  const lookup = findOrCreateOAuthActor(
    gated.db,
    envFor(gated.db),
    "takos",
    oauthInfo("subject", "Hijacked Name"),
  );

  await gated.selected;
  await db
    .update(actors)
    .set({ deletedAt: new Date().toISOString(), takosUserId: "old:subject" })
    .where(eq(actors.apId, original.apId));
  const replacement = await createActor(
    db,
    genericEnvFor(db),
    actorOptions("reused", "takos:replacement"),
  );
  const replacementName = replacement.name;
  gated.release();

  expect(await lookup).toBeUndefined();
  const stillReplacement = await db
    .select()
    .from(actors)
    .where(eq(actors.apId, original.apId))
    .get();
  expect(stillReplacement?.takosUserId).toBe("takos:replacement");
  expect(stillReplacement?.name).toBe(replacementName);
});

test("a pinned first OAuth owner may claim ownership while preexisting members stay members", async () => {
  const db = await freshDb();
  await createActor(
    db,
    envFor(db),
    actorOptions("existing-member", "local:existing"),
  );
  const env = envFor(db, { OIDC_OWNER_SUB: "takos:operator" });

  const operator = await createActorFromOAuth(
    db,
    env,
    oauthInfo("operator"),
    "takos:operator",
  );
  expect(operator?.role).toBe("owner");
  const rows = await db.select().from(actors).all();
  expect(rows.find((row) => row.takosUserId === "local:existing")?.role).toBe(
    "member",
  );
  expect(rows.filter((row) => row.role === "owner")).toHaveLength(1);
});

test("an allowlist alone cannot bootstrap a rootless OAuth owner", async () => {
  const db = await freshDb();
  const refused = await createActorFromOAuth(
    db,
    envFor(db, { OIDC_ALLOWED_SUBS: "takos:guest" }),
    oauthInfo("guest"),
    "takos:guest",
  );
  expect(refused).toBeNull();
  expect(await db.select().from(actors).all()).toHaveLength(0);
});

test("simultaneous first OAuth owner claims leave exactly one live owner", async () => {
  const db = await freshDb();
  const concurrentDb = synchronizeOwnerCountReads(db, 2);
  const env = envFor(concurrentDb, { ALLOW_UNPINNED_OWNER_CLAIM: "true" });

  const [left, right] = await Promise.all([
    findOrCreateOAuthActor(concurrentDb, env, "takos", oauthInfo("left")),
    findOrCreateOAuthActor(concurrentDb, env, "takos", oauthInfo("right")),
  ]);
  expect([left, right].filter((actor) => actor?.role === "owner")).toHaveLength(
    1,
  );
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(1);
});

test("simultaneous first OAuth requests for the same subject resolve to the same owner", async () => {
  const db = await freshDb();
  const concurrentDb = synchronizeOwnerCountReads(db, 2);
  const env = envFor(concurrentDb, { ALLOW_UNPINNED_OWNER_CLAIM: "true" });

  const [left, right] = await Promise.all([
    findOrCreateOAuthActor(concurrentDb, env, "takos", oauthInfo("same")),
    findOrCreateOAuthActor(concurrentDb, env, "takos", oauthInfo("same")),
  ]);
  expect(left?.apId).toBeTruthy();
  expect(right?.apId).toBe(left?.apId);
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(1);
});

test("a losing OAuth first-owner attempt is refused and does not auto-promote a member", async () => {
  const db = await freshDb();
  await createActor(db, envFor(db), actorOptions("member", "local:member"));

  const result = await createActorFromOAuth(
    db,
    envFor(db, { OIDC_OWNER_SUB: "operator" }),
    oauthInfo("intruder"),
    "takos:intruder",
  );
  expect(result).toBeNull();
  expect(
    await db.select().from(actors).where(eq(actors.role, "owner")).all(),
  ).toHaveLength(0);
});

test("a losing tombstone owner revival preserves the tombstone and its Delete projection", async () => {
  const db = await freshDb();
  await createActor(
    db,
    envFor(db),
    actorOptions("winner", "local:winner", "owner"),
  );
  const { apId, deleteActivityId } = await seedDeleteTombstone(db, "revived");
  const tombstoneSessionId = await seedSession(db, apId, "losing-revive");

  let conflict: unknown;
  try {
    await createActor(
      db,
      envFor(db),
      actorOptions("revived", "local:revived", "owner"),
    );
  } catch (error) {
    conflict = error;
  }
  expect(conflict).toMatchObject({
    code: "OWNER_CLAIM_CONFLICT",
    statusCode: 409,
  });
  expect(
    await db
      .select()
      .from(actors)
      .where(and(eq(actors.apId, apId), isNotNull(actors.deletedAt)))
      .get(),
  ).toBeTruthy();
  expect(
    await db
      .select()
      .from(activities)
      .where(eq(activities.apId, deleteActivityId))
      .get(),
  ).toBeTruthy();
  expect(
    await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.activityApId, deleteActivityId))
      .all(),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, tombstoneSessionId))
      .get(),
  ).toBeTruthy();
});

test("successful single-owner tombstone revival cancels its Delete projection", async () => {
  const db = await freshDb();
  const { apId, deleteActivityId } = await seedDeleteTombstone(db, "revived");
  const tombstoneSessionId = await seedSession(db, apId, "successful-revive");

  const revived = await createActor(
    db,
    envFor(db),
    actorOptions("revived", "local:revived", "owner"),
  );
  expect(revived.apId).toBe(apId);
  expect(revived.deletedAt).toBeNull();
  expect(
    await db
      .select()
      .from(activities)
      .where(eq(activities.apId, deleteActivityId))
      .get(),
  ).toBeUndefined();
  expect(
    await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.activityApId, deleteActivityId))
      .all(),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, tombstoneSessionId))
      .get(),
  ).toBeUndefined();
});

test("failed tombstone revival update rolls back cancellation of Delete rows", async () => {
  const db = await freshDb();
  const { apId, deleteActivityId } = await seedDeleteTombstone(db, "revived");
  const tombstoneSessionId = await seedSession(db, apId, "failed-revive");
  const client = (
    db as unknown as { $client: { execute: (sql: string) => Promise<unknown> } }
  ).$client;
  await client.execute(`
    CREATE TRIGGER reject_atomic_owner_revive
    BEFORE UPDATE ON actors
    WHEN NEW.ap_id = '${apId}' AND NEW.deleted_at IS NULL
    BEGIN
      SELECT RAISE(ABORT, 'simulated owner revival failure');
    END;
  `);

  await expect(
    createActor(
      db,
      envFor(db),
      actorOptions("revived", "local:revived", "owner"),
    ),
  ).rejects.toThrow();
  expect(
    await db
      .select()
      .from(actors)
      .where(and(eq(actors.apId, apId), isNotNull(actors.deletedAt)))
      .get(),
  ).toBeTruthy();
  expect(
    await db
      .select()
      .from(activities)
      .where(eq(activities.apId, deleteActivityId))
      .get(),
  ).toBeTruthy();
  expect(
    await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.activityApId, deleteActivityId))
      .all(),
  ).toHaveLength(1);
  expect(
    await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, tombstoneSessionId))
      .get(),
  ).toBeTruthy();
});

test("stale owner snapshot cannot rotate a session after the actor identity changes", async () => {
  const db = await freshDb();
  const actor = await createActor(
    db,
    envFor(db),
    actorOptions("stale", "local:stale"),
  );
  await db
    .update(actors)
    .set({
      publicKeyPem: "replacement-public-key",
      takosUserId: "local:replacement",
    })
    .where(eq(actors.apId, actor.apId));
  const app = sessionRotationApp(db, actor.apId, {
    publicKeyPem: actor.publicKeyPem,
    takosUserId: actor.takosUserId,
  });

  const response = await app.fetch(
    new Request(`${APP_URL}/rotate`),
    envFor(db),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({
    code: "ACTOR_IDENTITY_CONFLICT",
  });
  expect(response.headers.get("set-cookie")).toBeNull();
  expect(await db.select().from(sessions).all()).toHaveLength(0);
});
