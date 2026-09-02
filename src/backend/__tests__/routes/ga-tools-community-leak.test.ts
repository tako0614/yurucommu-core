import { expect, test } from "bun:test";

/**
 * GA #4 + #5 — community-scope leak via the AI-agent (takos-tools) surface.
 *
 * Community-scoped Notes are persisted as visibility="public" but carry a
 * non-"[]" audienceJson (the community read-gate). The agent tools
 * (yurucommu_get_timeline / yurucommu_search_posts / yurucommu_get_trending)
 * previously filtered on visibility="public" ALONE, so they surfaced
 * private-community posts and their hashtags to the agent.
 *
 * This test pins the same NO_AUDIENCE_PREDICATE (audienceJson="[]") guard that
 * the human-facing search/timeline routes already enforce, plus the
 * deletedAt-tombstone exclusion:
 *
 *  (i)   handleGetTimeline must NOT return a community post.
 *  (ii)  searchPosts must NOT return a community post (id or content).
 *  (iii) getTrending must NOT surface a community post's hashtag.
 *
 * A regular (empty-audience) public post IS returned in each case, proving the
 * guard scopes out only the community-gated content. A soft-deleted public
 * post is also excluded.
 */

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  announces,
  blocks,
  bookmarks,
  deliveryFanouts,
  follows,
  inbox,
  likes,
  mediaUploads,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import type { IQueueProducer } from "../../runtime/queue.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";
import {
  handleGetUserProfile,
  handleSearchPosts,
  handleSearchUsers,
  handleGetTrending,
} from "../../routes/takos-tools/search.ts";
import {
  handleGetNotifications,
  handleGetTimeline as getTimeline,
} from "../../routes/takos-tools/timeline.ts";
import {
  handleBookmarkPost,
  handleCreatePost,
  handleDeletePost,
  handleLikePost,
} from "../../routes/takos-tools/posts.ts";
import { handleFollowUser } from "../../routes/takos-tools/follows.ts";
import {
  handleGetDmMessages,
  handleGetDmThreads,
} from "../../routes/takos-tools/dm.ts";
import { getConversationId } from "../../routes/dm/query-helpers.ts";
import { blockDomain } from "../../lib/blocklist.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/users/${username}`;
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

async function insertPost(
  db: Database,
  author: string,
  id: string,
  content: string,
  published: string,
  audienceJson: string,
  deletedAt: string | null = null,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content,
    visibility: "public",
    audienceJson,
    published,
    deletedAt,
  });
  return apId;
}

