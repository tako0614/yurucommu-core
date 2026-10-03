import { expect, test } from "bun:test";

/**
 * GA #23 — sub-account creation must be owner-gated.
 *
 * POST /api/auth/accounts mints local sub-accounts (role "member"). Before the
 * fix any logged-in member could mint accounts. These tests assert:
 *
 *  (i)   the instance owner can create a sub-account,
 *  (ii)  a non-owner member session is rejected with 403,
 *  (iii) a sub-account (root owner IS the owner) may still create accounts
 *        (owner switched into their own sub-account), and
 *  (iv)  the per-owner sub-account cap is enforced.
 */

import { Hono } from "hono";

import { count, eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import authRoutes from "../../routes/auth.ts";
import { createActor } from "../../routes/auth-helpers.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

const env = { APP_URL } as unknown as Env;

/** Convert the persisted Drizzle actor row into the request-context shape. */
function contextActor(actor: Awaited<ReturnType<typeof createActor>>): Actor {
  return {
    ap_id: actor.apId,
    type: actor.type,
    preferred_username: actor.preferredUsername,
    name: actor.name,
    summary: actor.summary,
    icon_url: actor.iconUrl,
    header_url: actor.headerUrl,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followers_url: actor.followersUrl,
    following_url: actor.followingUrl,
    public_key_pem: actor.publicKeyPem,
    private_key_pem: actor.privateKeyPem,
    takos_user_id: actor.takosUserId,
    follower_count: actor.followerCount,
    following_count: actor.followingCount,
    post_count: actor.postCount,
    is_private: actor.isPrivate,
    role: actor.role as Actor["role"],
    created_at: actor.createdAt,
  };
}

function appWith(db: Database, actor: Actor | null): Hono {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/api/auth", authRoutes);
  return app as unknown as Hono;
}

async function postAccount(app: Hono, username: string) {
  return app.request(
    "/api/auth/accounts",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username }),
    },
    env,
  );
}

test("owner can create a sub-account", async () => {
  const db = await freshDb();
  const owner = await createActor(db, env, {
    username: "tako",
    name: "tako",
    takosUserId: "password:owner",
    role: "owner",
  });

  const app = appWith(db, contextActor(owner));
  const res = await postAccount(app, "alter");
  expect(res.status).toBe(200);

  const sub = await db
    .select({ apId: actors.apId, owner: actors.ownerActorApId })
    .from(actors)
    .where(eq(actors.preferredUsername, "alter"))
    .get();
  expect(sub?.owner).toBe(owner.apId);
});

test("non-owner member is rejected with 403", async () => {
  const db = await freshDb();
  // First actor is the owner.
  await createActor(db, env, {
    username: "tako",
    name: "tako",
    takosUserId: "password:owner",
    role: "owner",
  });
  // A standalone OAuth member with no ownership link.
  const member = await createActor(db, env, {
    username: "stranger",
    name: "stranger",
    takosUserId: "oauth:stranger",
    role: "member",
  });

  const app = appWith(db, contextActor(member));
  const res = await postAccount(app, "stranger_alt");
  expect(res.status).toBe(403);

  // No actor should have been minted.
  const exists = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.preferredUsername, "stranger_alt"))
    .get();
  expect(exists).toBeUndefined();
});

test("owner switched into their own sub-account can still create accounts", async () => {
  const db = await freshDb();
  const owner = await createActor(db, env, {
    username: "tako",
    name: "tako",
    takosUserId: "password:owner",
    role: "owner",
  });
  const sub = await createActor(db, env, {
    username: "tako_work",
    name: "tako work",
    takosUserId: "local:tako_work",
    role: "member",
    ownerActorApId: owner.apId,
  });

  // The session is currently the sub-account, but its root owner is the owner.
  const app = appWith(db, contextActor(sub));
  const res = await postAccount(app, "tako_play");
  expect(res.status).toBe(200);

  const created = await db
    .select({ owner: actors.ownerActorApId })
    .from(actors)
    .where(eq(actors.preferredUsername, "tako_play"))
    .get();
  // Ownership link resolves to the root owner, not the sub-account.
  expect(created?.owner).toBe(owner.apId);
});

test("per-owner sub-account cap is enforced", async () => {
  const db = await freshDb();
  const owner = await createActor(db, env, {
    username: "tako",
    name: "tako",
    takosUserId: "password:owner",
    role: "owner",
  });

  const app = appWith(db, contextActor(owner));

  // Seed up to the cap (MAX_SUB_ACCOUNTS = 20).
  for (let i = 0; i < 20; i++) {
    await createActor(db, env, {
      username: `sub${i}`,
      name: `sub${i}`,
      takosUserId: `local:sub${i}`,
      role: "member",
      ownerActorApId: owner.apId,
    });
  }

  const before = await db
    .select({ value: count() })
    .from(actors)
    .where(eq(actors.ownerActorApId, owner.apId))
    .get();
  expect(before?.value).toBe(20);

  const res = await postAccount(app, "one_too_many");
  expect(res.status).toBe(400);
  const body = (await res.json()) as { code?: string };
  expect(body.code).toBe("SUB_ACCOUNT_LIMIT_REACHED");
});
