import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  announces,
  dmArchivedConversations,
  dmCommunityReadStatus,
  dmReadStatus,
  dmTyping,
  follows,
  likes,
  objectRecipients,
  objects,
  storyShares,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";

/**
 * Account deletion (POST /me/delete) must reconcile the COUNTERPARTIES' follower
 * /following counts when it drops the deleted actor's follow edges — the one
 * edge-removal path that used to skip the reconciliation, leaving 3rd-party
 * counts permanently inflated. A guard prevents underflow below 0.
 */

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(u: string) {
  return `${APP_URL}/ap/users/${u}`;
}

async function insertActor(
  db: Database,
  username: string,
  counts: { followerCount?: number; followingCount?: number } = {},
) {
  const apId = localApId(username);
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
    followerCount: counts.followerCount ?? 0,
    followingCount: counts.followingCount ?? 0,
  });
  return apId;
}

function ownerActor(apId: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: "tako",
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
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

function envFor(db: Database): Env {
  const q = {
    send: () => Promise.resolve(),
    sendBatch: () => Promise.resolve(),
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: q,
    DELIVERY_DLQ: { send: () => Promise.resolve() },
  } as unknown as Env;
}

async function follow(db: Database, follower: string, following: string) {
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: following,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
}

const countOf = async (db: Database, apId: string) =>
  db
    .select({
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
    })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();

test("deleting an account decrements counterparties' follower/following counts (guarded)", async () => {
  const db = await freshDb();
  const tako = await insertActor(db, "tako"); // the account being deleted
  const alice = await insertActor(db, "alice", { followerCount: 1 }); // tako -> alice
  const bob = await insertActor(db, "bob", { followingCount: 1 }); // bob -> tako
  const carol = await insertActor(db, "carol", { followerCount: 0 }); // tako -> carol, but count already 0 (guard)

  await follow(db, tako, alice); // alice gains tako as a follower
  await follow(db, bob, tako); // bob follows tako
  await follow(db, tako, carol);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor(tako));
    await next();
  });
  app.route("/", actorsRoute);

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(res.status).toBe(200);

  // alice lost tako as a follower; bob lost tako from its following.
  expect((await countOf(db, alice))?.followerCount).toBe(0);
  expect((await countOf(db, bob))?.followingCount).toBe(0);
  // carol's count was already 0 — the gt(...,0) guard keeps it at 0, not -1.
  expect((await countOf(db, carol))?.followerCount).toBe(0);
});

// Audit #13 finding #2: a PENDING follow edge never incremented either counter
// (the +1 happens only on Accept), so the account-delete reconcile must NOT
// decrement a counterparty for a pending edge — it would under-count a real,
// nonzero accepted-follower total.
test("account deletion does NOT decrement a counterparty for a PENDING (never-counted) follow edge", async () => {
  const db = await freshDb();
  const tako = await insertActor(db, "tako"); // being deleted
  // alice's stored followerCount=1 reflects her ONE real accepted follower (bob);
  // tako has only a PENDING request to alice (which never bumped her count).
  const alice = await insertActor(db, "alice", { followerCount: 1 });
  const bob = await insertActor(db, "bob");
  await follow(db, bob, alice); // accepted bob -> alice (the edge behind count=1)
  await db.insert(follows).values({
    followerApId: tako,
    followingApId: alice,
    status: "pending", // never incremented alice.followerCount
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor(tako));
    await next();
  });
  app.route("/", actorsRoute);
  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(res.status).toBe(200);

  // alice keeps her true count (1) — the pending edge must not have decremented it.
  expect((await countOf(db, alice))?.followerCount).toBe(1);
});

async function insertPost(
  db: Database,
  apId: string,
  author: string,
  counts: { like?: number; announce?: number; reply?: number } = {},
  inReplyTo?: string,
) {
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "x",
    visibility: "public",
    published: new Date().toISOString(),
    isLocal: 1,
    inReplyTo: inReplyTo ?? null,
    likeCount: counts.like ?? 0,
    announceCount: counts.announce ?? 0,
    replyCount: counts.reply ?? 0,
  });
}

const objCounts = async (db: Database, apId: string) =>
  db
    .select({
      likeCount: objects.likeCount,
      announceCount: objects.announceCount,
      replyCount: objects.replyCount,
    })
    .from(objects)
    .where(eq(objects.apId, apId))
    .get();

