import { expect, test } from "bun:test";

/**
 * GA #18 — local like/repost interaction atomicity.
 *
 * The like / unlike (and repost / unrepost) handlers must commit their
 * child-row write and the denormalized counter bump as a single atomic unit so
 * the counter can never diverge from the presence of the like/announce row.
 * These were previously independent sequential statements; they are now grouped
 * into a single `db.batch([...])`.
 *
 * This test exercises the real handler over the HTTP surface and asserts the
 * invariant: likeCount === (number of like rows for the post), before and after
 * a like and an unlike.
 */

import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  announces,
  deliveryFanouts,
  deliveryQueue,
  follows,
  inboundActivityClaims,
  inbox as inboxTable,
  likes,
  notificationArchived,
  notificationPushJobs,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import interactionRoutes from "../../routes/posts/interactions.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
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

function envFor(
  db: Database,
  queueMode?: "fail" | "record",
  sent: string[] = [],
): Env {
  const queue = queueMode
    ? {
        send: async (body: { type: string }) => {
          if (queueMode === "fail") {
            throw new Error("simulated fanout Queue outage");
          }
          sent.push(body.type);
        },
        sendBatch: async (messages: Array<{ body: { type: string } }>) => {
          if (queueMode === "fail") {
            throw new Error("simulated fanout Queue outage");
          }
          sent.push(...messages.map(({ body }) => body.type));
        },
      }
    : undefined;
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
}

function appWith(db: Database, env: Env, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", interactionRoutes);
  return app;
}

async function likeCountOf(db: Database, postApId: string): Promise<number> {
  const row = await db
    .select({ likeCount: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, postApId))
    .get();
  return row?.likeCount ?? -1;
}

async function likeRowCount(
  db: Database,
  actorApId: string,
  postApId: string,
): Promise<number> {
  const rows = await db
    .select({ actorApId: likes.actorApId })
    .from(likes)
    .where(and(eq(likes.actorApId, actorApId), eq(likes.objectApId, postApId)));
  return rows.length;
}

