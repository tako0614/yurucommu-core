import { Hono } from "hono";
import {
  actors,
  affectedRowCount,
  follows,
  objects,
} from "../../../db/index.ts";
import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Env, Variables } from "../../types.ts";
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
  buildAddressing,
  loadCachedAuthorMap,
  loadInteractionFlags,
  persistAndFanout,
  type PostDetailRow,
  postWhereByIdOrApId,
  type PostWithAuthor,
  resolveAuthor,
  resolveAuthorWithCache,
  toPostRow,
} from "./queries.ts";
import {
  checkCommunityPostPermission,
  insertPostAndHandleReply,
  processMentions,
  REPLY_TARGET_NOT_FOUND,
  requireActor,
  validateContentEdit,
  validateCreatePostBody,
  validateEditBody,
  validateSummaryEdit,
} from "./post-helpers.ts";

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- Route handlers ---

// Create post
posts.post("/", async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const validation = await validateCreatePostBody(c);
  if (!validation.ok) {
    return c.json({
      error: validation.error,
      ...(validation.code ? { code: validation.code } : {}),
    }, 400);
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
      baseUrl,
      now,
    });
  } catch (e) {
    if (e instanceof Error && e.message === REPLY_TARGET_NOT_FOUND) {
      return c.json({ error: "Reply target not found" }, 404);
    }
    console.error("[Posts] Failed to create post transaction:", e);
    return c.json({ error: "Failed to create post" }, 500);
  }

  // Process mentions and create notifications
  const mentionFailures = await processMentions(db, {
    content,
    postApId: apId,
    actorApId: actor.ap_id,
    parentAuthor,
    baseUrl,
    now,
  });

  // Federate to followers if visibility is not direct
  if (visibility !== "direct") {
    const followersUrl = `${actor.ap_id}/followers`;
    const { to, cc } = buildAddressing(visibility, followersUrl);

    const createActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Create",
      actor: actor.ap_id,
      published: now,
      to,
      cc,
      object: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: apId,
        type: "Note",
        attributedTo: actor.ap_id,
        content,
        summary: summary || null,
        attachment: body.attachments || [],
        inReplyTo: body.in_reply_to || null,
        published: now,
        to,
        cc,
      },
    };

    await persistAndFanout(db, c.env, createActivity, apId);
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

  // Check visibility - followers-only
  if (post.visibility === "followers") {
    if (!currentActor) return c.json({ error: "Post not found" }, 404);
    if (currentActor.ap_id !== post.attributedTo) {
      const followRow = await db.select({ followerApId: follows.followerApId })
        .from(follows)
        .where(
          and(
            eq(follows.followerApId, currentActor.ap_id),
            eq(follows.followingApId, post.attributedTo),
            eq(follows.status, "accepted"),
          ),
        )
        .get();
      if (!followRow) return c.json({ error: "Post not found" }, 404);
    }
  }

  // Check visibility - direct messages
  if (post.visibility === "direct") {
    if (!currentActor) return c.json({ error: "Post not found" }, 404);
    if (currentActor.ap_id !== post.attributedTo) {
      const recipients = safeJsonParse<string[]>(post.toJson, []);
      if (!recipients.includes(currentActor.ap_id)) {
        return c.json({ error: "Post not found" }, 404);
      }
    }
  }

  const postRow: PostDetailRow = toPostRow(
    post,
    author,
    { liked, bookmarked },
  );

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

  const parentPost = await db.select({ apId: objects.apId })
    .from(objects)
    .where(postWhereByIdOrApId(baseUrl, postId)!)
    .get();

  if (!parentPost) return c.json({ error: "Post not found" }, 404);

  const whereCondition = before
    ? and(
      eq(objects.inReplyTo, parentPost.apId),
      sql`${objects.published} < ${before}`,
    )
    : eq(objects.inReplyTo, parentPost.apId);

  const replies = await db.query.objects.findMany({
    where: whereCondition,
    with: AUTHOR_WITH,
    orderBy: desc(objects.published),
    limit,
  });

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

  return c.json({ replies: result });
});

// Edit post
posts.patch("/:id", async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;

  const editValidation = await validateEditBody(c);
  if (!editValidation.ok) {
    return c.json({
      error: editValidation.error,
      ...(editValidation.code ? { code: editValidation.code } : {}),
    }, 400);
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

  const nextContent = body.content !== undefined
    ? (trimmedContent as string)
    : post.content;
  const nextSummary = body.summary !== undefined
    ? trimmedSummary || null
    : post.summary;
  const now = new Date().toISOString();

  const updateData: {
    content?: string;
    summary?: string | null;
    updated: string;
  } = { updated: now };

  if (body.content !== undefined) updateData.content = trimmedContent;
  if (body.summary !== undefined) updateData.summary = trimmedSummary || null;

  if (Object.keys(updateData).length === 1) {
    return c.json({ error: "No changes provided" }, 400);
  }

  await db.update(objects)
    .set(updateData)
    .where(eq(objects.apId, post.apId));

  const updateActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Update",
    actor: actor.ap_id,
    object: {
      id: post.apId,
      type: "Note",
      attributedTo: actor.ap_id,
      content: nextContent,
      summary: nextSummary,
      updated: now,
    },
  };

  await persistAndFanout(db, c.env, updateActivity, post.apId);

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
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

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

  // D1 doesn't support interactive transactions; use sequential operations
  await db.delete(objects).where(eq(objects.apId, post.apId));

  await db.update(actors)
    .set({ postCount: sql`${actors.postCount} - 1` })
    .where(eq(actors.apId, actor.ap_id));

  let parentUpdated = true;
  if (post.inReplyTo) {
    const result = await db.update(objects)
      .set({ replyCount: sql`${objects.replyCount} - 1` })
      .where(
        and(eq(objects.apId, post.inReplyTo), sql`${objects.replyCount} > 0`),
      );
    parentUpdated = affectedRowCount(result) > 0;
  }

  if (post.inReplyTo && !parentUpdated) {
    console.warn(
      "[Posts] Failed to decrement parent reply count (parent may not exist)",
    );
  }

  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Delete",
    actor: actor.ap_id,
    object: post.apId,
  };

  await persistAndFanout(db, c.env, deleteActivity, post.apId);

  return c.json({ success: true });
});

export default posts;
