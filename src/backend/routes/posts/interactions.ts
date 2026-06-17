import { Hono } from "hono";
import type { Context } from "hono";
import type { Env, Variables } from "../../types.ts";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  actors,
  announces,
  bookmarks,
  inbox as inboxTable,
  likes,
  objects,
} from "../../../db/index.ts";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
  objectApId,
  parseLimit,
  safeJsonParse,
} from "../../federation-helpers.ts";
import { MAX_POSTS_PAGE_LIMIT } from "./transformers.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "posts.interactions" });

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Shared helpers (file-local)
// ---------------------------------------------------------------------------

/** Look up a post by local ID or full AP ID. Returns null when not found. */
async function findPost(c: AppContext, selectFields?: "apIdOnly") {
  const db = c.get("db");
  const postId = c.req.param("id")!;
  const baseUrl = c.env.APP_URL;

  const whereCondition = or(
    eq(objects.apId, objectApId(baseUrl, postId)),
    eq(objects.apId, postId),
  );

  if (selectFields === "apIdOnly") {
    return (
      db
        .select({ apId: objects.apId, attributedTo: objects.attributedTo })
        .from(objects)
        .where(whereCondition)
        .get() ?? null
    );
  }

  return (
    db.query.objects.findFirst({
      where: whereCondition,
    }) ?? null
  );
}

/**
 * Best-effort delivery of an activity to a remote actor.
 * Errors are logged but never propagated.
 */
async function deliverToRemote(
  env: Env,
  activityId: string,
  recipientApId: string,
): Promise<void> {
  try {
    await enqueueDeliveryToActor(env, activityId, recipientApId);
  } catch (err) {
    log.error("Failed to enqueue delivery", {
      event: "posts.delivery.enqueue_failed",
      activityId,
      recipient: recipientApId,
      error: err,
    });
  }
}

/**
 * Atomic multi-statement commit.
 *
 * D1 has no interactive transactions, but both the D1 and libsql drivers
 * expose `db.batch([...])`, which commits a list of prepared statements
 * atomically. The shared `Database` union aliases the abstract
 * `BaseSQLiteDatabase` base (which does not surface `batch`), so we narrow to
 * the concrete batch surface here rather than weakening the shared type.
 */
type BatchStatement = BatchItem<"sqlite">;
interface BatchableDb {
  batch(
    statements: readonly [BatchStatement, ...BatchStatement[]],
  ): Promise<unknown>;
}

async function runBatch(
  db: Database,
  statements: readonly [BatchStatement, ...BatchStatement[]],
): Promise<void> {
  await (db as unknown as BatchableDb).batch(statements);
}

// ---------------------------------------------------------------------------
// Like / Unlike
// ---------------------------------------------------------------------------

posts.post("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;

  const existingLike = await db
    .select({ actorApId: likes.actorApId })
    .from(likes)
    .where(
      and(eq(likes.actorApId, actor.ap_id), eq(likes.objectApId, post.apId)),
    )
    .get();
  if (existingLike) return c.json({ error: "Already liked" }, 400);

  const likeId = generateId();
  const likeActivityId = activityApId(baseUrl, likeId);
  const likeActivityRaw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: likeActivityId,
    type: "Like",
    actor: actor.ap_id,
    object: post.apId,
  };
  const now = new Date().toISOString();
  const shouldNotifyLocal =
    post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);

  // D1 has no interactive transactions; group the child-row insert, counter
  // bump, activity row, and (optional) inbox row into a single atomic batch so
  // the like row and likeCount can never diverge on a mid-request failure.
  const likeStatements: BatchStatement[] = [
    db.insert(likes).values({
      actorApId: actor.ap_id,
      objectApId: post.apId,
      activityApId: likeActivityId,
    }),
    db
      .update(objects)
      .set({ likeCount: sql`${objects.likeCount} + 1` })
      .where(eq(objects.apId, post.apId)),
    db.insert(activities).values({
      apId: likeActivityId,
      type: "Like",
      actorApId: actor.ap_id,
      objectApId: post.apId,
      rawJson: JSON.stringify(likeActivityRaw),
      createdAt: now,
    }),
  ];

  if (shouldNotifyLocal) {
    likeStatements.push(
      db.insert(inboxTable).values({
        actorApId: post.attributedTo,
        activityApId: likeActivityId,
        read: 0,
        createdAt: now,
      }),
    );
  }

  await runBatch(db, likeStatements as [BatchStatement, ...BatchStatement[]]);

  if (!isLocal(post.apId, baseUrl)) {
    await deliverToRemote(c.env, likeActivityId, post.attributedTo);
  }

  return c.json({ success: true, liked: true });
});