test("like then unlike keeps likeCount atomic with the like-row presence", async () => {
  const db = await freshDb();

  const authorApId = await insertLocalActor(db, "author");
  const likerApId = await insertLocalActor(db, "liker");
  const liker = fakeActor(likerApId, "liker");

  const postApId = `${APP_URL}/ap/objects/p1`;
  await db.insert(objects).values({
    apId: postApId,
    type: "Note",
    attributedTo: authorApId,
    content: "hello",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  // Baseline: no like row, counter zero.
  expect(await likeCountOf(db, postApId)).toEqual(0);
  expect(await likeRowCount(db, likerApId, postApId)).toEqual(0);

  const env = envFor(db);
  const app = appWith(db, env, liker);
  const encoded = encodeURIComponent(postApId);

  // Like.
  const likeRes = await app.fetch(
    new Request(`${APP_URL}/${encoded}/like`, { method: "POST" }),
    env,
  );
  expect(likeRes.status).toEqual(200);
  expect(await likeRes.json()).toEqual({ success: true, liked: true });

  // Invariant: counter matches like-row presence after the atomic batch.
  expect(await likeRowCount(db, likerApId, postApId)).toEqual(1);
  expect(await likeCountOf(db, postApId)).toEqual(1);

  const likeActivity = await db
    .select({ apId: likes.activityApId })
    .from(likes)
    .where(and(eq(likes.actorApId, likerApId), eq(likes.objectApId, postApId)))
    .get();
  if (!likeActivity?.apId) throw new Error("like activity was not persisted");
  expect(
    (
      await db
        .select({ direction: activities.direction })
        .from(activities)
        .where(eq(activities.apId, likeActivity.apId))
        .get()
    )?.direction,
  ).toBe("outbound");
  await db.insert(deliveryQueue).values({
    id: "unlike-projection-delivery",
    activityApId: likeActivity.apId,
    inboxUrl: `${authorApId}/inbox`,
  });
  await db.insert(notificationArchived).values({
    actorApId: authorApId,
    activityApId: likeActivity.apId,
  });
  await db.insert(inboundActivityClaims).values({
    activityApId: likeActivity.apId,
    processingToken: "unlike-projection-claim",
  });
  // The inbox trigger created the push job. Put it in a state that its own
  // inbox-delete trigger deliberately retains.
  await db
    .update(notificationPushJobs)
    .set({
      status: "processing",
      processingToken: "unlike-projection-push",
    })
    .where(eq(notificationPushJobs.activityApId, likeActivity.apId));

  // Unlike.
  const unlikeRes = await app.fetch(
    new Request(`${APP_URL}/${encoded}/like`, { method: "DELETE" }),
    env,
  );
  expect(unlikeRes.status).toEqual(200);
  expect(await unlikeRes.json()).toEqual({ success: true, liked: false });

  // Invariant holds after the undo batch too.
  expect(await likeRowCount(db, likerApId, postApId)).toEqual(0);
  expect(await likeCountOf(db, postApId)).toEqual(0);
  for (const rows of [
    await db
      .select()
      .from(activities)
      .where(eq(activities.apId, likeActivity.apId)),
    await db
      .select()
      .from(deliveryQueue)
      .where(eq(deliveryQueue.activityApId, likeActivity.apId)),
    await db
      .select()
      .from(inboxTable)
      .where(eq(inboxTable.activityApId, likeActivity.apId)),
    await db
      .select()
      .from(notificationArchived)
      .where(eq(notificationArchived.activityApId, likeActivity.apId)),
    await db
      .select()
      .from(notificationPushJobs)
      .where(eq(notificationPushJobs.activityApId, likeActivity.apId)),
    await db
      .select()
      .from(inboundActivityClaims)
      .where(eq(inboundActivityClaims.activityApId, likeActivity.apId)),
  ]) {
    expect(rows).toEqual([]);
  }
});

test("double-like is rejected and does not double-count", async () => {
  const db = await freshDb();

  const authorApId = await insertLocalActor(db, "author2");
  const likerApId = await insertLocalActor(db, "liker2");
  const liker = fakeActor(likerApId, "liker2");

  const postApId = `${APP_URL}/ap/objects/p2`;
  await db.insert(objects).values({
    apId: postApId,
    type: "Note",
    attributedTo: authorApId,
    content: "hi",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const env = envFor(db);
  const app = appWith(db, env, liker);
  const encoded = encodeURIComponent(postApId);

  const first = await app.fetch(
    new Request(`${APP_URL}/${encoded}/like`, { method: "POST" }),
    env,
  );
  expect(first.status).toEqual(200);

  const second = await app.fetch(
    new Request(`${APP_URL}/${encoded}/like`, { method: "POST" }),
    env,
  );
  expect(second.status).toEqual(400);

  expect(await likeRowCount(db, likerApId, postApId)).toEqual(1);
  expect(await likeCountOf(db, postApId)).toEqual(1);
});

// ---------------------------------------------------------------------------
// Repost (Announce) re-broadcasts to Public; only truly-public posts may be
// boosted. A followers-only / direct / community-scoped post must be rejected
// so reposting cannot leak restricted content out to the public.
// ---------------------------------------------------------------------------

async function announceRowCount(
  db: Database,
  postApId: string,
): Promise<number> {
  const rows = await db
    .select({ actorApId: announces.actorApId })
    .from(announces)
    .where(eq(announces.objectApId, postApId));
  return rows.length;
}

async function insertPostWithReach(
  db: Database,
  author: string,
  id: string,
  reach: { visibility: string; audienceJson?: string; communityApId?: string },
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "boost me",
    visibility: reach.visibility,
    toJson: "[]",
    ccJson: "[]",
    audienceJson: reach.audienceJson ?? "[]",
    communityApId: reach.communityApId ?? null,
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });
  return apId;
}

async function repost(
  db: Database,
  booster: Actor,
  postApId: string,
): Promise<Response> {
  const env = envFor(db);
  const app = appWith(db, env, booster);
  return app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(postApId)}/repost`, {
      method: "POST",
    }),
    env,
  );
}

test("repost of a truly-public post succeeds", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "rauthor");
  const booster = fakeActor(await insertLocalActor(db, "rbooster"), "rbooster");
  const postApId = await insertPostWithReach(db, author, "rpub", {
    visibility: "public",
  });

  const res = await repost(db, booster, postApId);
  expect(res.status).toEqual(200);
  expect(await announceRowCount(db, postApId)).toEqual(1);
});

test("repost and unrepost succeed with a pending durable fanout when Queue publication fails", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "queue-author");
  const booster = fakeActor(
    await insertLocalActor(db, "queue-booster"),
    "queue-booster",
  );
  const postApId = await insertPostWithReach(db, author, "queue-repost", {
    visibility: "public",
  });
  const env = envFor(db, "fail");
  const app = appWith(db, env, booster);
  const requestUrl = `${APP_URL}/${encodeURIComponent(postApId)}/repost`;

  const repostRes = await app.fetch(
    new Request(requestUrl, { method: "POST" }),
    env,
  );
  expect(repostRes.status).toBe(200);
  expect(await announceRowCount(db, postApId)).toBe(1);
  expect(
    await db.select({ status: deliveryFanouts.status }).from(deliveryFanouts),
  ).toEqual([{ status: "pending" }]);

  const unrepostRes = await app.fetch(
    new Request(requestUrl, { method: "DELETE" }),
    env,
  );
  expect(unrepostRes.status).toBe(200);
  expect(await announceRowCount(db, postApId)).toBe(0);
  expect(
    await db.select({ status: deliveryFanouts.status }).from(deliveryFanouts),
  ).toEqual([{ status: "pending" }]);
});

test("repost of a followers-only / direct / community-scoped post is rejected (403, no Announce)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "rauthor2");
  const booster = fakeActor(
    await insertLocalActor(db, "rbooster2"),
    "rbooster2",
  );

  const followersPost = await insertPostWithReach(db, author, "rfoll", {
    visibility: "followers",
  });
  const directPost = await insertPostWithReach(db, author, "rdm", {
    visibility: "direct",
  });
  // Audience-scoped post: stored "public" but with a non-empty audience (the
  // shape of a community feed/chat post). The gate keys on audienceJson, so a
  // communityApId FK row is unnecessary here.
  const communityPost = await insertPostWithReach(db, author, "rcomm", {
    visibility: "public",
    audienceJson: JSON.stringify([`${APP_URL}/ap/groups/club`]),
  });

  for (const postApId of [followersPost, directPost, communityPost]) {
    const res = await repost(db, booster, postApId);
    expect(res.status).toEqual(403);
    expect(await announceRowCount(db, postApId)).toEqual(0);
  }
});

// ---------------------------------------------------------------------------
// Like read-gate: a post the actor cannot read must not be likeable (no
// notification / count bump from an unentitled actor).
// ---------------------------------------------------------------------------

async function like(
  db: Database,
  liker: Actor,
  postApId: string,
): Promise<Response> {
  const env = envFor(db);
  const app = appWith(db, env, liker);
  return app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(postApId)}/like`, {
      method: "POST",
    }),
    env,
  );
}

