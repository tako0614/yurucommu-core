import { Hono } from "hono";
import {
  actors,
  follows,
  objectRecipients,
  objects,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Actor, Env, Variables } from "../../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  objectApId,
  parseLimit,
  safeJsonParse,
} from "../../federation-helpers.ts";
import {
  formatPost,
  MAX_POSTS_PAGE_LIMIT,
  normalizeVisibility,
  PostRow,
} from "./transformers.ts";
import {
  AUTHOR_WITH,
  loadInteractionFlags,
  preparePersistAndFanout,
  preparePersistAndFanoutToCommunity,
  type PostDetailRow,
  postWhereByIdOrApId,
  resolveAuthor,
  resolveAuthorWithCache,
  toPostRow,
} from "./queries.ts";
import {
  prepareObjectDeleteCascade,
  purgeMediaBlobs,
} from "./delete-cascade.ts";
import {
  checkCommunityPostPermission,
  deriveContentTags,
  preparePostInsertStatements,
  validateContentEdit,
  validateCreatePostBody,
  validateEditBody,
  validateSummaryEdit,
} from "./post-helpers.ts";
import { loadActorInfoMap, requireActor } from "../actors-helpers.ts";
import { communityReadableApIds } from "../../lib/community-visibility.ts";
import { encodeFeedCursor, feedCursorWhere } from "../../lib/feed-cursor.ts";
import {
  actorIsBlockedBy,
  canViewerReadObjectFull,
  passesPostVisibilitySync,
  type ReadGateObject,
} from "../../lib/post-visibility.ts";
import { logger } from "../../lib/logger.ts";
import { excludeModeratedActors } from "../../lib/feed-exclude.ts";
import {
  prepareCreatedPostFederation,
  prepareDeletedPostFederation,
} from "./federation.ts";

const log = logger.child({ component: "posts.routes" });

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Reply row shape needed for the visibility gate (subset of the object row). */
type ReplyVisibilityRow = ReadGateObject & {
  apId: string;
};

/**
 * Apply the SAME per-post visibility gate that GET /:id uses, to a LIST of
 * replies, so a follower-only or direct reply is never returned to a viewer
 * who is not its author / an accepted follower / an addressed recipient.
 *
 * `public` and `unlisted` replies are always visible. The accepted-follow
 * edges the viewer needs across all follower-only reply authors are resolved
 * in a single batched query to avoid an N+1.
 */
async function filterVisibleReplies<T extends ReplyVisibilityRow>(
  db: Database,
  currentActor: Actor | null | undefined,
  replies: T[],
): Promise<T[]> {
  const viewerApId = currentActor?.ap_id;

  // Authors of follower-only replies the viewer does not own — these are the
  // only authors we need an accepted-follow edge for.
  const followerGateAuthors = new Set<string>();
  for (const reply of replies) {
    if (reply.visibility === "followers" && reply.attributedTo !== viewerApId) {
      followerGateAuthors.add(reply.attributedTo);
    }
  }

  let acceptedFollowing = new Set<string>();
  if (viewerApId && followerGateAuthors.size > 0) {
    const rows = await db
      .select({ followingApId: follows.followingApId })
      .from(follows)
      .where(
        and(
          eq(follows.followerApId, viewerApId),
          inArray(follows.followingApId, [...followerGateAuthors]),
          eq(follows.status, "accepted"),
        ),
      );
    acceptedFollowing = new Set(rows.map((r) => r.followingApId));
  }

  const projectedRecipientIds =
    viewerApId && replies.length > 0
      ? new Set(
          (
            await db
              .select({ objectApId: objectRecipients.objectApId })
              .from(objectRecipients)
              .where(
                and(
                  eq(objectRecipients.recipientApId, viewerApId),
                  eq(objectRecipients.type, "to"),
                  inArray(
                    objectRecipients.objectApId,
                    replies.map((reply) => reply.apId),
                  ),
                ),
              )
          ).map((row) => row.objectApId),
        )
      : new Set<string>();

  // Pre-compute the community read-gate for every reply: a community-scoped
  // reply is stored "public" but carries an audience, so the per-visibility
  // checks below would let it through. Resolving membership here (rather than
  // inside the synchronous .filter) lets the predicate stay synchronous.
  // Batched community read-gate for the whole page (2 queries, not 1-2 per
  // reply). Same semantics as canViewerReadObject.
  const communityReadable = await communityReadableApIds(
    db,
    replies,
    viewerApId,
  );

  return replies.filter((reply) => {
    // A private-community reply is hidden from anyone who is not an accepted
    // member, regardless of the (stored "public") visibility.
    if (!communityReadable.has(reply.apId)) return false;
    return passesPostVisibilitySync(
      reply,
      viewerApId,
      (authorApId) => acceptedFollowing.has(authorApId),
      (objectApId) => projectedRecipientIds.has(objectApId),
    );
  });
}