posts.delete("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;

  const like = await db
    .select({
      actorApId: likes.actorApId,
      activityApId: likes.activityApId,
    })
    .from(likes)
    .where(
      and(eq(likes.actorApId, actor.ap_id), eq(likes.objectApId, post.apId)),
    )
    .get();
  if (!like) return c.json({ error: "Not liked" }, 400);

  // D1 has no interactive transactions; group the like-row delete and the
  // counter decrement into a single atomic batch so they cannot diverge.
  await runBatch(db, [
    db
      .delete(likes)
      .where(
        and(eq(likes.actorApId, actor.ap_id), eq(likes.objectApId, post.apId)),
      ),
    db
      .update(objects)
      .set({ likeCount: sql`${objects.likeCount} - 1` })
      .where(and(eq(objects.apId, post.apId), gt(objects.likeCount, 0))),
  ]);

  if (!isLocal(post.apId, baseUrl)) {
    const undoObject = like.activityApId
      ? like.activityApId
      : { type: "Like", actor: actor.ap_id, object: post.apId };

    const undoActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Undo",
      actor: actor.ap_id,
      object: undoObject,
    };

    await db
      .insert(activities)
      .values({
        apId: undoActivity.id,
        type: "Undo",
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(undoActivity),
        direction: "outbound",
      })
      .onConflictDoNothing();

    await deliverToRemote(c.env, undoActivity.id, post.attributedTo);
  }

  return c.json({ success: true, liked: false });
});

// ---------------------------------------------------------------------------
// Repost (Announce) / Unrepost (Undo Announce)
// ---------------------------------------------------------------------------

posts.post("/:id/repost", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;

  const existingRepost = await db
    .select({ actorApId: announces.actorApId })
    .from(announces)
    .where(
      and(
        eq(announces.actorApId, actor.ap_id),
        eq(announces.objectApId, post.apId),
      ),
    )
    .get();
  if (existingRepost) return c.json({ error: "Already reposted" }, 400);

  const announceId = generateId();
  const announceActivityId = activityApId(baseUrl, announceId);
  const announceActivityRaw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: announceActivityId,
    type: "Announce",
    actor: actor.ap_id,
    object: post.apId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [actor.ap_id + "/followers"],
  };
  const now = new Date().toISOString();
  const shouldNotifyLocal =
    post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);

  // D1 has no interactive transactions; group the child-row insert, counter
  // bump, activity row, and (optional) inbox row into a single atomic batch so
  // the announce row and announceCount can never diverge.
  const repostStatements: BatchStatement[] = [
    db.insert(announces).values({
      actorApId: actor.ap_id,
      objectApId: post.apId,
      activityApId: announceActivityId,
    }),
    db
      .update(objects)
      .set({ announceCount: sql`${objects.announceCount} + 1` })
      .where(eq(objects.apId, post.apId)),
    db.insert(activities).values({
      apId: announceActivityId,
      type: "Announce",
      actorApId: actor.ap_id,
      objectApId: post.apId,
      rawJson: JSON.stringify(announceActivityRaw),
      createdAt: now,
    }),
  ];

  if (shouldNotifyLocal) {
    repostStatements.push(
      db.insert(inboxTable).values({
        actorApId: post.attributedTo,
        activityApId: announceActivityId,
        read: 0,
        createdAt: now,
      }),
    );
  }

  await runBatch(db, repostStatements as [BatchStatement, ...BatchStatement[]]);

  if (!isLocal(post.apId, baseUrl)) {
    await deliverToRemote(c.env, announceActivityId, post.attributedTo);
  }

  return c.json({ success: true, reposted: true });
});

posts.delete("/:id/repost", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;

  const announce = await db
    .select({ actorApId: announces.actorApId })
    .from(announces)
    .where(
      and(
        eq(announces.actorApId, actor.ap_id),
        eq(announces.objectApId, post.apId),
      ),
    )
    .get();
  if (!announce) return c.json({ error: "Not reposted" }, 400);

  // D1 has no interactive transactions; group the announce-row delete and the
  // counter decrement into a single atomic batch so they cannot diverge.
  await runBatch(db, [
    db
      .delete(announces)
      .where(
        and(
          eq(announces.actorApId, actor.ap_id),
          eq(announces.objectApId, post.apId),
        ),
      ),
    db
      .update(objects)
      .set({ announceCount: sql`${objects.announceCount} - 1` })
      .where(and(eq(objects.apId, post.apId), gt(objects.announceCount, 0))),
  ]);

  if (!isLocal(post.apId, baseUrl)) {
    const undoActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Undo",
      actor: actor.ap_id,
      object: { type: "Announce", actor: actor.ap_id, object: post.apId },
    };

    await db
      .insert(activities)
      .values({
        apId: undoActivity.id,
        type: "Undo",
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(undoActivity),
        direction: "outbound",
      })
      .onConflictDoNothing();

    await deliverToRemote(c.env, undoActivity.id, post.attributedTo);
  }

  return c.json({ success: true, reposted: false });
});

