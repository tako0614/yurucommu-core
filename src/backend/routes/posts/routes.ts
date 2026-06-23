import { Hono } from "hono";
import { actors, follows, objects } from "../../../db/index.ts";
import type { Database } from "../../../db/index.ts";
import { OBJECT_CONTEXT } from "../../lib/ap-context.ts";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Actor, Env, Variables } from "../../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
  isSafeRemoteUrl,
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
  buildAddressing,
  buildCommunityObjectAddressing,
  loadCachedAuthorMap,
  loadInteractionFlags,
  mergeCc,
  persistActivity,
  persistAndFanout,
  persistAndFanoutToCommunity,
  type PostDetailRow,
  postWhereByIdOrApId,
  type PostWithAuthor,
  resolveAuthor,
  resolveAuthorWithCache,
  toPostRow,
} from "./queries.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import { deleteObjectCascade, purgeMediaBlobs } from "./delete-cascade.ts";
import {
  checkCommunityPostPermission,
  deriveContentTags,
  insertPostAndHandleReply,
  processMentions,
  REPLY_TARGET_NOT_FOUND,
  validateContentEdit,
  validateCreatePostBody,
  validateEditBody,
  validateSummaryEdit,
} from "./post-helpers.ts";
import { requireActor } from "../actors-helpers.ts";
import { communityReadableApIds } from "../../lib/community-visibility.ts";
import { encodeFeedCursor, feedCursorWhere } from "../../lib/feed-cursor.ts";
import {
  actorIsBlockedBy,
  canViewerReadObjectFull,
} from "../../lib/post-visibility.ts";
import { toApAttachments } from "../../lib/activitypub-helpers.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "posts.routes" });

// `.batch` lives only on the concrete D1/libsql subclasses, not the Database
// union; reach it through a narrow structural cast (matching the other routes).
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

const PUBLIC_COLLECTION = "https://www.w3.org/ns/activitystreams#Public";