// --- Route handlers ---

// Create post
posts.post("/", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const validation = await validateCreatePostBody(c);
  if (!validation.ok) {
    return c.json(
      {
        error: validation.error,
        ...(validation.code ? { code: validation.code } : {}),
      },
      400,
    );
  }
  const { body, content, summary } = validation;

  const db = c.get("db");
  const visibility = normalizeVisibility(body.visibility);

  const communityCheck = await checkCommunityPostPermission(
    db,
    actor.ap_id,
    body.community_ap_id,
  );
  if (!communityCheck.allowed) {
    return c.json({ error: communityCheck.error }, communityCheck.status);
  }
  const communityId = communityCheck.communityId;
  const community = communityCheck.community;

  // Reply read-gate: a reply may only target a parent the replier can actually
  // READ. Without this, anyone who learns a followers-only / direct /
  // private-community post's apId could reply to it — inflating the author's
  // replyCount, sending them a reply notification, and publishing a public reply
  // whose inReplyTo discloses the restricted parent's existence (and bypassing a
  // block). Mirror the like/repost gates; 404 to avoid leaking existence.
  let parentAuthor: string | null = null;
  if (body.in_reply_to) {
    const parent = await db
      .select({
        apId: objects.apId,
        visibility: objects.visibility,
        attributedTo: objects.attributedTo,
        toJson: objects.toJson,
        ccJson: objects.ccJson,
        audienceJson: objects.audienceJson,
        communityApId: objects.communityApId,
        type: objects.type,
        endTime: objects.endTime,
      })
      .from(objects)
      .where(eq(objects.apId, body.in_reply_to))
      .get();
    if (
      !parent ||
      !(await canViewerReadObjectFull(db, parent, actor.ap_id)) ||
      (await actorIsBlockedBy(db, parent.attributedTo, actor.ap_id))
    ) {
      return c.json({ error: "Post not found" }, 404);
    }
    parentAuthor = parent.attributedTo;
  }

  const baseUrl = c.env.APP_URL;
  const postId = generateId();
  const apId = objectApId(baseUrl, postId);
  const now = new Date().toISOString();

  let preparedFederation: Awaited<
    ReturnType<typeof prepareCreatedPostFederation>
  >;
  try {
    preparedFederation = await prepareCreatedPostFederation({
      db,
      env: c.env,
      actorApId: actor.ap_id,
      objectApId: apId,
      content,
      summary: summary || null,
      attachments: body.attachments,
      inReplyTo: body.in_reply_to || null,
      parentAuthor,
      visibility,
      community,
      published: now,
    });
    const localStatements = preparePostInsertStatements(db, {
      apId,
      actorApId: actor.ap_id,
      content,
      summary: summary || null,
      attachments: body.attachments,
      inReplyTo: body.in_reply_to || null,
      visibility,
      communityId,
      to: preparedFederation.to,
      cc: preparedFederation.cc,
      audience: preparedFederation.audience,
      tags: preparedFederation.tags,
      parentAuthor,
      baseUrl,
      now,
    });
    await runBatch(db, [...localStatements, ...preparedFederation.statements]);
  } catch (e) {
    log.error("Failed to create post transaction", {
      event: "posts.create.transaction_failed",
      actor: actor.ap_id,
      communityId,
      error: e,
    });
    return c.json({ error: "Failed to create post" }, 500);
  }

  const { mentionFailures } = await preparedFederation.complete();

  const createdPost = {
    ap_id: apId,
    type: "Note",
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id, actor.preferred_username),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url,
    },
    content,
    summary: summary || null,
    attachments: body.attachments || [],
    visibility,
    published: now,
    like_count: 0,
    reply_count: 0,
    announce_count: 0,
    liked: false,
    bookmarked: false,
    ...(mentionFailures.length > 0
      ? {
          mention_processing: {
            failed_count: mentionFailures.length,
            failures: mentionFailures,
          },
        }
      : {}),
  };

  return c.json({
    ...createdPost,
    post: createdPost,
  });
});