test("like of a followers-only post is rejected for a non-follower (404, no like) but allowed for a follower", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "lauthor");
  const strangerApId = await insertLocalActor(db, "lstranger");
  const followerApId = await insertLocalActor(db, "lfollower");
  const stranger = fakeActor(strangerApId, "lstranger");
  const follower = fakeActor(followerApId, "lfollower");

  const postApId = await insertPostWithReach(db, author, "lfoll", {
    visibility: "followers",
  });

  // Non-follower who somehow knows the apId: rejected, no like row / count bump.
  const strangerRes = await like(db, stranger, postApId);
  expect(strangerRes.status).toEqual(404);
  expect(await likeRowCount(db, strangerApId, postApId)).toEqual(0);
  expect(await likeCountOf(db, postApId)).toEqual(0);

  // Accepted follower: allowed.
  await db.insert(follows).values({
    followerApId: followerApId,
    followingApId: author,
    status: "accepted",
  });
  const followerRes = await like(db, follower, postApId);
  expect(followerRes.status).toEqual(200);
  expect(await likeRowCount(db, followerApId, postApId)).toEqual(1);
  expect(await likeCountOf(db, postApId)).toEqual(1);
});

// ---------------------------------------------------------------------------
// Audit #23 / finding B — like→unlike→like must NOT stack notifications.
// Each like mints a fresh activity id and the dedup guard only checks the
// `likes` edge, so before the fix a re-like added a SECOND author inbox row
// (duplicate "X liked your post" + phantom unread +1). Unlike now reaps the
// prior like's notification (inbox + activity row) in its atomic batch.
// ---------------------------------------------------------------------------

async function authorInboxCount(
  db: Database,
  authorApId: string,
): Promise<number> {
  const rows = await db
    .select({ activityApId: inboxTable.activityApId })
    .from(inboxTable)
    .where(eq(inboxTable.actorApId, authorApId));
  return rows.length;
}

test("like → unlike → like leaves exactly one notification for the author", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "author3");
  const likerApId = await insertLocalActor(db, "liker3");
  const liker = fakeActor(likerApId, "liker3");

  const postApId = `${APP_URL}/ap/objects/p3`;
  await db.insert(objects).values({
    apId: postApId,
    type: "Note",
    attributedTo: authorApId,
    content: "hi",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const env = envFor(db);
  const app = appWith(db, env, liker);
  const encoded = encodeURIComponent(postApId);
  const like = () =>
    app.fetch(
      new Request(`${APP_URL}/${encoded}/like`, { method: "POST" }),
      env,
    );
  const unlike = () =>
    app.fetch(
      new Request(`${APP_URL}/${encoded}/like`, { method: "DELETE" }),
      env,
    );

  await like();
  expect(await authorInboxCount(db, authorApId)).toEqual(1);
  await unlike();
  // The original notification is reaped on unlike.
  expect(await authorInboxCount(db, authorApId)).toEqual(0);
  await like();
  // Re-like creates exactly one — not a second stacked on the first.
  expect(await authorInboxCount(db, authorApId)).toEqual(1);
});
