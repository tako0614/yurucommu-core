import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { registerMembershipMemberRoutes } from "../../routes/communities/membership-members.ts";

// Audit #10 finding #3: a REMOTE community member has no communityMembers row —
// their membership is the accepted follows edge to the Group actor (which the
// Announce-relay fan-out and the members-only post gate both key on). The kick
// endpoint only looked at communityMembers and 404'd any remote actor, so a
// moderator had NO way to remove a remote member. The handler now also removes
// the follows edge.

const APP_URL = "https://yuru.test";
const GROUP = `${APP_URL}/ap/groups/town`;
const OWNER = `${APP_URL}/ap/users/owner`;
const REMOTE = "https://remote.example/users/raider";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const f of [
    "0001_init.sql",
    "0002_social_remote_actor_edges.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
    "0015_community_bans.sql",
  ]) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seed(db: Database): Promise<void> {
  await db.insert(actors).values({
    apId: OWNER,
    type: "Person",
    preferredUsername: "owner",
    inbox: `${OWNER}/inbox`,
    outbox: `${OWNER}/outbox`,
    followersUrl: `${OWNER}/followers`,
    followingUrl: `${OWNER}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(communities).values({
    apId: GROUP,
    preferredUsername: "town",
    name: "town",
    inbox: `${GROUP}/inbox`,
    outbox: `${GROUP}/outbox`,
    followersUrl: `${GROUP}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: OWNER,
    memberCount: 1,
  });
  await db
    .insert(communityMembers)
    .values({ communityApId: GROUP, actorApId: OWNER, role: "owner" });
  // Remote member: accepted follows edge to the Group, NO communityMembers row.
  await db.insert(follows).values({
    followerApId: REMOTE,
    followingApId: GROUP,
    status: "accepted",
    acceptedAt: "2026-01-01T00:00:00.000Z",
  });
}

function ownerActor(): Actor {
  return { ap_id: OWNER, role: "member" } as unknown as Actor;
}

function appFor(db: Database) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  registerMembershipMemberRoutes(router);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor());
    await next();
  });
  app.route("/api/communities", router);
  return app;
}

const env = { APP_URL, DB_INSTANCE: undefined } as unknown as Env;

test("an owner can kick a REMOTE member (the follows edge is deleted)", async () => {
  const db = await freshDb();
  await seed(db);
  const app = appFor(db);

  const res = await app.fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(REMOTE)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(res.status).toBe(200);

  const edge = await db
    .select({ f: follows.followerApId })
    .from(follows)
    .where(
      and(eq(follows.followerApId, REMOTE), eq(follows.followingApId, GROUP)),
    )
    .get();
  expect(edge).toBeUndefined(); // removed from the relay + members-only gate
});

test("kicking an actor who is neither a local member nor a remote follower 404s", async () => {
  const db = await freshDb();
  await seed(db);
  const app = appFor(db);

  const stranger = "https://remote.example/users/nobody";
  const res = await app.fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(stranger)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(res.status).toBe(404);
});

// Audit #18: a moderator may remove only plain MEMBERS — removing a peer
// moderator (or an owner) requires owner role. Without this a single moderator
// could kick the entire peer-moderator team.
test("a moderator CANNOT remove a peer moderator (single DELETE) but CAN remove a member", async () => {
  const db = await freshDb();
  await seed(db);
  const mod = `${APP_URL}/ap/users/mod`;
  const mod2 = `${APP_URL}/ap/users/mod2`;
  const member = `${APP_URL}/ap/users/member`;
  for (const [apId, role] of [
    [mod, "moderator"],
    [mod2, "moderator"],
    [member, "member"],
  ] as const) {
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: apId.split("/").pop()!,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "pub",
      privateKeyPem: "priv",
    });
    await db
      .insert(communityMembers)
      .values({ communityApId: GROUP, actorApId: apId, role });
  }

  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  registerMembershipMemberRoutes(router);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: mod, role: "member" } as unknown as Actor);
    await next();
  });
  app.route("/api/communities", router);

  // mod removing mod2 (a peer moderator) → 403.
  const denied = await app.fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(mod2)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(denied.status).toBe(403);
  expect(
    (
      await db
        .select()
        .from(communityMembers)
        .where(eq(communityMembers.actorApId, mod2))
        .get()
    )?.role,
  ).toBe("moderator"); // still a member

  // mod removing a plain member → allowed.
  const ok = await app.fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(member)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(ok.status).toBe(200);
  expect(
    await db
      .select()
      .from(communityMembers)
      .where(eq(communityMembers.actorApId, member))
      .get(),
  ).toBeUndefined();
});

test("batch-remove routes an owner target through the last-owner guard (co-owner removable, count preserved)", async () => {
  const db = await freshDb();
  await seed(db);
  const owner2 = `${APP_URL}/ap/users/owner2`;
  await db.insert(actors).values({
    apId: owner2,
    type: "Person",
    preferredUsername: "owner2",
    inbox: `${owner2}/inbox`,
    outbox: `${owner2}/outbox`,
    followersUrl: `${owner2}/followers`,
    followingUrl: `${owner2}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db
    .insert(communityMembers)
    .values({ communityApId: GROUP, actorApId: owner2, role: "owner" });

  // OWNER (the actor) batch-removes co-owner owner2; another owner (the actor)
  // remains, so removeOwnerIfAnotherExists permits it.
  const app = appFor(db);
  const res = await app.fetch(
    new Request(`${APP_URL}/api/communities/town/members/batch/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor_ap_ids: [owner2] }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: { success: boolean }[] };
  expect(body.results[0].success).toBe(true);
  expect(
    await db
      .select()
      .from(communityMembers)
      .where(eq(communityMembers.actorApId, owner2))
      .get(),
  ).toBeUndefined();
  // The original owner is still an owner — community not orphaned.
  expect(
    (
      await db
        .select()
        .from(communityMembers)
        .where(eq(communityMembers.actorApId, OWNER))
        .get()
    )?.role,
  ).toBe("owner");
});
