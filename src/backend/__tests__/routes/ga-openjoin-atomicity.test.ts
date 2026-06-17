import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #15 — open-join member-insert + memberCount bump atomicity.
 *
 * The open-join path (joinPolicy "open") used to insert the member row and bump
 * the denormalized memberCount as two separate statements, so a mid-request
 * failure could drift the counter relative to the membership table. This mirrors
 * the deliberately-atomic invite-join path: both writes must run in a single
 * `db.batch([...])` so the counter cannot diverge.
 *
 * A successful open join creates exactly one membership row and bumps the count
 * by exactly one; a duplicate join must not double-bump the count.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { registerMembershipJoinRoutes } from "../../routes/communities/membership-join.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function communityApId(username: string): string {
  return `${APP_URL}/ap/groups/${username}`;
}

function actorApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertActor(db: Database, username: string): Promise<string> {
  const apId = actorApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return apId;
}

async function insertOpenCommunity(
  db: Database,
  username: string,
): Promise<string> {
  const apId = communityApId(username);
  await db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: "public",
    joinPolicy: "open",
    memberCount: 5,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: actorApId("owner"),
  });
  return apId;
}

function fakeActor(username: string): Actor {
  const apId = actorApId(username);
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
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
    role: "member",
    created_at: new Date().toISOString(),
  };
}

function appWith(db: Database, actor: Actor) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  registerMembershipJoinRoutes(router);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", router);
  return app;
}

function joinRequest(identifier: string): Request {
  return new Request(`http://local/${identifier}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function memberRow(db: Database, communityAp: string, actorAp: string) {
  return db
    .select()
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityApId, communityAp),
        eq(communityMembers.actorApId, actorAp),
      ),
    )
    .get();
}

async function memberCountOf(db: Database, communityAp: string) {
  const row = await db
    .select({ memberCount: communities.memberCount })
    .from(communities)
    .where(eq(communities.apId, communityAp))
    .get();
  return row?.memberCount ?? null;
}

const env = { APP_URL } as unknown as Env;

// ---------------------------------------------------------------------------
// Successful open join: the membership is created and the count is bumped by
// exactly one — and because the two writes are batched they cannot diverge.
// ---------------------------------------------------------------------------
test("open join: membership created + count bumped exactly once", async () => {
  const db = await freshDb();
  await insertActor(db, "owner");
  await insertActor(db, "joiner");
  const communityAp = await insertOpenCommunity(db, "club");
  const joiner = fakeActor("joiner");

  const before = await memberCountOf(db, communityAp);
  expect(before).toBe(5);

  const app = appWith(db, joiner);
  const res = await app.request(joinRequest("club"), undefined, env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { status?: string };
  expect(body.status).toBe("joined");

  expect(await memberRow(db, communityAp, joiner.ap_id)).toBeDefined();
  // The batch landed both writes: exactly one new member and one count bump.
  expect(await memberCountOf(db, communityAp)).toBe(6);
});

// ---------------------------------------------------------------------------
// Duplicate open join: the second attempt is rejected (already a member) and
// must NOT double-bump the count.
// ---------------------------------------------------------------------------
test("open join duplicate: rejected, no extra count bump", async () => {
  const db = await freshDb();
  await insertActor(db, "owner");
  await insertActor(db, "joiner");
  const communityAp = await insertOpenCommunity(db, "club");
  const joiner = fakeActor("joiner");

  const app = appWith(db, joiner);

  const first = await app.request(joinRequest("club"), undefined, env);
  expect(first.status).toBe(200);
  expect(await memberCountOf(db, communityAp)).toBe(6);

  const second = await app.request(joinRequest("club"), undefined, env);
  expect(second.status).toBe(409);

  // The membership row still exists exactly once and the count did not move.
  expect(await memberRow(db, communityAp, joiner.ap_id)).toBeDefined();
  expect(await memberCountOf(db, communityAp)).toBe(6);
});