// Get single post
posts.get("/:id", async (c) => {
  const currentActor = c.get("actor");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const db = c.get("db");

  const post = await db.query.objects.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
    with: AUTHOR_WITH,
  });

  if (!post) return c.json({ error: "Post not found" }, 404);
  if (currentActor) {
    // Drizzle's relational query aliases every embedded column reference to the
    // outer table, so keep the moderation CTE in this ordinary select instead
    // of injecting it into findFirst({ with: ... }).
    const moderationReadable = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(
        and(
          eq(objects.apId, post.apId),
          excludeModeratedActors(currentActor.ap_id),
        ),
      )
      .get();
    if (!moderationReadable) {
      return c.json({ error: "Post not found" }, 404);
    }
  }

  // Resolve author and interaction flags in parallel
  const [author, { likedIds, bookmarkedIds }] = await Promise.all([
    resolveAuthorWithCache(post.author, post.attributedTo, db),
    loadInteractionFlags(db, currentActor?.ap_id, [post.apId]),
  ]);
  const liked = likedIds.has(post.apId);
  const bookmarked = bookmarkedIds.has(post.apId);

  // Single canonical read-gate: community membership + per-post visibility
  // (public / unlisted / followers / direct, honoring an explicit to/cc mention)
  // + the Story reach rule (a Story is stored "public" / empty-audience but is
  // followers-/member-only and is revoked at endTime — without the Story branch
  // its full caption/poll/media payload leaked here to any caller with the apId).
  // `post` (a full objects row) carries type + endTime so the Story branch fires.
  if (!(await canViewerReadObjectFull(db, post, currentActor?.ap_id))) {
    return c.json({ error: "Post not found" }, 404);
  }

  const postRow: PostDetailRow = toPostRow(post, author, { liked, bookmarked });

  return c.json({ post: formatPost(postRow, currentActor?.ap_id) });
});