/** Minimal ToolContext stub: handlers only use c.get("db"), c.env and c.json(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFor(
  db: Database,
  media?: ObjectStore,
  queueBindings?: {
    DELIVERY_QUEUE: IQueueProducer<DeliveryQueueMessageV1>;
    DELIVERY_DLQ: IQueueProducer<DeliveryDlqMessageV1>;
  },
): any {
  return {
    get(key: string) {
      if (key === "db") return db;
      return null;
    },
    env: { APP_URL, DB_INSTANCE: db, MEDIA: media, ...queueBindings },
    json(value: unknown) {
      return { __body: value };
    },
  };
}

function recordingQueue<T>(): {
  producer: IQueueProducer<T>;
  sent: T[];
} {
  const sent: T[] = [];
  return {
    sent,
    producer: {
      async send(body) {
        sent.push(body);
      },
      async sendBatch(messages) {
        sent.push(...messages.map((message) => message.body));
      },
    },
  };
}

function recordingStorage(): {
  storage: ObjectStore;
  deleted: string[];
} {
  const deleted: string[] = [];
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | string[]) {
      deleted.push(...(Array.isArray(key) ? key : [key]));
    },
  } as unknown as ObjectStore;
  return { storage, deleted };
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

const COMMUNITY_AUDIENCE = JSON.stringify([`${APP_URL}/ap/groups/secretclub`]);

test("agent get_timeline excludes community-scoped and deleted posts", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "alice");

  const publicId = await insertPost(
    db,
    author,
    "pub",
    "open thoughts",
    isoMinutesAgo(5),
    "[]",
  );
  await insertPost(
    db,
    author,
    "comm",
    "members only secret",
    isoMinutesAgo(4),
    COMMUNITY_AUDIENCE,
  );
  await insertPost(
    db,
    author,
    "del",
    "tombstoned public",
    isoMinutesAgo(3),
    "[]",
    isoMinutesAgo(1),
  );

  const res = (await getTimeline(ctxFor(db), {}, null)) as unknown as {
    __body: { data: { posts: { ap_id: string; content: string }[] } };
  };
  const posts = res.__body.data.posts;
  const ids = posts.map((p) => p.ap_id);

  expect(ids).toContain(publicId);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/comm`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/del`);
  expect(posts.some((p) => p.content.includes("members only"))).toBe(false);
});

test("agent search_posts excludes community-scoped and deleted posts", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "bob");

  const publicId = await insertPost(
    db,
    author,
    "pub",
    "open secretword thoughts",
    isoMinutesAgo(5),
    "[]",
  );
  await insertPost(
    db,
    author,
    "comm",
    "members only secretword",
    isoMinutesAgo(4),
    COMMUNITY_AUDIENCE,
  );
  await insertPost(
    db,
    author,
    "del",
    "deleted secretword",
    isoMinutesAgo(3),
    "[]",
    isoMinutesAgo(1),
  );

  const res = (await handleSearchPosts(
    ctxFor(db),
    { query: "secretword" },
    null,
  )) as unknown as {
    __body: { data: { posts: { ap_id: string; content: string }[] } };
  };
  const posts = res.__body.data.posts;
  const ids = posts.map((p) => p.ap_id);

  expect(ids).toContain(publicId);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/comm`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/del`);
  expect(posts.some((p) => p.content.includes("members only"))).toBe(false);
});

test("agent get_trending omits community-scoped post hashtags", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "carol");

  await insertPost(
    db,
    author,
    "t1",
    "town square #plaza",
    isoMinutesAgo(3),
    "[]",
  );
  await insertPost(
    db,
    author,
    "t2",
    "hush #backroom #backroom",
    isoMinutesAgo(2),
    COMMUNITY_AUDIENCE,
  );
  await insertPost(
    db,
    author,
    "t3",
    "deleted #ghosttag",
    isoMinutesAgo(1),
    "[]",
    isoMinutesAgo(1),
  );

  const res = (await handleGetTrending(ctxFor(db), {}, null)) as unknown as {
    __body: { data: { trending: { tag: string; count: number }[] } };
  };
  const tags = res.__body.data.trending.map((t) => t.tag);

  expect(tags).toContain("plaza");
  expect(tags).not.toContain("backroom");
  expect(tags).not.toContain("ghosttag");
});

// Audit #19: the agent trending tokenizer must use the SAME full-Unicode class as
// storage/web, so non-CJK tags (Korean/Cyrillic/accented-Latin) actually trend.
test("agent get_trending finds non-CJK (Korean / Cyrillic / accented) hashtags", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "dave");
  await insertPost(db, author, "u1", "공지 #안녕", isoMinutesAgo(3), "[]");
  await insertPost(db, author, "u2", "privet #привет", isoMinutesAgo(2), "[]");
  await insertPost(db, author, "u3", "coffee #café", isoMinutesAgo(1), "[]");

  const res = (await handleGetTrending(ctxFor(db), {}, null)) as unknown as {
    __body: { data: { trending: { tag: string }[] } };
  };
  const tags = res.__body.data.trending.map((t) => t.tag);
  expect(tags).toContain("안녕");
  expect(tags).toContain("привет");
  // #café must NOT mis-segment to #caf (the old ASCII-only regex did).
  expect(tags).toContain("café");
  expect(tags).not.toContain("caf");
});

test("agent like_post is read-gated like the web route (cannot like an unreadable post)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // alice's followers-only post; bob does NOT follow alice → cannot read it.
  const hidden = `${APP_URL}/ap/objects/foll-1`;
  await db.insert(objects).values({
    apId: hidden,
    type: "Note",
    attributedTo: alice,
    content: "secret",
    visibility: "followers",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
  });

  await handleLikePost(
    ctxFor(db),
    { post_id: hidden, like: true },
    { ap_id: bob },
  );

  // The gate must have refused: no like edge, no like_count bump.
  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, hidden)).all())
      .length,
  ).toBe(0);
  expect(
    (
      await db
        .select({ likeCount: objects.likeCount })
        .from(objects)
        .where(eq(objects.apId, hidden))
        .get()
    )?.likeCount,
  ).toBe(0);

  // Positive control: bob CAN like a public post (gate allows, edge + count).
  const open = `${APP_URL}/ap/objects/pub-1`;
  await db.insert(objects).values({
    apId: open,
    type: "Note",
    attributedTo: alice,
    content: "hello",
    visibility: "public",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
  });
  // bob now follows alice too (irrelevant to a public post, but realistic).
  await db.insert(follows).values({
    followerApId: bob,
    followingApId: alice,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  await handleLikePost(
    ctxFor(db),
    { post_id: open, like: true },
    { ap_id: bob },
  );
  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, open)).all())
      .length,
  ).toBe(1);
  expect(
    (
      await db
        .select({ likeCount: objects.likeCount })
        .from(objects)
        .where(eq(objects.apId, open))
        .get()
    )?.likeCount,
  ).toBe(1);
});

test("agent like_post persists and delivers remote Like/Undo activities", async () => {
  const db = await freshDb();
  const liker = await insertLocalActor(db, "tool-remote-liker");
  const remoteAuthor = "https://remote.example/users/tool-liked-author";
  const remotePost = "https://remote.example/objects/tool-liked-post";
  await db.insert(actors).values({
    apId: remoteAuthor,
    type: "Person",
    preferredUsername: "tool-liked-author",
    inbox: `${remoteAuthor}/inbox`,
    outbox: `${remoteAuthor}/outbox`,
    followersUrl: `${remoteAuthor}/followers`,
    followingUrl: `${remoteAuthor}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "",
  });
  await db.insert(objects).values({
    apId: remotePost,
    type: "Note",
    attributedTo: remoteAuthor,
    content: "remote post",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
    isLocal: 0,
  });
  const main = recordingQueue<DeliveryQueueMessageV1>();
  const dlq = recordingQueue<DeliveryDlqMessageV1>();
  const context = ctxFor(db, undefined, {
    DELIVERY_QUEUE: main.producer,
    DELIVERY_DLQ: dlq.producer,
  });

  await handleLikePost(
    context,
    { post_id: remotePost, like: true },
    { ap_id: liker },
  );

  const likeEdge = await db
    .select({ activityApId: likes.activityApId })
    .from(likes)
    .where(and(eq(likes.actorApId, liker), eq(likes.objectApId, remotePost)))
    .get();
  expect(likeEdge?.activityApId).toBeDefined();
  const likeActivity = await db
    .select({
      apId: activities.apId,
      direction: activities.direction,
      rawJson: activities.rawJson,
    })
    .from(activities)
    .where(eq(activities.apId, likeEdge!.activityApId!))
    .get();
  expect(likeActivity?.direction).toBe("outbound");
  expect(JSON.parse(likeActivity!.rawJson)).toMatchObject({
    id: likeActivity!.apId,
    type: "Like",
    actor: liker,
    object: remotePost,
  });
  expect(main.sent).toEqual([
    expect.objectContaining({
      type: "resolve_actor",
      activityId: likeActivity!.apId,
      recipientActorApId: remoteAuthor,
    }),
  ]);
  // Tool retries are state-setting/idempotent: they must not mint or enqueue a
  // second Like after the first request already committed.
  await handleLikePost(
    context,
    { post_id: remotePost, like: true },
    { ap_id: liker },
  );
  expect(
    await db
      .select()
      .from(activities)
      .where(
        and(eq(activities.objectApId, remotePost), eq(activities.type, "Like")),
      ),
  ).toHaveLength(1);
  expect(main.sent).toHaveLength(1);

  await handleLikePost(
    context,
    { post_id: remotePost, like: false },
    { ap_id: liker },
  );

  expect(
    await db
      .select()
      .from(activities)
      .where(eq(activities.apId, likeActivity!.apId)),
  ).toHaveLength(0);
  const undoActivity = await db
    .select({
      apId: activities.apId,
      direction: activities.direction,
      rawJson: activities.rawJson,
    })
    .from(activities)
    .where(
      and(eq(activities.objectApId, remotePost), eq(activities.type, "Undo")),
    )
    .get();
  expect(undoActivity?.direction).toBe("outbound");
  expect(JSON.parse(undoActivity!.rawJson)).toMatchObject({
    id: undoActivity!.apId,
    type: "Undo",
    actor: liker,
    object: likeActivity!.apId,
  });
  expect(main.sent).toEqual([
    expect.objectContaining({
      type: "resolve_actor",
      activityId: likeActivity!.apId,
      recipientActorApId: remoteAuthor,
    }),
    expect.objectContaining({
      type: "resolve_actor",
      activityId: undoActivity!.apId,
      recipientActorApId: remoteAuthor,
    }),
  ]);
  await handleLikePost(
    context,
    { post_id: remotePost, like: false },
    { ap_id: liker },
  );
  expect(
    await db
      .select()
      .from(activities)
      .where(
        and(eq(activities.objectApId, remotePost), eq(activities.type, "Undo")),
      ),
  ).toHaveLength(1);
  expect(main.sent).toHaveLength(2);
});

// Audit #18: the agent tool paths must enforce the same per-user block + reply
// read-gate the canonical routes do.
test("agent like_post is BLOCK-gated (a blocked actor cannot like the blocker's public post)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const open = `${APP_URL}/ap/objects/pub-block`;
  await db.insert(objects).values({
    apId: open,
    type: "Note",
    attributedTo: alice,
    content: "public",
    visibility: "public",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
  });
  // alice blocks bob.
  await db.insert(blocks).values({ blockerApId: alice, blockedApId: bob });

  await handleLikePost(
    ctxFor(db),
    { post_id: open, like: true },
    { ap_id: bob },
  );

  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, open)).all())
      .length,
  ).toBe(0);
});

test("agent follow_user is BLOCK-gated (a blocked actor cannot re-follow the blocker)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  // alice blocks bob; bob's agent tries to follow alice.
  await db.insert(blocks).values({ blockerApId: alice, blockedApId: bob });

  await handleFollowUser(ctxFor(db), { username: "alice" }, { ap_id: bob });

  expect(
    (
      await db
        .select()
        .from(follows)
        .where(
          eq(follows.followerApId, bob) && eq(follows.followingApId, alice),
        )
        .all()
    ).length,
  ).toBe(0);
});

test("agent create_post reply is read-gated (cannot reply to an unreadable parent)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  // alice's followers-only parent; bob does NOT follow alice.
  const parent = `${APP_URL}/ap/objects/foll-parent`;
  await db.insert(objects).values({
    apId: parent,
    type: "Note",
    attributedTo: alice,
    content: "secret parent",
    visibility: "followers",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    replyCount: 0,
    published: isoMinutesAgo(1),
  });

  const res = (await handleCreatePost(
    ctxFor(db),
    { content: "sneaky reply", in_reply_to: parent },
    { ap_id: bob },
  )) as unknown as { __body: { success: boolean } };
  expect(res.__body.success).toBe(false);

  // No reply object stored, parent replyCount untouched.
  expect(
    (await db.select().from(objects).where(eq(objects.inReplyTo, parent)).all())
      .length,
  ).toBe(0);
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, parent))
        .get()
    )?.replyCount,
  ).toBe(0);

  // Positive control: an accepted follower CAN reply.
  await db.insert(follows).values({
    followerApId: bob,
    followingApId: alice,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  const ok2 = (await handleCreatePost(
    ctxFor(db),
    { content: "allowed reply", in_reply_to: parent },
    { ap_id: bob },
  )) as unknown as { __body: { success: boolean } };
  expect(ok2.__body.success).toBe(true);
  expect(
    (await db.select().from(objects).where(eq(objects.inReplyTo, parent)).all())
      .length,
  ).toBe(1);
});

test("agent create_post returns a post_id that delete_post can actually delete", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "tool-create-delete-author");

  const createResult = (await handleCreatePost(
    ctxFor(db),
    { content: "created by tool" },
    { ap_id: author },
  )) as unknown as {
    __body: {
      success: boolean;
      data: { post_id: string; ap_id: string };
    };
  };
  expect(createResult.__body.success).toBe(true);
  const { post_id: postId, ap_id: apId } = createResult.__body.data;
  expect(apId).toBe(`${APP_URL}/ap/objects/${postId}`);

  const deleteResult = (await handleDeletePost(
    ctxFor(db),
    { post_id: postId },
    { ap_id: author },
  )) as unknown as { __body: { success: boolean } };
  expect(deleteResult.__body.success).toBe(true);
  expect(
    await db.select().from(objects).where(eq(objects.apId, apId)),
  ).toHaveLength(0);
  expect(
    (
      await db
        .select({ postCount: actors.postCount })
        .from(actors)
        .where(eq(actors.apId, author))
        .get()
    )?.postCount,
  ).toBe(0);
});

test("agent create/delete post persist outbound Activities and follower fanout", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "tool-federation-author");
  const main = recordingQueue<DeliveryQueueMessageV1>();
  const dlq = recordingQueue<DeliveryDlqMessageV1>();
  const context = ctxFor(db, undefined, {
    DELIVERY_QUEUE: main.producer,
    DELIVERY_DLQ: dlq.producer,
  });

  const createResult = (await handleCreatePost(
    context,
    { content: "federated by tool", visibility: "public" },
    { ap_id: author },
  )) as unknown as {
    __body: {
      success: boolean;
      data: { post_id: string; ap_id: string };
    };
  };
  expect(createResult.__body.success).toBe(true);
  const { post_id: postId, ap_id: apId } = createResult.__body.data;

  const createRows = await db
    .select({ apId: activities.apId, rawJson: activities.rawJson })
    .from(activities)
    .where(
      and(
        eq(activities.objectApId, apId),
        eq(activities.type, "Create"),
        eq(activities.direction, "outbound"),
      ),
    );
  expect(createRows).toHaveLength(1);
  expect(JSON.parse(createRows[0]!.rawJson)).toMatchObject({
    type: "Create",
    actor: author,
    object: { id: apId, content: "federated by tool" },
  });
  expect(main.sent).toEqual([
    expect.objectContaining({
      type: "fanout_followers",
      activityId: createRows[0]!.apId,
      followeeApId: author,
    }),
  ]);

  const deleteResult = (await handleDeletePost(
    context,
    { post_id: postId },
    { ap_id: author },
  )) as unknown as { __body: { success: boolean } };
  expect(deleteResult.__body.success).toBe(true);

  const deleteRows = await db
    .select({ apId: activities.apId, rawJson: activities.rawJson })
    .from(activities)
    .where(
      and(
        eq(activities.objectApId, apId),
        eq(activities.type, "Delete"),
        eq(activities.direction, "outbound"),
      ),
    );
  expect(deleteRows).toHaveLength(1);
  expect(JSON.parse(deleteRows[0]!.rawJson)).toMatchObject({
    type: "Delete",
    actor: author,
    object: { id: apId, type: "Tombstone" },
  });
  expect(main.sent).toEqual([
    expect.objectContaining({
      type: "fanout_followers",
      activityId: createRows[0]!.apId,
    }),
    expect.objectContaining({
      type: "fanout_followers",
      activityId: deleteRows[0]!.apId,
    }),
  ]);
});

test("agent delete_post rolls back local state when durable fanout persistence fails", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "tool-atomic-delete");
  const target = `${APP_URL}/ap/objects/tool-atomic-delete`;
  await db.insert(objects).values({
    apId: target,
    type: "Note",
    attributedTo: author,
    content: "keep on failed delete",
    visibility: "public",
  });
  await db.update(actors).set({ postCount: 1 }).where(eq(actors.apId, author));
  await db.run(sql`
    CREATE TRIGGER reject_tool_delete_fanout
    BEFORE INSERT ON delivery_fanouts
    BEGIN
      SELECT RAISE(ABORT, 'simulated fanout ledger outage');
    END
  `);

  await expect(
    handleDeletePost(ctxFor(db), { post_id: target }, { ap_id: author }),
  ).rejects.toThrow("simulated fanout ledger outage");

  expect(
    await db.select().from(objects).where(eq(objects.apId, target)),
  ).toHaveLength(1);
  expect(
    (
      await db
        .select({ postCount: actors.postCount })
        .from(actors)
        .where(eq(actors.apId, author))
        .get()
    )?.postCount,
  ).toBe(1);
  expect(
    await db.select().from(activities).where(eq(activities.type, "Delete")),
  ).toHaveLength(0);
  expect(await db.select().from(deliveryFanouts)).toHaveLength(0);
});

test("agent delete_post reaps children/media and repairs parent and author counters", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "tool-delete-author");
  const other = await insertLocalActor(db, "tool-delete-other");
  const parent = `${APP_URL}/ap/objects/tool-delete-parent`;
  const target = `${APP_URL}/ap/objects/tool-delete-target`;
  const survivor = `${APP_URL}/ap/objects/tool-delete-survivor`;
  const r2Key = "uploads/tool-delete.jpg";

  await db.insert(objects).values([
    {
      apId: parent,
      type: "Note",
      attributedTo: other,
      content: "parent",
      visibility: "public",
      replyCount: 2,
    },
    {
      apId: target,
      type: "Note",
      attributedTo: author,
      content: "delete me",
      visibility: "public",
      inReplyTo: parent,
      attachmentsJson: JSON.stringify([
        {
          type: "Document",
          url: "/media/tool-delete.jpg",
          r2_key: r2Key,
        },
      ]),
    },
    {
      apId: survivor,
      type: "Note",
      attributedTo: author,
      content: "keep me",
      visibility: "public",
      inReplyTo: parent,
    },
  ]);
  await db.update(actors).set({ postCount: 2 }).where(eq(actors.apId, author));
  await db.insert(mediaUploads).values({
    id: "tool-delete-media",
    r2Key,
    uploaderApId: author,
    contentType: "image/jpeg",
    size: 123,
  });
  await db.insert(likes).values({ actorApId: other, objectApId: target });
  await db.insert(announces).values({ actorApId: other, objectApId: target });
  await db.insert(bookmarks).values({ actorApId: other, objectApId: target });
  await db.insert(objectRecipients).values({
    objectApId: target,
    recipientApId: other,
    type: "to",
  });

  const { storage, deleted } = recordingStorage();
  const result = (await handleDeletePost(
    ctxFor(db, storage),
    { post_id: target },
    { ap_id: author },
  )) as unknown as { __body: { success: boolean } };
  expect(result.__body.success).toBe(true);

  expect(
    await db.select().from(objects).where(eq(objects.apId, target)),
  ).toHaveLength(0);
  expect(
    await db.select().from(objects).where(eq(objects.apId, survivor)),
  ).toHaveLength(1);
  for (const rows of [
    await db.select().from(likes).where(eq(likes.objectApId, target)),
    await db.select().from(announces).where(eq(announces.objectApId, target)),
    await db.select().from(bookmarks).where(eq(bookmarks.objectApId, target)),
    await db
      .select()
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, target)),
    await db.select().from(mediaUploads).where(eq(mediaUploads.r2Key, r2Key)),
  ]) {
    expect(rows).toHaveLength(0);
  }
  expect(deleted).toEqual([r2Key]);
  expect(
    (
      await db
        .select({ postCount: actors.postCount })
        .from(actors)
        .where(eq(actors.apId, author))
        .get()
    )?.postCount,
  ).toBe(1);
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, parent))
        .get()
    )?.replyCount,
  ).toBe(1);
});

test("agent delete_post does not decrement postCount for a direct message", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "tool-delete-direct-author");
  const direct = `${APP_URL}/ap/objects/tool-delete-direct`;
  const recipient = "https://remote.example/users/direct-recipient";
  await db.update(actors).set({ postCount: 1 }).where(eq(actors.apId, author));
  await db.insert(objects).values({
    apId: direct,
    type: "Note",
    attributedTo: author,
    content: "direct",
    visibility: "direct",
    toJson: JSON.stringify([recipient]),
  });

  const main = recordingQueue<DeliveryQueueMessageV1>();
  const dlq = recordingQueue<DeliveryDlqMessageV1>();
  await handleDeletePost(
    ctxFor(db, undefined, {
      DELIVERY_QUEUE: main.producer,
      DELIVERY_DLQ: dlq.producer,
    }),
    { post_id: direct },
    { ap_id: author },
  );
  expect(
    (
      await db
        .select({ postCount: actors.postCount })
        .from(actors)
        .where(eq(actors.apId, author))
        .get()
    )?.postCount,
  ).toBe(1);

  const deleteActivity = await db
    .select({ apId: activities.apId, rawJson: activities.rawJson })
    .from(activities)
    .where(
      and(
        eq(activities.objectApId, direct),
        eq(activities.type, "Delete"),
        eq(activities.direction, "outbound"),
      ),
    )
    .get();
  expect(deleteActivity).toBeDefined();
  expect(JSON.parse(deleteActivity!.rawJson)).toMatchObject({
    to: [recipient],
    object: { id: direct, type: "Tombstone" },
  });
  // A private object is delivered only to its explicit recipient. Broadcasting
  // its Tombstone to the author's follower graph would disclose the object id.
  expect(main.sent).toEqual([
    expect.objectContaining({
      type: "resolve_actor",
      activityId: deleteActivity!.apId,
      recipientActorApId: recipient,
    }),
  ]);
});

test("agent DM tools retain a bto/bcc-addressed thread without to_json disclosure", async () => {
  const db = await freshDb();
  const sender = await insertLocalActor(db, "hidden-sender");
  const recipient = await insertLocalActor(db, "hidden-recipient");
  const apId = `${APP_URL}/ap/objects/hidden-tool-dm`;
  const conversation = getConversationId(APP_URL, sender, recipient);
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: sender,
    content: "hidden tool message",
    visibility: "direct",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    conversation,
    published: isoMinutesAgo(1),
  });
  await db.insert(objectRecipients).values({
    objectApId: apId,
    recipientApId: recipient,
    type: "to",
  });

  const threadsResult = (await handleGetDmThreads(
    ctxFor(db),
    {},
    { ap_id: recipient },
  )) as unknown as {
    __body: { data: { threads: Array<{ partner: string }> } };
  };
  expect(threadsResult.__body.data.threads).toEqual([
    expect.objectContaining({ partner: sender }),
  ]);

  const messagesResult = (await handleGetDmMessages(
    ctxFor(db),
    { thread_id: sender },
    { ap_id: recipient },
  )) as unknown as {
    __body: {
      data: { messages: Array<{ ap_id: string; content: string }> };
    };
  };
  expect(messagesResult.__body.data.messages).toEqual([
    expect.objectContaining({ ap_id: apId, content: "hidden tool message" }),
  ]);
});

test("agent DM tools suppress an operator-blocked retained remote thread", async () => {
  const db = await freshDb();
  const recipient = await insertLocalActor(db, "blocked-thread-recipient");
  const sender = "https://chat.defederated.example/users/sender";
  await db.insert(actors).values({
    apId: sender,
    type: "Person",
    preferredUsername: "sender",
    inbox: `${sender}/inbox`,
    outbox: `${sender}/outbox`,
    followersUrl: `${sender}/followers`,
    followingUrl: `${sender}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  const apId = `${sender}/objects/old-dm`;
  const conversation = getConversationId(APP_URL, sender, recipient);
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: sender,
    content: "retained blocked message",
    visibility: "direct",
    toJson: JSON.stringify([recipient]),
    conversation,
    published: isoMinutesAgo(1),
  });
  await db.insert(objectRecipients).values({
    objectApId: apId,
    recipientApId: recipient,
    type: "to",
  });
  await blockDomain(db, "defederated.example", "operator block");

  const threadsResult = (await handleGetDmThreads(
    ctxFor(db),
    {},
    { ap_id: recipient },
  )) as unknown as {
    __body: { data: { threads: Array<{ partner: string }> } };
  };
  expect(threadsResult.__body.data.threads).toEqual([]);

  const messagesResult = (await handleGetDmMessages(
    ctxFor(db),
    { thread_id: sender },
    { ap_id: recipient },
  )) as unknown as { __body: { success: boolean; error: string } };
  expect(messagesResult.__body).toEqual({
    success: false,
    error: "Thread not found",
  });
});

test("agent content projections and mutations suppress an operator-blocked retained author", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "operator-content-viewer");
  const allowedAuthor = await insertLocalActor(db, "allowed-content-author");
  const remoteAuthor =
    "https://content.defederated.example/users/retained-author";
  await db.insert(actors).values({
    apId: remoteAuthor,
    type: "Person",
    preferredUsername: "retained-author",
    inbox: `${remoteAuthor}/inbox`,
    outbox: `${remoteAuthor}/outbox`,
    followersUrl: `${remoteAuthor}/followers`,
    followingUrl: `${remoteAuthor}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });

  const allowedPost = await insertPost(
    db,
    allowedAuthor,
    "operator-allowed",
    "operator-shared-token #operatorallowed",
    isoMinutesAgo(2),
    "[]",
  );
  const blockedPost = await insertPost(
    db,
    remoteAuthor,
    "operator-blocked",
    "operator-shared-token #operatorblocked",
    isoMinutesAgo(1),
    "[]",
  );
  await blockDomain(db, "defederated.example", "operator block");

  const timelineResult = (await getTimeline(
    ctxFor(db),
    {},
    { ap_id: viewer },
  )) as unknown as {
    __body: { data: { posts: Array<{ ap_id: string }> } };
  };
  expect(timelineResult.__body.data.posts.map((post) => post.ap_id)).toEqual([
    allowedPost,
  ]);

  const searchResult = (await handleSearchPosts(
    ctxFor(db),
    { query: "operator-shared-token" },
    { ap_id: viewer },
  )) as unknown as {
    __body: { data: { posts: Array<{ ap_id: string }> } };
  };
  expect(searchResult.__body.data.posts.map((post) => post.ap_id)).toEqual([
    allowedPost,
  ]);

  const trendingResult = (await handleGetTrending(
    ctxFor(db),
    {},
    { ap_id: viewer },
  )) as unknown as {
    __body: { data: { trending: Array<{ tag: string }> } };
  };
  const trendingTags = trendingResult.__body.data.trending.map(
    (row) => row.tag,
  );
  expect(trendingTags).toContain("operatorallowed");
  expect(trendingTags).not.toContain("operatorblocked");

  const usersResult = (await handleSearchUsers(
    ctxFor(db),
    { query: "retained-author" },
    { ap_id: viewer },
  )) as unknown as {
    __body: { data: { actors: Array<{ ap_id: string }> } };
  };
  expect(usersResult.__body.data.actors).toEqual([]);
  const profileResult = (await handleGetUserProfile(
    ctxFor(db),
    { username: "retained-author" },
    { ap_id: viewer },
  )) as unknown as { __body: { success: boolean; error: string } };
  expect(profileResult.__body).toEqual({
    success: false,
    error: "User not found",
  });

  await handleLikePost(
    ctxFor(db),
    { post_id: blockedPost, like: true },
    { ap_id: viewer },
  );
  await handleBookmarkPost(
    ctxFor(db),
    { post_id: blockedPost, bookmark: true },
    { ap_id: viewer },
  );
  expect(
    await db.select().from(likes).where(eq(likes.objectApId, blockedPost)),
  ).toHaveLength(0);
  expect(
    await db
      .select()
      .from(bookmarks)
      .where(eq(bookmarks.objectApId, blockedPost)),
  ).toHaveLength(0);
});

test("agent notifications apply shared moderation eligibility before the limit", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "operator-notification-viewer");
  const allowedActor = await insertLocalActor(db, "allowed-notification-actor");
  const blockedActor =
    "https://notify.defederated.example/users/blocked-notification-actor";
  await db.insert(actors).values({
    apId: blockedActor,
    type: "Person",
    preferredUsername: "blocked-notification-actor",
    inbox: `${blockedActor}/inbox`,
    outbox: `${blockedActor}/outbox`,
    followersUrl: `${blockedActor}/followers`,
    followingUrl: `${blockedActor}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  const allowedActivity = `${APP_URL}/ap/activities/tool-notification-allowed`;
  const blockedActivity =
    "https://notify.defederated.example/activities/tool-notification-blocked";
  await db.insert(activities).values([
    {
      apId: allowedActivity,
      type: "Follow",
      actorApId: allowedActor,
      rawJson: "{}",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      apId: blockedActivity,
      type: "Follow",
      actorApId: blockedActor,
      rawJson: "{}",
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  await db.insert(inbox).values([
    {
      actorApId: viewer,
      activityApId: allowedActivity,
      read: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    {
      actorApId: viewer,
      activityApId: blockedActivity,
      read: 0,
      createdAt: "2026-01-02T00:00:00.000Z",
    },
  ]);
  await blockDomain(db, "defederated.example", "operator block");

  const result = (await handleGetNotifications(
    ctxFor(db),
    { limit: 1 },
    { ap_id: viewer },
  )) as unknown as {
    __body: { data: { notifications: Array<{ id: string }> } };
  };
  expect(
    result.__body.data.notifications.map((notification) => notification.id),
  ).toEqual([allowedActivity]);
});
