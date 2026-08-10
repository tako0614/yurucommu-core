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
  follows,
  inbox as inboxTable,
  likes,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { isUniqueConstraintError } from "../../lib/parse-helpers.ts";
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
import {
  enqueueDeliveryToActor,
  enqueueFanoutToFollowers,
} from "../../lib/delivery/queue.ts";
import { communityReadableApIds } from "../../lib/community-visibility.ts";
import { encodeFeedCursor, feedCursorWhere } from "../../lib/feed-cursor.ts";
import {
  actorIsBlockedBy,
  canViewerReadObjectFull,
  passesPostVisibilitySync,
} from "../../lib/post-visibility.ts";
import { logger } from "../../lib/logger.ts";
import { excludeModeratedActors } from "../../lib/feed-exclude.ts";
import { isActorBlockedStrict } from "../../lib/blocklist.ts";
import { activityDeleteCascadeStatements } from "../../lib/activity-delete-cascade.ts";
import { setPostLike } from "./like-mutation.ts";
import { prepareDeliveryFanoutJob } from "../../lib/delivery/fanout-outbox.ts";

const log = logger.child({ component: "posts.interactions" });

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Shared helpers (file-local)
// ---------------------------------------------------------------------------

/** Look up a post by local ID or full AP ID. Returns null when not found. */
async function findPost(
  c: AppContext,
): Promise<typeof objects.$inferSelect | null>;
async function findPost(
  c: AppContext,
  selectFields: "apIdOnly",
): Promise<{ apId: string; attributedTo: string } | null>;
async function findPost(
  c: AppContext,
  selectFields?: "apIdOnly",
): Promise<
  | typeof objects.$inferSelect
  | { apId: string; attributedTo: string }
  | null
  | undefined