test("deleting an account reconciles like/announce/reply counters on OTHER actors' posts", async () => {
  const db = await freshDb();
  const tako = await insertActor(db, "tako"); // being deleted
  await insertActor(db, "alice");
  const bob = await insertActor(db, "bob");

  // alice's post: 1 like + 1 announce (both by tako), 3 replies (2 by tako, 1 by bob).
  const alicePost = `${APP_URL}/ap/objects/alice-1`;
  await insertPost(db, alicePost, localApId("alice"), {
    like: 1,
    announce: 1,
    reply: 3,
  });
  await db.insert(likes).values({
    actorApId: tako,
    objectApId: alicePost,
    activityApId: `${APP_URL}/ap/activities/like-1`,
  });
  await db.insert(announces).values({
    actorApId: tako,
    objectApId: alicePost,
    activityApId: `${APP_URL}/ap/activities/ann-1`,
  });
  await insertPost(db, `${APP_URL}/ap/objects/tako-r1`, tako, {}, alicePost);
  await insertPost(db, `${APP_URL}/ap/objects/tako-r2`, tako, {}, alicePost);
  await insertPost(db, `${APP_URL}/ap/objects/bob-r1`, bob, {}, alicePost);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor(tako));
    await next();
  });
  app.route("/", actorsRoute);

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(res.status).toBe(200);

  const after = await objCounts(db, alicePost);
  expect(after?.likeCount).toBe(0); // 1 - 1 (tako's like removed)
  expect(after?.announceCount).toBe(0); // 1 - 1
  // 3 -> 1: recompute counts only the surviving reply (bob's); tako's 2 replies
  // are deleted. A flat -1 would have wrongly left 2.
  expect(after?.replyCount).toBe(1);
});

const rowCount = async (
  db: Database,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: Promise<any[]>,
): Promise<number> => (await query).length;

test("account deletion reaps story_shares (+reconciles shareCount) and DM-status / authored-object_recipients orphans", async () => {
  const db = await freshDb();
  const tako = await insertActor(db, "tako"); // being deleted
  const alice = await insertActor(db, "alice");

  // alice authored a Story shared once (by tako): share_count = 1.
  const aliceStory = `${APP_URL}/ap/objects/alice-story`;
  await db.insert(objects).values({
    apId: aliceStory,
    type: "Story",
    attributedTo: alice,
    content: "s",
    visibility: "public",
    isLocal: 1,
    shareCount: 1,
  });
  await db
    .insert(storyShares)
    .values({ id: "share-1", storyApId: aliceStory, actorApId: tako });

  // tako authored a (community-chat) object → object_recipients keyed by the
  // object id with a NON-actor recipient (the community apId), the orphan case.
  const takoMsg = `${APP_URL}/ap/objects/tako-msg`;
  const communityApId = `${APP_URL}/ap/communities/c1`;
  await insertPost(db, takoMsg, tako);
  await db.insert(objectRecipients).values({
    objectApId: takoMsg,
    recipientApId: communityApId,
    type: "audience",
  });

  // Per-actor DM status rows (no FK → no engine cascade).
  const now = new Date().toISOString();
  await db
    .insert(dmReadStatus)
    .values({ actorApId: tako, conversationId: "conv-1", lastReadAt: now });
  await db
    .insert(dmArchivedConversations)
    .values({ actorApId: tako, conversationId: "conv-1" });
  await db
    .insert(dmCommunityReadStatus)
    .values({ actorApId: tako, communityApId, lastReadAt: now });
  await db
    .insert(dmTyping)
    .values({ actorApId: tako, recipientApId: alice, lastTypedAt: now });
  // A row where tako is the typing RECIPIENT (someone typing to tako) — must
  // also be reaped (the OR branch).
  await db
    .insert(dmTyping)
    .values({ actorApId: alice, recipientApId: tako, lastTypedAt: now });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor(tako));
    await next();
  });
  app.route("/", actorsRoute);

  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    envFor(db),
  );
  expect(res.status).toBe(200);

  // story_shares by tako are gone, and alice's surviving story's share_count is
  // reconciled to 0 (not left permanently inflated).
  expect(
    await rowCount(
      db,
      db.select().from(storyShares).where(eq(storyShares.actorApId, tako)),
    ),
  ).toBe(0);
  expect((await objCounts(db, aliceStory))?.likeCount).toBe(0); // sanity: row survives
  const aliceStoryRow = await db
    .select({ shareCount: objects.shareCount })
    .from(objects)
    .where(eq(objects.apId, aliceStory))
    .get();
  expect(aliceStoryRow?.shareCount).toBe(0);

  // authored-object object_recipients orphan (keyed by the community apId, not
  // by tako) is reaped.
  expect(
    await rowCount(
      db,
      db
        .select()
        .from(objectRecipients)
        .where(eq(objectRecipients.objectApId, takoMsg)),
    ),
  ).toBe(0);

  // All per-actor DM status rows are purged.
  expect(
    await rowCount(
      db,
      db.select().from(dmReadStatus).where(eq(dmReadStatus.actorApId, tako)),
    ),
  ).toBe(0);
  expect(
    await rowCount(
      db,
      db
        .select()
        .from(dmArchivedConversations)
        .where(eq(dmArchivedConversations.actorApId, tako)),
    ),
  ).toBe(0);
  expect(
    await rowCount(
      db,
      db
        .select()
        .from(dmCommunityReadStatus)
        .where(eq(dmCommunityReadStatus.actorApId, tako)),
    ),
  ).toBe(0);
  // Both dm_typing rows (tako as actor AND tako as recipient) are gone.
  expect(await rowCount(db, db.select().from(dmTyping))).toBe(0);
});
