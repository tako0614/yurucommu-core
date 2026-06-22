import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, sessions } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import authRoutes from "../../routes/auth.ts";
import { createActor } from "../../routes/auth-helpers.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";

/**
 * POST /api/auth/switch — account switching.
 *
 * Asserts the two invariants of the #8 hardening:
 *  - the IDOR gate: a target that is not the root owner or one of its
 *    sub-accounts is rejected (403); a non-existent target is 404;
 *  - no token carryover: switching rotates the session (new id, old deleted)
 *    AND the new session carries NO provider / OAuth tokens, so the owner's
 *    encrypted credentials never attach to a sub-account session.
 */

const APP_URL = "https://yuru.test";
const env = { APP_URL } as unknown as Env;

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function contextActor(apId: string): Actor {
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
    role: "owner",
    created_at: new Date().toISOString(),
  };
}

function appWith(db: Database, actor: Actor): Hono {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/api/auth", authRoutes);
  return app as unknown as Hono;
}

// Seed a live session for `memberApId` carrying provider OAuth tokens, return
// the RAW cookie value (the DB stores only its salted hash).
async function seedSession(db: Database, memberApId: string): Promise<string> {
  const raw = `raw-${memberApId.split("/").pop()}-${Math.floor(performance.now())}`;
  const key = await hashSessionIdForEnv(env, raw);
  await db.insert(sessions).values({
    id: key,
    memberId: memberApId,
    accessToken: key,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    provider: "takos",
    providerAccessToken: "enc-access-token",
    providerRefreshToken: "enc-refresh-token",
    providerTokenExpiresAt: new Date(Date.now() + 1800_000).toISOString(),
  });
  return raw;
}

async function postSwitch(app: Hono, rawSession: string, apId: string) {
  return app.request(
    "/api/auth/switch",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `session=${rawSession}`,
      },
      body: JSON.stringify({ ap_id: apId }),
    },
    env,
  );
}

async function seedOwnerAndSub(db: Database) {
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
  return { owner, sub };
}

test("switch to an owned sub-account rotates the session and DROPS provider tokens", async () => {
  const db = await freshDb();
  const { owner, sub } = await seedOwnerAndSub(db);
  const raw = await seedSession(db, owner.apId);

  const app = appWith(db, contextActor(owner.apId));
  const res = await postSwitch(app, raw, sub.apId);
  expect(res.status).toBe(200);

  // The old session was invalidated (rotated, not repointed in place).
  const oldKey = await hashSessionIdForEnv(env, raw);
  const old = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, oldKey))
    .get();
  expect(old).toBeUndefined();

  // The new session points at the sub-account and carries NO provider/OAuth tokens.
  const fresh = await db
    .select()
    .from(sessions)
    .where(eq(sessions.memberId, sub.apId))
    .get();
  expect(fresh).toBeTruthy();
  expect(fresh?.provider).toBeNull();
  expect(fresh?.providerAccessToken).toBeNull();
  expect(fresh?.providerRefreshToken).toBeNull();
  expect(fresh?.providerTokenExpiresAt).toBeNull();
});

test("switch to an UNOWNED actor is rejected (403 IDOR gate)", async () => {
  const db = await freshDb();
  const { owner } = await seedOwnerAndSub(db);
  // A standalone actor with no ownership link to the owner.
  const stranger = await createActor(db, env, {
    username: "stranger",
    name: "stranger",
    takosUserId: "oauth:stranger",
    role: "member",
  });
  const raw = await seedSession(db, owner.apId);

  const app = appWith(db, contextActor(owner.apId));
  const res = await postSwitch(app, raw, stranger.apId);
  expect(res.status).toBe(403);

  // The owner's session was NOT rotated/cleared by the rejected attempt.
  const stillOwner = await db
    .select({ provider: sessions.provider })
    .from(sessions)
    .where(eq(sessions.memberId, owner.apId))
    .get();
  expect(stillOwner?.provider).toBe("takos");
  // No session was created for the stranger.
  const strangerSession = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.memberId, stranger.apId))
    .get();
  expect(strangerSession).toBeUndefined();
});

test("switch to a non-existent actor is 404", async () => {
  const db = await freshDb();
  const { owner } = await seedOwnerAndSub(db);
  const raw = await seedSession(db, owner.apId);

  const app = appWith(db, contextActor(owner.apId));
  const res = await postSwitch(app, raw, `${APP_URL}/ap/users/ghost`);
  expect(res.status).toBe(404);
});
