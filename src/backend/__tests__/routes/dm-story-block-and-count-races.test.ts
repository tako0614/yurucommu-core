import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
/**
 * G10 regression tests: DM/story block-bypass and follower-count races.
 *
 * These exercise the real route handlers and shared helpers against an
 * in-memory libsql database with the production migrations applied, so the
 * assertions reflect actual SQL behaviour rather than mock bookkeeping.
 */

import { Hono } from "hono";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  blocks,
  follows,
  inbox,
  likes,
  objects,
  storyShares,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/messages.ts";
import storyRoutes from "../../routes/stories/interactions.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import followRoutes from "../../routes/follow.ts";
import { undoInteraction } from "../../routes/activitypub/handlers/inbox-shared-helpers.ts";
import {
  handleAccept,
  handleUndo,
} from "../../routes/activitypub/handlers/inbox-follow-handlers.ts";
import type {
  Activity as InboxActivity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0004_blocklist.sql",
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
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
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
  });
  return apId;
}

function fakeActor(apId: string, username: string): Actor {
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

function appWith(
  db: Database,
  actor: Actor | null,
  router: Hono<{ Bindings: Env; Variables: Variables }>,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", router);
  return app;
}

function envFor(db: Database): Env {
  // Only APP_URL and DB_INSTANCE are read by the handlers under test; the
  // remaining platform bindings are unused on these code paths.
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

test("DM send is rejected when recipient has blocked the sender", async () => {
  const db = await freshDb();
  const senderApId = await insertLocalActor(db, "sender");
  const recipientApId = await insertLocalActor(db, "recipient");

  // recipient blocks sender
  await db.insert(blocks).values({
    blockerApId: recipientApId,
    blockedApId: senderApId,
  });

  const app = appWith(db, fakeActor(senderApId, "sender"), dmRoutes);
  const res = await app.fetch(
    new Request(
      `${APP_URL}/user/${encodeURIComponent(recipientApId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      },
    ),
    envFor(db),
  );

  // 404 (same as missing user) so the block is not leaked.
  expect(res.status).toEqual(404);

  // No DM Note row should have been created.
  const notes = await db.select().from(objects).where(eq(objects.type, "Note"));
  expect(notes.length).toEqual(0);
});

test("DM send succeeds when there is no block", async () => {
  const db = await freshDb();
  const senderApId = await insertLocalActor(db, "sender");
  const recipientApId = await insertLocalActor(db, "recipient");

  const app = appWith(db, fakeActor(senderApId, "sender"), dmRoutes);
  const res = await app.fetch(
    new Request(
      `${APP_URL}/user/${encodeURIComponent(recipientApId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      },
    ),
    envFor(db),
  );

  expect(res.status).toEqual(201);
  const notes = await db.select().from(objects).where(eq(objects.type, "Note"));
  expect(notes.length).toEqual(1);
});

test("deleting a DM also removes its delivery activity + recipient inbox row (no orphan notification)", async () => {
  const db = await freshDb();
  const senderApId = await insertLocalActor(db, "sender");
  const recipientApId = await insertLocalActor(db, "recipient");

  const app = appWith(db, fakeActor(senderApId, "sender"), dmRoutes);
  const sendRes = await app.fetch(
    new Request(
      `${APP_URL}/user/${encodeURIComponent(recipientApId)}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "secret dm" }),
      },
    ),
    envFor(db),
  );
  expect(sendRes.status).toEqual(201);
  const dmApId = ((await sendRes.json()) as { message: { id: string } }).message
    .id;

  // Delivery created a Create activity + the recipient's inbox row.
  expect(
    (
      await db
        .select()
        .from(activities)
        .where(eq(activities.objectApId, dmApId))
    ).length,
  ).toEqual(1);
  expect(
    (await db.select().from(inbox).where(eq(inbox.actorApId, recipientApId)))
      .length,
  ).toEqual(1);

  // Delete the DM.
  const delRes = await app.fetch(
    new Request(`${APP_URL}/messages/${encodeURIComponent(dmApId)}`, {
      method: "DELETE",
    }),
    envFor(db),
  );
  expect(delRes.status).toEqual(200);

  // Object, delivery activity, AND inbox row are all gone — no orphan that the
  // notifications query (LEFT JOIN to the now-missing object) would resurface
  // as a blank "mention" with a dead link.
  expect(
    (await db.select().from(objects).where(eq(objects.apId, dmApId))).length,
  ).toEqual(0);
  expect(
    (
      await db
        .select()
        .from(activities)
        .where(eq(activities.objectApId, dmApId))
    ).length,
  ).toEqual(0);
  expect(
    (await db.select().from(inbox).where(eq(inbox.actorApId, recipientApId)))
      .length,
  ).toEqual(0);
});

test("story like is rejected when author has blocked the liker", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "author");
  const likerApId = await insertLocalActor(db, "liker");

  const storyApId = `${APP_URL}/ap/objects/story-1`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: authorApId,
    visibility: "public",
    likeCount: 0,
  });

  // author blocks liker
  await db.insert(blocks).values({
    blockerApId: authorApId,
    blockedApId: likerApId,
  });

  const app = appWith(db, fakeActor(likerApId, "liker"), storyRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/story-1/like`, { method: "POST" }),
    envFor(db),
  );

  expect(res.status).toEqual(404);

  // No like row and no count change.
  const likeRows = await db
    .select()
    .from(likes)
    .where(eq(likes.objectApId, storyApId));
  expect(likeRows.length).toEqual(0);
  const story = await db
    .select({ likeCount: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, storyApId))
    .get();
  expect(story?.likeCount).toEqual(0);
});

test("story view/vote/share are rejected when author has blocked the actor", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "bauthor");
  const actorApId = await insertLocalActor(db, "bactor");

  const storyApId = `${APP_URL}/ap/objects/story-block`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: authorApId,
    // public so canViewerReadStory would PASS — only the block gate rejects.
    visibility: "public",
    likeCount: 0,
    shareCount: 0,
  });
  await db.insert(blocks).values({
    blockerApId: authorApId,
    blockedApId: actorApId,
  });

  const app = appWith(db, fakeActor(actorApId, "bactor"), storyRoutes);

  const view = await app.fetch(
    new Request(`${APP_URL}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: storyApId }),
    }),
    envFor(db),
  );
  expect(view.status).toEqual(404);

  const vote = await app.fetch(
    new Request(`${APP_URL}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: storyApId, option_index: 0 }),
    }),
    envFor(db),
  );
  expect(vote.status).toEqual(404);

  const share = await app.fetch(
    new Request(`${APP_URL}/story-block/share`, { method: "POST" }),
    envFor(db),
  );
  expect(share.status).toEqual(404);

  // No share row and no count change.
  const shareRows = await db
    .select()
    .from(storyShares)
    .where(eq(storyShares.storyApId, storyApId));
  expect(shareRows.length).toEqual(0);
  const story = await db
    .select({ shareCount: objects.shareCount })
    .from(objects)
    .where(eq(objects.apId, storyApId))
    .get();
  expect(story?.shareCount).toEqual(0);
});

