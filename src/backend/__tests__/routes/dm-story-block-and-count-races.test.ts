/**
 * G10 regression tests: DM/story block-bypass and follower-count races.
 *
 * These exercise the real route handlers and shared helpers against an
 * in-memory libsql database with the production migrations applied, so the
 * assertions reflect actual SQL behaviour rather than mock bookkeeping.
 */

import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, blocks, follows, likes, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import dmRoutes from "../../routes/dm/messages.ts";
import storyRoutes from "../../routes/stories/interactions.ts";
import { undoInteraction } from "../../routes/activitypub/handlers/inbox-shared-helpers.ts";
import { handleAccept } from "../../routes/activitypub/handlers/inbox-follow-handlers.ts";
import type {
  Activity as InboxActivity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0004_blocklist.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await Deno.readTextFile(new URL(file, root));
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

Deno.test("DM send is rejected when recipient has blocked the sender", async () => {
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
  assertEquals(res.status, 404);

  // No DM Note row should have been created.
  const notes = await db.select().from(objects).where(
    eq(objects.type, "Note"),
  );
  assertEquals(notes.length, 0);
});

Deno.test("DM send succeeds when there is no block", async () => {
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

  assertEquals(res.status, 201);
  const notes = await db.select().from(objects).where(eq(objects.type, "Note"));
  assertEquals(notes.length, 1);
});

Deno.test("story like is rejected when author has blocked the liker", async () => {
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

  assertEquals(res.status, 404);

  // No like row and no count change.
  const likeRows = await db.select().from(likes).where(
    eq(likes.objectApId, storyApId),
  );
  assertEquals(likeRows.length, 0);
  const story = await db.select({ likeCount: objects.likeCount }).from(objects)
    .where(eq(objects.apId, storyApId)).get();
  assertEquals(story?.likeCount, 0);
});

Deno.test("double Undo of a Like does not drift likeCount below the real value", async () => {
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
  assertEquals(first, true);

  // Duplicate undo: no row to delete, so the count must stay at 0.
  const second = await undoInteraction(
    db,
    "like",
    "likeCount",
    storyApId,
    null,
    likerApId,
  );
  assertEquals(second, true);

  const after = await db.select({ likeCount: objects.likeCount }).from(objects)
    .where(eq(objects.apId, storyApId)).get();
  assertEquals(after?.likeCount, 0);
});

Deno.test("duplicate Accept does not over-count follower/following counts", async () => {
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

  await handleAccept(ctx, acceptActivity);
  // Duplicate Accept (e.g. retried federation delivery).
  await handleAccept(ctx, acceptActivity);

  const follow = await db.select().from(follows).where(
    and(
      eq(follows.followerApId, requesterApId),
      eq(follows.followingApId, targetApId),
    ),
  ).get();
  assertEquals(follow?.status, "accepted");

  const target = await db.select({ followerCount: actors.followerCount })
    .from(actors).where(eq(actors.apId, targetApId)).get();
  const requester = await db.select({ followingCount: actors.followingCount })
    .from(actors).where(eq(actors.apId, requesterApId)).get();

  // Exactly one increment despite two Accepts.
  assertEquals(target?.followerCount, 1);
  assertEquals(requester?.followingCount, 1);
});
