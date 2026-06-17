import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #4 — single-use community-invite join race.
 *
 * The invite claim is the GATE: the conditional single-use UPDATE
 * (`usedAt IS NULL` -> set usedAt) must run FIRST, and only when it affects
 * exactly one row may the join materialize the membership + bump memberCount.
 *
 * A racing loser (claim affects 0 rows because the invite was already used)
 * must be rejected with NO phantom membership row and NO inflated memberCount.
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
  communityInvites,
  communityMembers,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { registerMembershipJoinRoutes } from "../../routes/communities/membership-join.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const sql = await readFile(new URL("0001_init.sql", root), "utf8");
  await client.executeMultiple(sql);
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

async function insertInviteCommunity(
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
    joinPolicy: "invite",
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

function joinRequest(identifier: string, inviteId: string): Request {
  return new Request(`http://local/${identifier}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invite_id: inviteId }),
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
// Losing the single-use claim race: the invite is already consumed, so the
// conditional claim affects 0 rows. The join must be rejected and must NOT
// leave a phantom membership or bump the count.
// ---------------------------------------------------------------------------
test("invite join loser (claim affects 0 rows): no membership, no count bump", async () => {
  const db = await freshDb();
  await insertActor(db, "owner");
  await insertActor(db, "winner");
  await insertActor(db, "loser");
  const communityAp = await insertInviteCommunity(db, "club");
  const loser = fakeActor("loser");

  // Simulate the winner having already consumed this single-use invite: usedAt
  // is set, so the loser's conditional claim (usedAt IS NULL) affects 0 rows.
  await db.insert(communityInvites).values({
    id: "invite-1",
    communityApId: communityAp,
    invitedByApId: actorApId("owner"),
    invitedApId: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    usedAt: new Date().toISOString(),
    usedByApId: actorApId("winner"),
  });

  const before = await memberCountOf(db, communityAp);
  expect(before).toBe(5);

  const app = appWith(db, loser);
  const res = await app.request(joinRequest("club", "invite-1"), undefined, env);

  expect(res.status).toBe(403);
  const body = (await res.json()) as { status?: string };
  expect(body.status).toBe("invite_required");

  // The losing claim must not have materialized anything.
  expect(await memberRow(db, communityAp, loser.ap_id)).toBeUndefined();
  expect(await memberCountOf(db, communityAp)).toBe(5);

  // And the invite is unchanged (still claimed by the original winner).
  const invite = await db
    .select()
    .from(communityInvites)
    .where(eq(communityInvites.id, "invite-1"))
    .get();
  expect(invite?.usedByApId).toBe(actorApId("winner"));
});

// ---------------------------------------------------------------------------
// Winning the claim: claim affects exactly 1 row, so the membership is created
// and the count is bumped atomically; the invite is marked used by the winner.
// ---------------------------------------------------------------------------
test("invite join winner (claim affects 1 row): membership + count bump + invite claimed", async () => {
  const db = await freshDb();
  await insertActor(db, "owner");
  await insertActor(db, "winner");
  const communityAp = await insertInviteCommunity(db, "club");
  const winner = fakeActor("winner");

  await db.insert(communityInvites).values({
    id: "invite-2",
    communityApId: communityAp,
    invitedByApId: actorApId("owner"),
    invitedApId: null,
    createdAt: new Date().toISOString(),
    expiresAt: null,
    usedAt: null,
    usedByApId: null,
  });

  const app = appWith(db, winner);
  const res = await app.request(joinRequest("club", "invite-2"), undefined, env);

  expect(res.status).toBe(200);
  const body = (await res.json()) as { status?: string };
  expect(body.status).toBe("joined");

  expect(await memberRow(db, communityAp, winner.ap_id)).toBeDefined();
  expect(await memberCountOf(db, communityAp)).toBe(6);

  const invite = await db
    .select()
    .from(communityInvites)
    .where(eq(communityInvites.id, "invite-2"))
    .get();
  expect(invite?.usedByApId).toBe(winner.ap_id);
  expect(invite?.usedAt).not.toBeNull();
});