test("story interactions (view/like/share) require an accepted follow for a personal story", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "sauthor");
  const viewerApId = await insertLocalActor(db, "sviewer");

  const storyApId = `${APP_URL}/ap/objects/personal-story`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: authorApId,
    visibility: "followers",
    communityApId: null,
    endTime: "2999-01-01T00:00:00.000Z",
    likeCount: 0,
  });

  const viewer = fakeActor(viewerApId, "sviewer");

  // Non-follower: every story interaction is gated (404, existence not revealed).
  const likeRes = await appWith(db, viewer, storyRoutes).fetch(
    new Request(`${APP_URL}/personal-story/like`, { method: "POST" }),
    envFor(db),
  );
  expect(likeRes.status).toEqual(404);

  const shareRes = await appWith(db, viewer, storyRoutes).fetch(
    new Request(`${APP_URL}/personal-story/share`, { method: "POST" }),
    envFor(db),
  );
  expect(shareRes.status).toEqual(404);

  const viewRes = await appWith(db, viewer, storyRoutes).fetch(
    new Request(`${APP_URL}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: storyApId }),
    }),
    envFor(db),
  );
  expect(viewRes.status).toEqual(404);

  // Nothing was recorded.
  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, storyApId)))
      .length,
  ).toEqual(0);

  // Accepted follower: the interaction is allowed.
  await db.insert(follows).values({
    followerApId: viewerApId,
    followingApId: authorApId,
    status: "accepted",
  });
  const okRes = await appWith(db, viewer, storyRoutes).fetch(
    new Request(`${APP_URL}/personal-story/like`, { method: "POST" }),
    envFor(db),
  );
  expect(okRes.status).toEqual(200);
});

test("double Undo of a Like does not drift likeCount below the real value", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "author");
  const likerApId = await insertLocalActor(db, "liker");

  const storyApId = `${APP_URL}/ap/objects/post-1`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Note",
    attributedTo: authorApId,
    visibility: "public",
    likeCount: 1,
  });
  await db.insert(likes).values({
    actorApId: likerApId,
    objectApId: storyApId,
    activityApId: `${APP_URL}/ap/activities/like-1`,
  });

  // First undo deletes the like and decrements to 0.
  const first = await undoInteraction(
    db,
    "like",
    "likeCount",
    storyApId,
    null,
    likerApId,
  );
  expect(first).toEqual(true);

  // Duplicate undo: no row to delete, so the count must stay at 0.
  const second = await undoInteraction(
    db,
    "like",
    "likeCount",
    storyApId,
    null,
    likerApId,
  );
  expect(second).toEqual(true);

  const after = await db
    .select({ likeCount: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, storyApId))
    .get();
  expect(after?.likeCount).toEqual(0);
});

test("duplicate Accept does not over-count follower/following counts", async () => {
  const db = await freshDb();
  const requesterApId = await insertLocalActor(db, "requester");
  const targetApId = await insertLocalActor(db, "target");

  const followActivityId = `${APP_URL}/ap/activities/follow-1`;
  await db.insert(follows).values({
    followerApId: requesterApId,
    followingApId: targetApId,
    status: "pending",
    activityApId: followActivityId,
  });

  const ctx = {
    get: (key: string) => (key === "db" ? db : undefined),
  } as unknown as ActivityContext;
  const acceptActivity: InboxActivity = {
    type: "Accept",
    actor: targetApId,
    object: followActivityId,
  };

  await handleAccept(ctx, acceptActivity, targetApId);
  // Duplicate Accept (e.g. retried federation delivery).
  await handleAccept(ctx, acceptActivity, targetApId);

  const follow = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, requesterApId),
        eq(follows.followingApId, targetApId),
      ),
    )
    .get();
  expect(follow?.status).toEqual("accepted");

  const target = await db
    .select({ followerCount: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, targetApId))
    .get();
  const requester = await db
    .select({ followingCount: actors.followingCount })
    .from(actors)
    .where(eq(actors.apId, requesterApId))
    .get();

  // Exactly one increment despite two Accepts.
  expect(target?.followerCount).toEqual(1);
  expect(requester?.followingCount).toEqual(1);
});

async function loadActorRow(db: Database, apId: string) {
  const row = await db.select().from(actors).where(eq(actors.apId, apId)).get();
  if (!row) throw new Error(`actor not found: ${apId}`);
  return row;
}

test("Undo of a never-accepted (pending) follow does not drift followerCount negative", async () => {
  const db = await freshDb();
  const targetApId = await insertLocalActor(db, "target");
  const followerApId = "https://remote.example/users/alice";

  // A pending follow never incremented followerCount (count stays 0).
  const followActivityId = `${APP_URL}/ap/activities/follow-pending`;
  await db.insert(follows).values({
    followerApId,
    followingApId: targetApId,
    status: "pending",
    activityApId: followActivityId,
  });

  const ctx = {
    get: (key: string) => (key === "db" ? db : undefined),
  } as unknown as ActivityContext;
  const recipient = await loadActorRow(db, targetApId);
  const undoActivity: InboxActivity = {
    type: "Undo",
    actor: followerApId,
    object: { type: "Follow", id: followActivityId },
  };

  await handleUndo(ctx, undoActivity, recipient, followerApId, APP_URL);

  const target = await db
    .select({ followerCount: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, targetApId))
    .get();
  // Never incremented -> must NOT go negative on Undo.
  expect(target?.followerCount).toEqual(0);
});

test("duplicate Undo of an accepted follow decrements followerCount exactly once", async () => {
  const db = await freshDb();
  const targetApId = await insertLocalActor(db, "target");
  const followerApId = "https://remote.example/users/bob";

  // Seed an accepted follow with followerCount already reflecting it.
  const followActivityId = `${APP_URL}/ap/activities/follow-accepted`;
  await db.insert(follows).values({
    followerApId,
    followingApId: targetApId,
    status: "accepted",
    activityApId: followActivityId,
    acceptedAt: new Date().toISOString(),
  });
  await db
    .update(actors)
    .set({ followerCount: 1 })
    .where(eq(actors.apId, targetApId));

  const ctx = {
    get: (key: string) => (key === "db" ? db : undefined),
  } as unknown as ActivityContext;
  const recipient = await loadActorRow(db, targetApId);
  const undoActivity: InboxActivity = {
    type: "Undo",
    actor: followerApId,
    object: { type: "Follow", id: followActivityId },
  };

  await handleUndo(ctx, undoActivity, recipient, followerApId, APP_URL);
  // Retried/duplicate Undo: the follow row is already gone, so the second
  // Undo must be a no-op for the count.
  await handleUndo(ctx, undoActivity, recipient, followerApId, APP_URL);

  const target = await db
    .select({ followerCount: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, targetApId))
    .get();
  // Exactly one decrement despite two Undos: 1 -> 0 (not -1).
  expect(target?.followerCount).toEqual(0);
});

// --- Write-side block guards on post like / repost / follow (G-block-bypass) ---

async function insertPublicPost(
  db: Database,
  id: string,
  author: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "hi",
    visibility: "public",
    audienceJson: "[]",
    toJson: "[]",
    ccJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });
  return apId;
}

test("post like is rejected (404) when the author has blocked the liker, no count bump", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "pauthor");
  const liker = await insertLocalActor(db, "pliker");
  const postApId = await insertPublicPost(db, "blk-p1", author);
  await db.insert(blocks).values({ blockerApId: author, blockedApId: liker });

  const res = await appWith(db, fakeActor(liker, "pliker"), postsRoutes).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(postApId)}/like`, {
      method: "POST",
    }),
    envFor(db),
  );
  expect(res.status).toBe(404);
  const rows = await db
    .select()
    .from(likes)
    .where(eq(likes.objectApId, postApId))
    .all();
  expect(rows.length).toBe(0);
});

test("post repost is rejected (404) when the author has blocked the booster", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "rauthor");
  const booster = await insertLocalActor(db, "rbooster");
  const postApId = await insertPublicPost(db, "blk-p2", author);
  await db.insert(blocks).values({ blockerApId: author, blockedApId: booster });

  const res = await appWith(
    db,
    fakeActor(booster, "rbooster"),
    postsRoutes,
  ).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(postApId)}/repost`, {
      method: "POST",
    }),
    envFor(db),
  );
  expect(res.status).toBe(404);
});

test("follow is rejected (404) when the target has blocked the follower, no edge", async () => {
  const db = await freshDb();
  const target = await insertLocalActor(db, "ftarget");
  const follower = await insertLocalActor(db, "ffollower");
  await db
    .insert(blocks)
    .values({ blockerApId: target, blockedApId: follower });

  const res = await appWith(
    db,
    fakeActor(follower, "ffollower"),
    followRoutes,
  ).fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_ap_id: target }),
    }),
    envFor(db),
  );
  expect(res.status).toBe(404);
  const edge = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, follower),
        eq(follows.followingApId, target),
      ),
    )
    .get();
  expect(edge).toBeUndefined();
});