/** Reply row shape needed for the visibility gate (subset of the object row). */
type ReplyVisibilityRow = {
  apId: string;
  attributedTo: string;
  visibility: string;
  toJson?: string | null;
  audienceJson?: string | null;
  communityApId?: string | null;
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
    if (reply.visibility === "followers") {
      if (!viewerApId) return false;
      if (reply.attributedTo === viewerApId) return true;
      return acceptedFollowing.has(reply.attributedTo);
    }
    if (reply.visibility === "direct") {
      if (!viewerApId) return false;
      if (reply.attributedTo === viewerApId) return true;
      const recipients = safeJsonParse<string[]>(reply.toJson, []);
      return recipients.includes(viewerApId);
    }
    return true;
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
  if (body.in_reply_to) {
    const parent = await db
      .select({
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
  }

  const baseUrl = c.env.APP_URL;
  const postId = generateId();
  const apId = objectApId(baseUrl, postId);
  const now = new Date().toISOString();

  let parentAuthor: string | null = null;
  try {
    parentAuthor = await insertPostAndHandleReply(db, {
      apId,
      actorApId: actor.ap_id,
      content,
      summary: summary || null,
      attachments: body.attachments,
      inReplyTo: body.in_reply_to || null,
      visibility,
      communityId,
      community,
      baseUrl,
      now,
    });
  } catch (e) {
    if (e instanceof Error && e.message === REPLY_TARGET_NOT_FOUND) {
      return c.json({ error: "Reply target not found" }, 404);
    }
    log.error("Failed to create post transaction", {
      event: "posts.create.transaction_failed",
      actor: actor.ap_id,
      communityId,
      error: e,
    });
    return c.json({ error: "Failed to create post" }, 500);
  }

  // Process mentions: resolve @mentions (local + remote), build `Mention`
  // tags, create local notifications, and collect the resolved recipient IRIs.
  const {
    failures: mentionFailures,
    tags: mentionTags,
    mentionedActorApIds,
    remoteMentionedActorApIds,
  } = await processMentions(db, {
    content,
    postApId: apId,
    actorApId: actor.ap_id,
    parentAuthor,
    baseUrl,
    now,
  });

  // A reply must reach the post it replies to. processMentions only addresses
  // actors EXPLICITLY @-mentioned in the body, so a reply to a remote post that
  // doesn't manually @-mention its author was delivered to the replier's own
  // followers but NEVER to the upstream instance — it never landed in the
  // original thread (whereas Like/Undo-repost already reach the remote object
  // author). Auto-address the parent author of a NON-direct reply: add it to cc
  // and a `Mention` tag (so the reply threads + notifies on the receiving
  // server) and, when remote, deliver the Create to its inbox. Direct replies
  // keep mentions-only addressing (no implicit parent disclosure). The local
  // parent author is already notified by the reply path, so this only augments
  // addressing/delivery, never a duplicate local notification.
  const replyRecipients = [...mentionedActorApIds];
  const replyRemoteRecipients = [...remoteMentionedActorApIds];
  const replyTags = [...mentionTags];
  if (
    body.in_reply_to &&
    parentAuthor &&
    parentAuthor !== actor.ap_id &&
    visibility !== "direct" &&
    !replyRecipients.includes(parentAuthor)
  ) {
    replyRecipients.push(parentAuthor);
    replyTags.push({
      type: "Mention",
      href: parentAuthor,
      name: `@${formatUsername(parentAuthor)}`,
    });
    if (!isLocal(parentAuthor, baseUrl)) {
      replyRemoteRecipients.push(parentAuthor);
    }
  }

  // Federate when the post has follower/public/community reach OR when it has
  // resolved mentions (a mention is an explicit recipient, so even a "direct"
  // post must federate the Create to its remote mentioned actors).
  //
  // Community-scoped posts have reach == community: address the Create toward
  // the community Group actor + its followers collection (NOT the author's
  // personal followers), record the community in `audience`, and fan out to
  // the community's members/followers. Non-community posts keep the existing
  // author-follower addressing and fan-out. Mentioned actors are always added
  // to `cc` so the post is addressed to them on the receiving server.
  if (visibility !== "direct" || mentionedActorApIds.length > 0) {
    let to: string[];
    let cc: string[];
    let audience: string[] | undefined;

    if (visibility === "direct") {
      // Direct post with mentions: no follower/public reach, only the
      // mentioned actors are recipients.
      to = [];
      cc = [];
    } else if (community) {
      const objectAddressing = buildCommunityObjectAddressing(
        visibility,
        community,
      );
      to = objectAddressing.to;
      cc = objectAddressing.cc;
      audience = objectAddressing.audience;
    } else {
      const followersUrl = `${actor.ap_id}/followers`;
      ({ to, cc } = buildAddressing(visibility, followersUrl));
    }

    // Add every mentioned actor IRI — plus an auto-addressed reply parent — to
    // cc (de-duplicated).
    cc = mergeCc(cc, replyRecipients);

    const tag = replyTags.length > 0 ? replyTags : undefined;

    const createActivity = {
      "@context": OBJECT_CONTEXT,
      id: activityApId(baseUrl, generateId()),
      type: "Create",
      actor: actor.ap_id,
      published: now,
      to,
      cc,
      ...(audience ? { audience } : {}),
      ...(tag ? { tag } : {}),
      object: {
        "@context": OBJECT_CONTEXT,
        id: apId,
        type: "Note",
        attributedTo: actor.ap_id,
        content,
        summary: summary || null,
        // A non-empty summary is a content warning; Mastodon-compatible peers
        // gate rendering on BOTH `summary` (the CW text) and `sensitive`. The
        // served object doc (routes/activitypub/outbox.ts) already sets this, so
        // the delivered Create must match or the CW federates inconsistently.
        ...(summary ? { sensitive: true } : {}),
        // Media is stored as an app-relative /media path; absolutize for the
        // federated copy so remote servers can fetch the image.
        attachment: toApAttachments(body.attachments || [], baseUrl),
        inReplyTo: body.in_reply_to || null,
        published: now,
        to,
        cc,
        ...(audience ? { audience } : {}),
        ...(tag ? { tag } : {}),
      },
    };

    if (visibility === "direct") {
      // No follower/community fanout for a direct post — persist only, then
      // direct-deliver to the remote mentioned actors below.
      await persistActivity(db, createActivity, apId);
    } else if (community) {
      await persistAndFanoutToCommunity(
        db,
        c.env,
        createActivity,
        apId,
        community.apId,
      );
    } else {
      await persistAndFanout(db, c.env, createActivity, apId);
    }

    // Deliver the Create directly to each remote mentioned actor's inbox — plus
    // the remote parent author of a reply (auto-addressed above). Community/
    // follower fanout does not include arbitrary remote actors, so this is the
    // only path that reaches a remote @user@domain mention or reply target.
    for (const recipient of replyRemoteRecipients) {
      try {
        await enqueueDeliveryToActor(c.env, createActivity.id, recipient);
      } catch (err) {
        log.error("Failed to enqueue mention delivery", {
          event: "posts.mention.delivery_enqueue_failed",
          activityId: createActivity.id,
          recipient,
          error: err,
        });
      }
    }
  }

  const createdPost = {
    ap_id: apId,
    type: "Note",
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
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
    .where(postWhereByIdOrApId(baseUrl, postId)!)
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
  const scanned = await db.query.objects.findMany({
    where: cursorPredicate
      ? and(eq(objects.inReplyTo, parentPost.apId), cursorPredicate)
      : eq(objects.inReplyTo, parentPost.apId),
    with: AUTHOR_WITH,
    orderBy: [desc(objects.published), desc(objects.apId)],
    limit: limit + 1,
  });
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
  const [cachedAuthorMap, { likedIds }] = await Promise.all([
    loadCachedAuthorMap(db, replies as PostWithAuthor[]),
    loadInteractionFlags(db, currentActor?.ap_id, replyApIds),
  ]);

  const result = replies.map((reply) => {
    const author = resolveAuthor(
      reply.author,
      reply.attributedTo,
      cachedAuthorMap,
    );
    const postRow = toPostRow(reply as PostWithAuthor, author, {
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

  await db.update(objects).set(updateData).where(eq(objects.apId, post.apId));

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
      ...(nextTags.length > 0 ? { tag: nextTags } : {}),
      to: updateTo,
      cc: updateCc,
      ...(updateAudience.length > 0 ? { audience: updateAudience } : {}),
      updated: now,
    },
  };

  // A community-scoped post's Update must reach the COMMUNITY (the members who
  // got the Create), NOT the author's personal followers — who never received
  // the Create. Mirror the create path's community-vs-personal fan-out branch.
  if (post.communityApId) {
    await persistAndFanoutToCommunity(
      db,
      c.env,
      updateActivity,
      post.apId,
      post.communityApId,
    );
  } else {
    await persistAndFanout(db, c.env, updateActivity, post.apId);
  }

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

  // D1 doesn't support interactive transactions; use sequential operations.
  // FK ON DELETE CASCADE is not reliably enforced (PRAGMA foreign_keys is not
  // guaranteed on every runtime/connection, and D1 ignores it), so delete the
  // object's child rows explicitly before the object row to avoid orphans.
  const mediaKeys = await deleteObjectCascade(db, post.apId, c.env.MEDIA);

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
    );
  const deleteObject = db.delete(objects).where(eq(objects.apId, post.apId));
  // DM notes (`visibility="direct"`, created by createDmNote) are NOT counted in
  // postCount on send, so deleting one here must NOT decrement it — otherwise a
  // DM deleted through this generic endpoint (the dedicated DELETE
  // /dm/messages/:id correctly skips the count) under-counts the author's
  // postCount (floored at 0). Keep create/delete symmetric: only regular posts
  // (which incremented) decrement.
  const ops: unknown[] = [];
  if (post.visibility !== "direct") ops.push(decPostCount);
  ops.push(deleteObject);
  if (post.inReplyTo) {
    const parentId = post.inReplyTo;
    ops.push(
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parentId})`,
        })
        .where(eq(objects.apId, parentId)),
    );
  }
  await (db as unknown as Batchable).batch(ops);

  // Irreversible R2 purge LAST — only now that the objects row is gone. A
  // failure here degrades to a leaked blob, not a live post with a deleted blob.
  await purgeMediaBlobs(c.env.MEDIA, mediaKeys);

  // The Delete must reach everyone the original object reached, not just the
  // author's current followers: mirror the object's stored to/cc, and emit a
  // Tombstone object (per AP) instead of a bare IRI so receivers can render
  // the deletion correctly.
  const originalTo = safeJsonParse<string[]>(post.toJson, []);
  const originalCc = safeJsonParse<string[]>(post.ccJson, []);

  // For a reply, the parent author's instance must also be told (it counts the
  // reply); for a direct post, the DM recipients are exactly the addressed
  // actors. Collect explicit (actor-IRI) recipients for direct per-actor
  // delivery — anything that is not a Public/collection IRI is treated as an
  // actor inbox target if it is a safe remote URL.
  const explicitRecipients = new Set<string>();
  for (const iri of [...originalTo, ...originalCc]) {
    if (
      iri &&
      iri !== PUBLIC_COLLECTION &&
      !iri.endsWith("/followers") &&
      isLocal(iri, baseUrl) === false &&
      isSafeRemoteUrl(iri)
    ) {
      explicitRecipients.add(iri);
    }
  }

  // Parent author's instance (replies): ensure the reply deletion propagates
  // to the thread root's host even if it was not in the object's to/cc.
  if (post.inReplyTo) {
    const parent = await db
      .select({ attributedTo: objects.attributedTo })
      .from(objects)
      .where(eq(objects.apId, post.inReplyTo))
      .get();
    if (
      parent?.attributedTo &&
      !isLocal(parent.attributedTo, baseUrl) &&
      isSafeRemoteUrl(parent.attributedTo)
    ) {
      explicitRecipients.add(parent.attributedTo);
    }
  }

  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Delete",
    actor: actor.ap_id,
    to: originalTo,
    cc: originalCc,
    object: {
      id: post.apId,
      type: "Tombstone",
    },
  };

  // Fan out matching the original create reach (community → the community, not
  // the author's personal followers) and additionally deliver directly to each
  // explicitly-addressed remote actor.
  if (post.communityApId) {
    await persistAndFanoutToCommunity(
      db,
      c.env,
      deleteActivity,
      post.apId,
      post.communityApId,
    );
  } else {
    await persistAndFanout(db, c.env, deleteActivity, post.apId);
  }

  for (const recipient of explicitRecipients) {
    try {
      await enqueueDeliveryToActor(c.env, deleteActivity.id, recipient);
    } catch (err) {
      log.error("Failed to enqueue delete delivery", {
        event: "posts.delete.delivery_enqueue_failed",
        activityId: deleteActivity.id,
        recipient,
        error: err,
      });
    }
  }

  return c.json({ success: true });
});

export default posts;