// ---------------------------------------------------------------------------
// Bookmark / Unbookmark / List bookmarks
// ---------------------------------------------------------------------------

posts.post("/:id/bookmark", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c, "apIdOnly");
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");

  const existing = await db
    .select({ actorApId: bookmarks.actorApId })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.actorApId, actor.ap_id),
        eq(bookmarks.objectApId, post.apId),
      ),
    )
    .get();
  if (existing) return c.json({ error: "Already bookmarked" }, 400);

  await db.insert(bookmarks).values({
    actorApId: actor.ap_id,
    objectApId: post.apId,
  });

  return c.json({ success: true, bookmarked: true });
});

posts.delete("/:id/bookmark", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c, "apIdOnly");
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");

  const bookmark = await db
    .select({ actorApId: bookmarks.actorApId })
    .from(bookmarks)
    .where(
      and(
        eq(bookmarks.actorApId, actor.ap_id),
        eq(bookmarks.objectApId, post.apId),
      ),
    )
    .get();
  if (!bookmark) return c.json({ error: "Not bookmarked" }, 400);

  await db
    .delete(bookmarks)
    .where(
      and(
        eq(bookmarks.actorApId, actor.ap_id),
        eq(bookmarks.objectApId, post.apId),
      ),
    );

  return c.json({ success: true, bookmarked: false });
});

posts.get("/bookmarks", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const limit = parseLimit(c.req.query("limit"), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query("before");

  const whereCondition = before
    ? and(
        eq(bookmarks.actorApId, actor.ap_id),
        sql`${bookmarks.createdAt} < ${before}`,
      )
    : eq(bookmarks.actorApId, actor.ap_id);

  const bookmarkRows = await db.query.bookmarks.findMany({
    where: whereCondition,
    with: { object: true },
    orderBy: desc(bookmarks.createdAt),
    limit,
  });

  // Batch-load author info to avoid N+1 queries
  const authorApIds = [
    ...new Set(bookmarkRows.map((b) => b.object.attributedTo)),
  ];
  const [localActors, cachedActors] = await Promise.all([
    db
      .select({
        apId: actors.apId,
        preferredUsername: actors.preferredUsername,
        name: actors.name,
        iconUrl: actors.iconUrl,
      })
      .from(actors)
      .where(inArray(actors.apId, authorApIds)),
    db
      .select({
        apId: actorCache.apId,
        preferredUsername: actorCache.preferredUsername,
        name: actorCache.name,
        iconUrl: actorCache.iconUrl,
      })
      .from(actorCache)
      .where(inArray(actorCache.apId, authorApIds)),
  ]);

  const actorMap = new Map([
    ...cachedActors.map((a) => [a.apId, a] as const),
    ...localActors.map((a) => [a.apId, a] as const),
  ]);

  // Batch-load likes for all bookmarked posts
  const postApIds = bookmarkRows.map((b) => b.object.apId);
  const likeRows = await db
    .select({ objectApId: likes.objectApId })
    .from(likes)
    .where(
      and(
        eq(likes.actorApId, actor.ap_id),
        inArray(likes.objectApId, postApIds),
      ),
    );
  const likedPostIds = new Set(likeRows.map((l) => l.objectApId));

  const result = bookmarkRows.map((b) => {
    const obj = b.object;
    const authorInfo = actorMap.get(obj.attributedTo);

    return {
      ap_id: obj.apId,
      type: obj.type,
      author: {
        ap_id: obj.attributedTo,
        username: formatUsername(obj.attributedTo),
        preferred_username: authorInfo?.preferredUsername ?? null,
        name: authorInfo?.name ?? null,
        icon_url: authorInfo?.iconUrl ?? null,
      },
      content: obj.content,
      summary: obj.summary,
      attachments: safeJsonParse(obj.attachmentsJson, []),
      in_reply_to: obj.inReplyTo,
      visibility: obj.visibility,
      community_ap_id: obj.communityApId,
      like_count: obj.likeCount,
      reply_count: obj.replyCount,
      announce_count: obj.announceCount,
      published: obj.published,
      liked: likedPostIds.has(obj.apId),
      bookmarked: true,
      reposted: false,
    };
  });

  return c.json({ posts: result });
});

export default posts;
