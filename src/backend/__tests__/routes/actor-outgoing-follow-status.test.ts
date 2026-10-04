import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";

import { actors, actorCache, follows } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";

const APP_URL = "https://yuru.test";
const apId = (name: string) => `${APP_URL}/ap/users/${name}`;

async function insertLocalActor(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  username: string,
  counts: { followerCount?: number; followingCount?: number } = {},
): Promise<string> {
  const id = apId(username);
  await db.insert(actors).values({
    apId: id,
    type: "Person",
    preferredUsername: username,
    inbox: `${id}/inbox`,
    outbox: `${id}/outbox`,
    followersUrl: `${id}/followers`,
    followingUrl: `${id}/following`,
    publicKeyPem: "public",
    privateKeyPem: "private",
    followerCount: counts.followerCount ?? 0,
    followingCount: counts.followingCount ?? 0,
  });
  return id;
}

function appFor(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  viewer: Actor | null,
) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", viewer);
    await next();
  });
  app.route("/", actorsRoute);
  return app;
}

async function readProfile(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  viewer: Actor | null,
  target: string,
) {
  return appFor(db, viewer).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(target)}`),
    { APP_URL, DB_INSTANCE: db } as unknown as Env,
  );
}

test("local Actor reads expose only the authenticated viewer's outgoing status", async () => {
  const { db } = await createTestDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const carol = await insertLocalActor(db, "carol");
  await db.insert(follows).values([
    { followerApId: alice, followingApId: bob, status: "pending" },
    { followerApId: carol, followingApId: bob, status: "accepted" },
    { followerApId: bob, followingApId: carol, status: "accepted" },
  ]);

  const asAlice = await readProfile(db, { ap_id: alice } as Actor, bob);
  expect(asAlice.status).toBe(200);
  expect(asAlice.headers.get("cache-control")).toContain("private");
  expect(asAlice.headers.get("cache-control")).toContain("no-store");
  expect(asAlice.headers.get("vary")).toContain("Cookie");
  expect(asAlice.headers.get("vary")).toContain("Authorization");
  const aliceActor = (await asAlice.json()).actor;
  expect(aliceActor).toMatchObject({
    outgoing_follow_status: "pending",
    is_following: false,
    is_followed_by: false,
  });

  const asCarol = await readProfile(db, { ap_id: carol } as Actor, bob);
  expect((await asCarol.json()).actor).toMatchObject({
    outgoing_follow_status: "accepted",
    is_following: true,
    is_followed_by: true,
  });

  const asAnonymous = await readProfile(db, null, bob);
  expect(asAnonymous.headers.get("vary")).toContain("Cookie");
  expect(asAnonymous.headers.get("vary")).toContain("Authorization");
  const anonymousActor = (await asAnonymous.json()).actor;
  expect(anonymousActor).not.toHaveProperty("outgoing_follow_status");
  expect(anonymousActor.is_following).toBe(false);
  expect(anonymousActor.is_followed_by).toBe(false);

  const self = await readProfile(db, { ap_id: alice } as Actor, alice);
  expect((await self.json()).actor).toMatchObject({
    outgoing_follow_status: "none",
    is_following: false,
    is_followed_by: false,
  });
});

test("cached remote Actor reads resolve cosmetic IDs, ignore sibling paths, and keep legacy states inactive", async () => {
  const { db } = await createTestDb();
  const alice = await insertLocalActor(db, "alice");
  const remote = "https://remote.example/users/person";
  const cosmetic = "https://REMOTE.example:443/users/person/#profile";
  await db.insert(actorCache).values({
    apId: remote,
    type: "Person",
    preferredUsername: "person",
    inbox: `${remote}/inbox`,
    rawJson: JSON.stringify({ id: remote, type: "Person" }),
  });
  await db.insert(follows).values({
    followerApId: alice,
    followingApId: cosmetic,
    status: "pending",
  });
  await db.insert(follows).values({
    followerApId: cosmetic,
    followingApId: alice,
    status: "accepted",
  });
  const sibling = "https://remote.example/users/person-extra";
  await db.insert(follows).values({
    followerApId: alice,
    followingApId: sibling,
    status: "accepted",
  });

  const pending = await readProfile(db, { ap_id: alice } as Actor, remote);
  expect((await pending.json()).actor).toMatchObject({
    ap_id: remote,
    outgoing_follow_status: "pending",
    is_following: false,
    is_followed_by: true,
  });
  expect(pending.headers.get("cache-control")).toContain("private");
  expect(pending.headers.get("cache-control")).toContain("no-store");
  expect(pending.headers.get("vary")).toContain("Cookie");
  expect(pending.headers.get("vary")).toContain("Authorization");

  const carol = await insertLocalActor(db, "carol");
  await db.insert(follows).values({
    followerApId: carol,
    followingApId: remote,
    status: "accepted",
  });
  const asCarol = await readProfile(db, { ap_id: carol } as Actor, remote);
  expect((await asCarol.json()).actor).toMatchObject({
    outgoing_follow_status: "accepted",
    is_following: true,
  });
  expect(asCarol.headers.get("cache-control")).toContain("private");
  expect(asCarol.headers.get("vary")).toContain("Cookie");
  expect(asCarol.headers.get("vary")).toContain("Authorization");

  const anonymous = await readProfile(db, null, remote);
  const anonymousRemoteActor = (await anonymous.json()).actor;
  expect(anonymousRemoteActor).not.toHaveProperty("outgoing_follow_status");
  expect(anonymous.headers.get("vary")).toContain("Cookie");
  expect(anonymous.headers.get("vary")).toContain("Authorization");

  // A legacy duplicate pair can retain both spellings; accepted authority wins.
  await db.insert(follows).values({
    followerApId: alice,
    followingApId: remote,
    status: "accepted",
  });
  const accepted = await readProfile(db, { ap_id: alice } as Actor, remote);
  expect((await accepted.json()).actor).toMatchObject({
    outgoing_follow_status: "accepted",
    is_following: true,
  });

  // Removing every active edge is the canceled state. Rejected/unknown old
  // statuses do not grant outgoing-follow authority.
  await db.delete(follows).where(eq(follows.followerApId, alice));
  const canceled = await readProfile(db, { ap_id: alice } as Actor, remote);
  expect((await canceled.json()).actor.outgoing_follow_status).toBe("none");

  await db.run(
    sql`
      INSERT INTO follows (follower_ap_id, following_ap_id, status)
      VALUES (${alice}, ${cosmetic}, 'rejected')
    `,
  );
  const rejected = await readProfile(db, { ap_id: alice } as Actor, remote);
  expect((await rejected.json()).actor.outgoing_follow_status).toBe("none");
  await db.run(sql`
    UPDATE follows SET status = 'legacy-unknown'
    WHERE follower_ap_id = ${alice} AND following_ap_id = ${cosmetic}
  `);
  const unknown = await readProfile(db, { ap_id: alice } as Actor, remote);
  expect((await unknown.json()).actor.outgoing_follow_status).toBe("none");
});

test("local outgoing status moves from pending to accepted and clears after cancellation", async () => {
  const { db } = await createTestDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  await db.insert(follows).values({
    followerApId: alice,
    followingApId: bob,
    status: "pending",
  });

  const pending = await readProfile(db, { ap_id: alice } as Actor, bob);
  expect((await pending.json()).actor).toMatchObject({
    outgoing_follow_status: "pending",
    is_following: false,
  });

  await db
    .update(follows)
    .set({ status: "accepted" })
    .where(eq(follows.followerApId, alice));
  const accepted = await readProfile(db, { ap_id: alice } as Actor, bob);
  expect((await accepted.json()).actor).toMatchObject({
    outgoing_follow_status: "accepted",
    is_following: true,
  });

  await db.delete(follows).where(eq(follows.followerApId, alice));
  const canceled = await readProfile(db, { ap_id: alice } as Actor, bob);
  expect((await canceled.json()).actor.outgoing_follow_status).toBe("none");
});

test("profile reads leave accepted-only follow lists and denormalized counts untouched", async () => {
  const { db } = await createTestDb();
  const alice = await insertLocalActor(db, "alice", { followingCount: 1 });
  const bob = await insertLocalActor(db, "bob", { followerCount: 1 });
  const carol = await insertLocalActor(db, "carol");
  await db.insert(follows).values([
    { followerApId: alice, followingApId: bob, status: "accepted" },
    { followerApId: alice, followingApId: carol, status: "pending" },
  ]);

  const beforeAlice = await db
    .select({ followingCount: actors.followingCount })
    .from(actors)
    .where(eq(actors.apId, alice))
    .get();
  const beforeBob = await db
    .select({ followerCount: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, bob))
    .get();

  for (const viewer of [alice, carol]) {
    const response = await readProfile(
      db,
      { ap_id: viewer } as Actor,
      viewer === alice ? bob : alice,
    );
    expect(response.status).toBe(200);
  }

  const list = await appFor(db, { ap_id: alice } as Actor).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(alice)}/following`),
    { APP_URL, DB_INSTANCE: db } as unknown as Env,
  );
  expect(list.status).toBe(200);
  const listBody = (await list.json()) as {
    following: Array<{ ap_id: string }>;
    total: number;
  };
  expect(listBody.following.map((item) => item.ap_id)).toEqual([bob]);
  expect(listBody.total).toBe(1);
  expect(
    await db
      .select({ followingCount: actors.followingCount })
      .from(actors)
      .where(eq(actors.apId, alice))
      .get(),
  ).toEqual(beforeAlice);
  expect(
    await db
      .select({ followerCount: actors.followerCount })
      .from(actors)
      .where(eq(actors.apId, bob))
      .get(),
  ).toEqual(beforeBob);
});
