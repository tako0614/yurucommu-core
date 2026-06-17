import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

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

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { count, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import authRoutes from "../../routes/auth.ts";
import { createActor } from "../../routes/auth-helpers.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  await client.execute("PRAGMA foreign_keys = ON");
  return drizzle(client, { schema }) as unknown as Database;
}

const env = { APP_URL } as unknown as Env;

/** Build a minimal context Actor that matches a persisted actor row. */
function contextActor(
  apId: string,
  role: "owner" | "moderator" | "member",
): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: apId.split("/").pop() ?? "x",
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role,
    created_at: new Date().toISOString(),
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

  const app = appWith(db, contextActor(owner.apId, "owner"));
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

  const app = appWith(db, contextActor(member.apId, "member"));
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
  const app = appWith(db, contextActor(sub.apId, "member"));
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

  const app = appWith(db, contextActor(owner.apId, "owner"));

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