> {
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

async function publishDurableFollowerFanoutWakeup(
  env: Env,
  activityId: string,
  actorApId: string,
  operation: "repost" | "unrepost",
): Promise<void> {
  try {
    await enqueueFanoutToFollowers(env, activityId, actorApId);
  } catch (error) {
    // The route has already committed the interaction, Activity, and fanout
    // intent atomically. A Queue RPC is only a wakeup; leave the row pending so
    // scheduled/startup recovery can publish it without turning a successful
    // user mutation into a misleading HTTP 500.
    log.error("Failed to publish durable repost fanout wakeup", {
      event: "posts.repost.fanout_wakeup_failed",
      operation,
      activityId,
      actor: actorApId,
      error,
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

  // Only a post the actor can actually read may be liked: without this an authed
  // user who learns a post's apId could "like" a followers-only / direct /
  // private-community post they were never shown, notifying the author and
  // bumping the count from an unentitled actor. 404 (not 403) so existence is
  // not revealed, mirroring the post-detail gate. `post` is the full row loaded
  // above, so the read-gate runs against it directly.
  if (!(await canViewerReadObjectFull(db, post, actor.ap_id))) {
    return c.json({ error: "Post not found" }, 404);
  }
  // A blocked actor must not be able to like (bump likeCount + notify) the author
  // who blocked them — mirror the story-like / DM block guard (404, not 403).
  if (await actorIsBlockedBy(db, post.attributedTo, actor.ap_id)) {
    return c.json({ error: "Post not found" }, 404);
  }

  const result = await setPostLike({
    db,
    env: c.env,
    actorApId: actor.ap_id,
    post,
    active: true,
  });
  if (!result.changed) return c.json({ error: "Already liked" }, 400);

  return c.json({ success: true, liked: true });
});

posts.delete("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");

  const result = await setPostLike({
    db,
    env: c.env,
    actorApId: actor.ap_id,
    post,
    active: false,
  });
  if (!result.changed) return c.json({ error: "Not liked" }, 400);

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

  // Repost has a public-reach gate rather than the canonical read gate below,
  // so enforce instance moderation explicitly before it can persist/fan out an
  // Announce for a retained object from a defederated actor/domain.
  if (await isActorBlockedStrict(db, post.attributedTo)) {
    return c.json({ error: "Post not found" }, 404);
  }

  // A repost is always an Announce addressed to Public + the booster's
  // followers (see the activity built below), so it re-broadcasts the object to
  // a wider audience than the original. Only a post whose reach is ALREADY
  // public may be boosted: reposting a followers-only / direct / community-
  // scoped post would leak restricted content out to the public (Mastodon
  // likewise forbids boosting followers-only and direct posts). "Truly public"
  // = visibility public/unlisted AND no community/addressed audience (an empty
  // audienceJson — community feed + chat posts both carry a non-empty audience).
  // `post` is the full row loaded above, so reach is read from it directly.
  const boostable =
    // A Story is stored visibility="public"/audienceJson="[]" but its reach is
    // followers-only and it is ephemeral — boosting it would re-broadcast
    // follower-scoped content to the booster's public audience past its lifetime.
    post.type !== "Story" &&
    (post.visibility === "public" || post.visibility === "unlisted") &&
    post.audienceJson === "[]";
  if (!boostable) {
    return c.json({ error: "This post cannot be reposted" }, 403);
  }
  // A blocked actor must not be able to repost (bump announceCount + notify) the
  // author who blocked them — mirror the story-like / DM block guard (404).
  if (await actorIsBlockedBy(db, post.attributedTo, actor.ap_id)) {
    return c.json({ error: "Post not found" }, 404);
  }

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
  const preparedFanout = await prepareDeliveryFanoutJob(db, {
    kind: "followers",
    activityId: announceActivityId,
    targetApId: actor.ap_id,
  });

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
    preparedFanout.statement as BatchStatement,
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

  try {
    await runBatch(
      db,
      repostStatements as [BatchStatement, ...BatchStatement[]],
    );
  } catch (e) {
    // Concurrent duplicate repost → composite-PK UNIQUE → idempotent 400.
    if (isUniqueConstraintError(e)) {
      return c.json({ error: "Already reposted" }, 400);
    }
    throw e;
  }

  // The Announce is cc'd to the booster's own followers collection, so fan it
  // out to them — otherwise a repost only ever reached the original author's
  // inbox and was invisible to the booster's remote followers.
  await publishDurableFollowerFanoutWakeup(
    c.env,
    announceActivityId,
    actor.ap_id,
    "repost",
  );

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
    .select({
      actorApId: announces.actorApId,
      activityApId: announces.activityApId,
    })
    .from(announces)
    .where(
      and(
        eq(announces.actorApId, actor.ap_id),
        eq(announces.objectApId, post.apId),
      ),
    )
    .get();
  if (!announce) return c.json({ error: "Not reposted" }, 400);

  const undoActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Undo",
    actor: actor.ap_id,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [actor.ap_id + "/followers"],
    object: { type: "Announce", actor: actor.ap_id, object: post.apId },
  };
  const preparedFanout = await prepareDeliveryFanoutJob(db, {
    kind: "followers",
    activityId: undoActivity.id,
    targetApId: actor.ap_id,
  });

  // D1 has no interactive transactions; group the announce-row delete and the
  // counter decrement into a single atomic batch so they cannot diverge. Also
  // reap the original repost activity plus all durable projections (same
  // duplicate-notification issue as unlike: each repost mints a fresh Announce
  // activity id and the guard only checks the edge, so
  // repost→unrepost→repost would stack notifications and queue residue).
  const reapRepostNotification: BatchStatement[] = announce.activityApId
    ? [
        ...activityDeleteCascadeStatements(
          db,
          eq(activities.apId, announce.activityApId),
        ),
      ]
    : [];
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
    ...reapRepostNotification,
    db
      .insert(activities)
      .values({
        apId: undoActivity.id,
        type: "Undo",
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(undoActivity),
        direction: "outbound",
      })
      .onConflictDoNothing(),
    preparedFanout.statement as BatchStatement,
  ]);

  // Mirror the Announce reach: the Undo must reach the booster's followers (who
  // saw the repost) regardless of whether the boosted post was local or remote.
  await publishDurableFollowerFanoutWakeup(
    c.env,
    undoActivity.id,
    actor.ap_id,
    "unrepost",
  );

  // The boosted post's author instance is only an extra recipient for a remote post.
  if (!isLocal(post.apId, baseUrl)) {
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

  // Load the FULL row (not apId-only) so the read-gate can run: previously this
  // resolved by apId with NO visibility/block check, so any authed user could
  // bookmark any object by id — including a followers-only / direct / private-
  // community post or a personal Story they were never shown — which then leaked
  // via GET /bookmarks. Gate it like /like and /repost (#3).
  const post = await findPost(c);
  if (!post) return c.json({ error: "Post not found" }, 404);

  const db = c.get("db");

  // 404 (not 403) so existence is not revealed, mirroring the like/repost gate.
  if (!(await canViewerReadObjectFull(db, post, actor.ap_id))) {
    return c.json({ error: "Post not found" }, 404);
  }
  if (await actorIsBlockedBy(db, post.attributedTo, actor.ap_id)) {
    return c.json({ error: "Post not found" }, 404);
  }

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

  // onConflictDoNothing so two concurrent bookmarks of the same post (two tabs /
  // a retried slow request) that both pass the existence check don't 500 the
  // loser on the (actorApId, objectApId) composite PK — the edge is idempotent.
  await db
    .insert(bookmarks)
    .values({
      actorApId: actor.ap_id,
      objectApId: post.apId,
    })
    .onConflictDoNothing();

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

  // Composite (createdAt, objectApId) cursor — createdAt is not unique, so a
  // bare cursor would skip same-timestamp bookmarks at a boundary; objectApId is
  // the unique tiebreaker (see lib/feed-cursor.ts).
  const cursorPredicate = feedCursorWhere(
    bookmarks.createdAt,
    bookmarks.objectApId,
    before,
  );

  // Fetch limit+1 and advance the cursor by the last SCANNED row, so the
  // visibility gate dropping rows can only shorten a page, never make a readable
  // bookmark permanently unreachable (load-more continues past the dropped ones).
  const scanned = await db
    .select({ bookmark: bookmarks, object: objects })
    .from(bookmarks)
    .innerJoin(objects, eq(bookmarks.objectApId, objects.apId))
    .where(
      and(
        eq(bookmarks.actorApId, actor.ap_id),
        cursorPredicate,
        excludeModeratedActors(actor.ap_id),
      ),
    )
    .orderBy(desc(bookmarks.createdAt), desc(bookmarks.objectApId))
    .limit(limit + 1);
  const hasMore = scanned.length > limit;
  const allBookmarkRows = hasMore ? scanned.slice(0, limit) : scanned;
  const lastScanned = allBookmarkRows[allBookmarkRows.length - 1];
  const nextCursor =
    hasMore && lastScanned
      ? encodeFeedCursor(
          lastScanned.bookmark.createdAt,
          lastScanned.bookmark.objectApId,
        )
      : null;

  // Re-check read-access at read time so a bookmark can never resurface a post
  // the viewer can no longer read. The per-post visibility decision is delegated
  // to the canonical `passesPostVisibilitySync` (the SAME predicate the
  // single-object gate uses) so the to/cc explicit-recipient and Story branches
  // cannot drift here — the hand-rolled gate this replaces dropped the cc check
  // AND had no Story reach/expiry branch, leaking a personal (followers-only)
  // Story's caption/overlay/attachment metadata to a non-follower and past
  // expiry (#3). The private-community membership gate is applied separately by
  // the batched `communityReadableApIds` below.
  //
  // Batch the follower lookup: an accepted follow could matter for a
  // followers-only post OR a personal (non-community) story, so collect those
  // authors and resolve them in one query, then feed the Set to the predicate.
  const followerGateAuthors = [
    ...new Set(
      allBookmarkRows
        .filter(
          (b) =>
            b.object.attributedTo !== actor.ap_id &&
            ((b.object.type === "Story" && !b.object.communityApId) ||
              (b.object.type !== "Story" &&
                b.object.visibility === "followers")),
        )
        .map((b) => b.object.attributedTo),
    ),
  ];
  const followedAuthors =
    followerGateAuthors.length > 0
      ? new Set(
          (
            await db
              .select({ followingApId: follows.followingApId })
              .from(follows)
              .where(
                and(
                  eq(follows.followerApId, actor.ap_id),
                  inArray(follows.followingApId, followerGateAuthors),
                  eq(follows.status, "accepted"),
                ),
              )
          ).map((r) => r.followingApId),
        )
      : new Set<string>();

  // Hidden bto/bcc identities cannot live in to_json/cc_json. Resolve the
  // indexed recipient projection once for this page so a hidden recipient who
  // successfully bookmarked a readable post does not lose it on list refresh.
  const projectedCandidateIds = allBookmarkRows
    .filter(
      (b) =>
        b.object.attributedTo !== actor.ap_id &&
        (b.object.visibility === "direct" ||
          b.object.visibility === "followers"),
    )
    .map((b) => b.object.apId);
  const projectedRecipientIds =
    projectedCandidateIds.length > 0
      ? new Set(
          (
            await db
              .select({ objectApId: objectRecipients.objectApId })
              .from(objectRecipients)
              .where(
                and(
                  eq(objectRecipients.recipientApId, actor.ap_id),
                  eq(objectRecipients.type, "to"),
                  inArray(objectRecipients.objectApId, projectedCandidateIds),
                ),
              )
          ).map((row) => row.objectApId),
        )
      : new Set<string>();

  // Sync visibility-gate first, then ONE batched community read-gate over the
  // survivors (2 queries instead of 1-2 per bookmarked post).
  const visibilityOk = allBookmarkRows.filter((b) =>
    passesPostVisibilitySync(
      b.object,
      actor.ap_id,
      (a) => followedAuthors.has(a),
      (objectApId) => projectedRecipientIds.has(objectApId),
    ),
  );
  const communityReadable = await communityReadableApIds(
    db,
    visibilityOk.map((b) => b.object),
    actor.ap_id,
  );
  const bookmarkRows = visibilityOk.filter((b) =>
    communityReadable.has(b.object.apId),
  );

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

  return c.json({ posts: result, has_more: hasMore, next_cursor: nextCursor });
});

export default posts;