// Get post replies
posts.get("/:id/replies", async (c) => {
  const currentActor = c.get("actor");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const limit = parseLimit(c.req.query("limit"), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query("before");
  const db = c.get("db");

  const parentPost = await db
    .select({
      apId: objects.apId,
      visibility: objects.visibility,
      attributedTo: objects.attributedTo,
      toJson: objects.toJson,
      ccJson: objects.ccJson,
      audienceJson: objects.audienceJson,
      communityApId: objects.communityApId,
      type: objects.type,
      endTime: objects.endTime,
    })
    .from(objects)
    .where(
      and(
        postWhereByIdOrApId(baseUrl, postId),
        excludeModeratedActors(currentActor?.ap_id ?? ""),
      ),
    )
    .get();

  if (!parentPost) return c.json({ error: "Post not found" }, 404);

  // Gate the parent with the FULL read-gate (community membership AND the
  // followers/direct per-post visibility), mirroring GET /:id and GET
  // /ap/objects/:id. Gating only the community dimension let anyone enumerate a
  // followers-only / direct parent's public replies and confirm the restricted
  // parent exists — an existence/metadata oracle the other surfaces deny.
  if (!(await canViewerReadObjectFull(db, parentPost, currentActor?.ap_id))) {
    return c.json({ error: "Post not found" }, 404);
  }

  // Composite (published, apId) cursor so replies sharing a published
  // millisecond aren't skipped at a page boundary (see lib/feed-cursor.ts).
  const cursorPredicate = feedCursorWhere(
    objects.published,
    objects.apId,
    before,
  );

  // Fetch limit+1 to compute has_more, then SLICE before the per-reply
  // visibility filter. Advancing the cursor by the last SCANNED row (not the
  // last readable one) means unreadable replies are skipped without ever
  // skipping a readable one — so load-more reaches every readable reply, and
  // the gate dropping rows can only make a page short, never lose a reply.
  const scanned = await db
    .select()
    .from(objects)
    .where(
      and(
        eq(objects.inReplyTo, parentPost.apId),
        cursorPredicate,
        excludeModeratedActors(currentActor?.ap_id ?? ""),
      ),
    )
    .orderBy(desc(objects.published), desc(objects.apId))
    .limit(limit + 1);
  const hasMore = scanned.length > limit;
  const page = hasMore ? scanned.slice(0, limit) : scanned;
  const lastScanned = page[page.length - 1];
  const nextCursor =
    hasMore && lastScanned
      ? encodeFeedCursor(lastScanned.published, lastScanned.apId)
      : null;

  // Apply the SAME visibility gate as GET /:id, per-reply: a follower-only or
  // direct reply must not leak to a viewer who is not its author / an accepted
  // follower / an addressed recipient. Resolve the accepted-follow edges the
  // viewer needs in a single batched query to avoid an N+1.
  const replies = await filterVisibleReplies(db, currentActor, page);

  // Batch load cached authors and interaction flags in parallel
  const replyApIds = replies.map((r) => r.apId);
  const [authorMap, { likedIds }] = await Promise.all([
    loadActorInfoMap(
      db,
      [...new Set(replies.map((reply) => reply.attributedTo))],
      "author",
    ),
    loadInteractionFlags(db, currentActor?.ap_id, replyApIds),
  ]);

  const result = replies.map((reply) => {
    const author = resolveAuthor(undefined, reply.attributedTo, authorMap);
    const postRow = toPostRow(reply, author, {
      liked: likedIds.has(reply.apId),
    });
    return formatPost(postRow, currentActor?.ap_id);
  });

  return c.json({
    replies: result,
    has_more: hasMore,
    next_cursor: nextCursor,
  });
});

// Edit post
posts.patch("/:id", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;

  const editValidation = await validateEditBody(c);
  if (!editValidation.ok) {
    return c.json(
      {
        error: editValidation.error,
        ...(editValidation.code ? { code: editValidation.code } : {}),
      },
      400,
    );
  }
  const { body } = editValidation;

  const db = c.get("db");

  const post = await db.query.objects.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
  });
  if (!post) return c.json({ error: "Post not found" }, 404);
  if (post.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  // Validate content
  const contentCheck = validateContentEdit(body.content);
  if (!contentCheck.ok) return c.json({ error: contentCheck.error }, 400);
  const trimmedContent = contentCheck.ok ? contentCheck.trimmed : undefined;

  // Validate summary
  const summaryCheck = validateSummaryEdit(body.summary);
  if (!summaryCheck.ok) return c.json({ error: summaryCheck.error }, 400);
  const trimmedSummary = summaryCheck.ok ? summaryCheck.trimmed : undefined;

  const nextContent =
    body.content !== undefined ? (trimmedContent as string) : post.content;
  const nextSummary =
    body.summary !== undefined ? trimmedSummary || null : post.summary;
  const now = new Date().toISOString();

  const updateData: {
    content?: string;
    summary?: string | null;
    tagsJson?: string;
    updated: string;
  } = { updated: now };

  if (body.content !== undefined) updateData.content = trimmedContent;
  if (body.summary !== undefined) updateData.summary = trimmedSummary || null;

  if (Object.keys(updateData).length === 1) {
    return c.json({ error: "No changes provided" }, 400);
  }

  // Re-derive the post's AS2 tags (Hashtag + Mention) from the next content so
  // the served object doc and the Update(Note) below carry the same tags a
  // fresh post would — otherwise editing a #hashtag / @mention post would strip
  // those tags from remote copies. Side-effect-free (no re-notification);
  // persist tagsJson only when the content actually changed.
  const nextTags = await deriveContentTags(
    db,
    nextContent,
    baseUrl,
    actor.ap_id,
  );
  if (body.content !== undefined) {
    updateData.tagsJson = JSON.stringify(nextTags);
  }

  // Mirror the stored post's addressing onto the Update so its audience matches
  // the ORIGINAL post (like the Delete path). Without this the Update carried no
  // to/cc/audience and — combined with the community branch below — fanned out
  // to the wrong graph.
  const updateTo = safeJsonParse<string[]>(post.toJson, []);
  const updateCc = safeJsonParse<string[]>(post.ccJson, []);
  const updateAudience = safeJsonParse<string[]>(post.audienceJson, []);

  const updateActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Update",
    actor: actor.ap_id,
    to: updateTo,
    cc: updateCc,
    ...(updateAudience.length > 0 ? { audience: updateAudience } : {}),
    object: {
      id: post.apId,
      type: "Note",
      attributedTo: actor.ap_id,
      content: nextContent,
      summary: nextSummary,
      // Keep the CW's `sensitive` flag in sync on edit. Unlike the create path
      // this is always a boolean (not omitted) so that REMOVING a content
      // warning pushes `sensitive: false` and clears it on followers who act on
      // the Update without re-fetching the object.
      sensitive: Boolean(nextSummary),
      // Carry the re-derived tags so a receiver updating the Note keeps its
      // Hashtag/Mention tags instead of dropping them on edit.
      // Always carry the projection. `[]` is an explicit clear; omission is
      // reserved for partial third-party Updates that ask receivers to preserve
      // their existing tag projection.
      tag: nextTags,
      to: updateTo,
      cc: updateCc,
      ...(updateAudience.length > 0 ? { audience: updateAudience } : {}),
      updated: now,
    },
  };

  // A community-scoped post's Update must reach the COMMUNITY (the members who
  // got the Create), NOT the author's personal followers — who never received
  // the Create. Mirror the create path's community-vs-personal fan-out branch.
  const preparedFanout = post.communityApId
    ? await preparePersistAndFanoutToCommunity(
        db,
        c.env,
        updateActivity,
        post.apId,
        post.communityApId,
      )
    : await preparePersistAndFanout(db, c.env, updateActivity, post.apId);

  // The edited object and its outbound Update/fanout intent are one mutation.
  // If the durable intent cannot be stored, the old content/tags stay visible
  // and the client can safely retry instead of receiving 500 after a local-only
  // edit already committed.
  await runBatch(db, [
    db
      .update(objects)
      .set(updateData)
      .where(eq(objects.apId, post.apId)) as D1Statement,
    ...preparedFanout.statements,
  ]);
  await preparedFanout.publish();

  return c.json({
    success: true,
    post: {
      ap_id: post.apId,
      content: nextContent,
      summary: nextSummary,
      updated_at: now,
    },
  });
});

