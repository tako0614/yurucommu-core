import { expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityBans,
  communityMembers,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import { registerMembershipJoinRoutes } from "../../routes/communities/membership-join.ts";
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
  return (await createTestDb()).db;
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

function localActor(apId: string = OWNER): Actor {
  return { ap_id: apId, role: "member" } as unknown as Actor;
}

function appFor(db: Database, actorApId: string = OWNER) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  registerMembershipJoinRoutes(router);
  registerMembershipMemberRoutes(router);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", localActor(actorApId));
    await next();
  });
  app.route("/api/communities", router);
  return app;
}

async function seedLocalMember(
  db: Database,
  apId: string,
  role: "owner" | "moderator" | "member" = "member",
): Promise<void> {
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
  await db
    .update(communities)
    .set({ memberCount: sql`${communities.memberCount} + 1` })
    .where(eq(communities.apId, GROUP));
}

async function rejectCommunityBanWrites(db: Database): Promise<void> {
  await db.run(sql`
    CREATE TRIGGER reject_community_ban
    BEFORE INSERT ON community_bans
    BEGIN
      SELECT RAISE(ABORT, 'injected community ban failure');
    END
  `);
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

test("batch-remove durably bans a local member so an open join cannot immediately re-admit them", async () => {
  const db = await freshDb();
  await seed(db);
  const member = `${APP_URL}/ap/users/member`;
  await seedLocalMember(db, member);

  const ownerApp = appFor(db);
  const removed = await ownerApp.fetch(
    new Request(`${APP_URL}/api/communities/town/members/batch/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor_ap_ids: [member] }),
    }),
    env,
  );
  expect(removed.status).toBe(200);
  expect((await removed.json()) as unknown).toMatchObject({
    results: [{ ap_id: member, success: true }],
    removed_count: 1,
  });

  const memberApp = appFor(db, member);
  const rejoin = await memberApp.fetch(
    new Request(`${APP_URL}/api/communities/town/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    }),
    env,
  );
  expect(rejoin.status).toBe(403);
  expect((await rejoin.json()) as unknown).toMatchObject({ status: "banned" });
  expect(
    await db
      .select()
      .from(communityBans)
      .where(
        and(
          eq(communityBans.communityApId, GROUP),
          eq(communityBans.bannedApId, member),
        ),
      )
      .get(),
  ).toBeDefined();
});

test("batch-remove rolls back the member removal when its durable ban cannot commit", async () => {
  const db = await freshDb();
  await seed(db);
  const member = `${APP_URL}/ap/users/member`;
  await seedLocalMember(db, member);
  await rejectCommunityBanWrites(db);

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/town/members/batch/remove`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor_ap_ids: [member] }),
    }),
    env,
  );
  expect(res.status).toBe(200);
  expect((await res.json()) as unknown).toMatchObject({
    results: [{ ap_id: member, success: false, error: "Internal error" }],
    removed_count: 0,
  });
  expect(
    await db
      .select()
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, GROUP),
          eq(communityMembers.actorApId, member),
        ),
      )
      .get(),
  ).toBeDefined();
  expect(
    (
      await db
        .select({ memberCount: communities.memberCount })
        .from(communities)
        .where(eq(communities.apId, GROUP))
        .get()
    )?.memberCount,
  ).toBe(2);
});

test("single remote-member removal rolls back its follows edge when the durable ban cannot commit", async () => {
  const db = await freshDb();
  await seed(db);
  await rejectCommunityBanWrites(db);

  const res = await appFor(db).fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(REMOTE)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(res.status).toBe(500);
  expect(
    await db
      .select()
      .from(follows)
      .where(
        and(eq(follows.followerApId, REMOTE), eq(follows.followingApId, GROUP)),
      )
      .get(),
  ).toBeDefined();
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
  expect(
    await db
      .select()
      .from(communityBans)
      .where(
        and(
          eq(communityBans.communityApId, GROUP),
          eq(communityBans.bannedApId, owner2),
        ),
      )
      .get(),
  ).toBeDefined();
});