// Delete post
posts.delete("/:id", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const db = c.get("db");

  const post = await db.query.objects.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
  });

  if (!post) return c.json({ error: "Post not found" }, 404);
  if (post.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const [cascade, preparedFederation] = await Promise.all([
    prepareObjectDeleteCascade(db, post.apId, c.env.MEDIA),
    prepareDeletedPostFederation({
      db,
      env: c.env,
      actorApId: actor.ap_id,
      post,
    }),
  ]);

  // Co-commit the object delete + author postCount-- + parent replyCount in ONE
  // batch (mirrors the federated handleDelete): a crash between separate
  // autocommits would otherwise leave the row gone with an un-decremented
  // postCount (permanent over-count, no recovery). postCount-- is guarded by
  // gt>0 (underflow) + EXISTS(object) so it fires exactly once; the parent
  // replyCount is RECOMPUTED from COUNT(*) after the delete — exact + idempotent.
  const objectExists = sql`EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${post.apId})`;
  const decPostCount = db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} - 1` })
    .where(
      and(eq(actors.apId, actor.ap_id), gt(actors.postCount, 0), objectExists),
    ) as D1Statement;
  const deleteObject = db
    .delete(objects)
    .where(eq(objects.apId, post.apId)) as D1Statement;
  // DM notes (`visibility="direct"`, created by createDmNote) are NOT counted in
  // postCount on send, so deleting one here must NOT decrement it — otherwise a
  // DM deleted through this generic endpoint (the dedicated DELETE
  // /dm/messages/:id correctly skips the count) under-counts the author's
  // postCount (floored at 0). Keep create/delete symmetric: only regular posts
  // (which incremented) decrement.
  const ops: D1Statement[] = [...cascade.statements];
  if (post.visibility !== "direct") ops.push(decPostCount);
  ops.push(...preparedFederation.statements);
  ops.push(deleteObject);
  if (post.inReplyTo) {
    const parentId = post.inReplyTo;
    ops.push(
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parentId})`,
        })
        .where(eq(objects.apId, parentId)) as D1Statement,
    );
  }
  await runBatch(db, ops as [D1Statement, ...D1Statement[]]);

  // Irreversible R2 purge LAST — only now that the objects row is gone. A
  // failure here degrades to a leaked blob, not a live post with a deleted blob.
  await purgeMediaBlobs(c.env.MEDIA, cascade.mediaKeys);
  await preparedFederation.complete();

  return c.json({ success: true });
});

export default posts;
