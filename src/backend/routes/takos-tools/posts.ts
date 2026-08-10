/**
 * Takos Tools - Post handlers
 *
 * Handles: yurucommu_create_post, yurucommu_delete_post,
 *          yurucommu_like_post, yurucommu_bookmark_post
 */

import { and, count, eq, gt, or } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { actors, bookmarks, likes, objects } from "../../../db/index.ts";
import { objectApId } from "../../federation-helpers.ts";
import {
  actorIsBlockedBy,
  canViewerReadObjectFull,
} from "../../lib/post-visibility.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../posts/delete-cascade.ts";
import {
  MAX_POST_CONTENT_LENGTH,
  normalizeVisibility,
} from "../posts/transformers.ts";
import {
  federateCreatedPost,
  federateDeletedPost,
} from "../posts/federation.ts";
import {
  insertPostAndHandleReply,
  REPLY_TARGET_NOT_FOUND,
} from "../posts/post-helpers.ts";
import {
  errAuth,
  errNotFound,
  errRequired,
  ok,
  requireString,
  togglePostRelation,
  toolLimit,
  type ToolResponse,
} from "../takos-tools-response.ts";
import type { Input, ToolContext } from "./types.ts";

// `.batch` lives only on the concrete D1/libsql subclasses; reach it through a
// narrow structural cast so the object write + postCount update commit together.
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

/**
 * Tool results expose both a full `ap_id` and a compact `post_id`, so every
 * tool mutation must accept either form. Keep the historical `/ap/notes/:id`
 * candidate too: older versions minted tool posts under that non-canonical
 * path, and their returned compact IDs must remain usable for cleanup.
 */
function toolPostWhereByIdOrApId(baseUrl: string, postId: string) {
  const normalizedBase = baseUrl.replace(/\/+$/u, "");
  return or(
    eq(objects.apId, postId),
    eq(objects.apId, objectApId(normalizedBase, postId)),
    eq(objects.apId, `${normalizedBase}/ap/notes/${postId}`),
  );
}

export async function handleCreatePost(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const content = requireString(input, "content");
  // Constrain visibility to the canonical enum (unknown → "public"), matching
  // the web post route; a raw value would be invisible to every feed filter.
  const visibility = normalizeVisibility(String(input.visibility || "public"));
  const requestedInReplyTo = input.in_reply_to
    ? String(input.in_reply_to)
    : null;
  let inReplyTo: string | null = null;
  let parentAuthor: string | null = null;

  if (!content) return c.json(errRequired("Content"), 400);
  // Enforce the same content cap as the canonical post route so this MCP path
  // can't store an oversized Note that then federates + renders everywhere.
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return c.json(
      { success: false, error: "Content too long" } as ToolResponse,
      400,
    );
  }

  // Gate a reply on the SAME read-gate + block-check the canonical web reply
  // route enforces (routes/posts/routes.ts) — not a mere existence check. Without
  // it the agent could reply to a parent it cannot read (followers-only / direct /
  // private-community), bumping that restricted parent's reply_count and exposing
  // its existence via the stored in_reply_to (a privacy oracle), or reply to a
  // parent whose author blocked the actor (block bypass + notification).
  if (requestedInReplyTo) {
    const parent = await db
      .select({
        apId: objects.apId,
        attributedTo: objects.attributedTo,
        visibility: objects.visibility,
        toJson: objects.toJson,
        ccJson: objects.ccJson,
        audienceJson: objects.audienceJson,
        communityApId: objects.communityApId,
        type: objects.type,
        endTime: objects.endTime,
      })
      .from(objects)
      .where(toolPostWhereByIdOrApId(c.env.APP_URL, requestedInReplyTo))
      .get();
    if (
      !parent ||
      !(await canViewerReadObjectFull(db, parent, actor.ap_id)) ||
      (await actorIsBlockedBy(db, parent.attributedTo, actor.ap_id))
    ) {
      return c.json(
        { success: false, error: "Reply target not found" } as ToolResponse,
        404,
      );
    }
    // Persist the resolved canonical/full AP identifier, never the compact
    // caller input, so reply traversal and counter recomputation share one key.
    inReplyTo = parent.apId;
    parentAuthor = parent.attributedTo;
  }

  const postId = crypto.randomUUID();
  const now = new Date().toISOString();
  const apId = objectApId(c.env.APP_URL.replace(/\/+$/u, ""), postId);

  try {
    parentAuthor = await insertPostAndHandleReply(db, {
      apId,
      actorApId: actor.ap_id,
      content,
      summary: null,
      attachments: undefined,
      inReplyTo,
      visibility,
      communityId: null,
      community: null,
      baseUrl: c.env.APP_URL,
      now,
    });
  } catch (error) {
    if (error instanceof Error && error.message === REPLY_TARGET_NOT_FOUND) {
      return c.json(errNotFound("Reply target"), 404);
    }
    throw error;
  }

  const { mentionFailures } = await federateCreatedPost({
    db,
    env: c.env,
    actorApId: actor.ap_id,
    objectApId: apId,
    content,
    summary: null,
    inReplyTo,
    parentAuthor,
    visibility,
    community: null,
    published: now,
  });

  return c.json(
    ok({
      post_id: postId,
      ap_id: apId,
      ...(mentionFailures.length > 0
        ? { mention_processing: { failed_count: mentionFailures.length } }
        : {}),
    }),
  );
}

export async function handleDeletePost(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const postId = requireString(input, "post_id");
  if (!postId) return c.json(errRequired("Post ID"), 400);

  const post = await db
    .select({
      apId: objects.apId,
      inReplyTo: objects.inReplyTo,
      visibility: objects.visibility,
      communityApId: objects.communityApId,
      toJson: objects.toJson,
      ccJson: objects.ccJson,
    })
    .from(objects)
    .where(
      and(
        toolPostWhereByIdOrApId(c.env.APP_URL, postId),
        eq(objects.attributedTo, actor.ap_id),
      ),
    )
    .get();
  if (!post) {
    return c.json(
      {
        success: false,
        error: "Post not found or not authorized",
      } as ToolResponse,
      404,
    );
  }

  // Match the canonical post route: explicitly reap every child/projection and
  // discover unreferenced managed media before removing the object. D1 cannot
  // rely on FK cascade semantics across runtimes.
  const mediaKeys = await deleteObjectCascade(db, post.apId, c.env.MEDIA);

  // #COUNTER-SYM: gate the decrement on the object STILL existing (correlated
  // EXISTS) and run it BEFORE the delete, so two concurrent/retried deletes of
  // the same post can't double-decrement postCount — the second batch's EXISTS
  // is false (the first already deleted the row) → its -1 matches 0 rows. gt(>0)
  // guards underflow. Mirrors the canonical web delete path (posts/routes.ts).
  const objectExists = sql`EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${post.apId})`;
  const ops: unknown[] = [];
  // Direct messages never increment postCount, so their deletion must not
  // decrement it. This keeps the tool path symmetric with canonical post/DM
  // creation and deletion.
  if (post.visibility !== "direct") {
    ops.push(
      db
        .update(actors)
        .set({ postCount: sql`${actors.postCount} - 1` })
        .where(
          and(
            eq(actors.apId, actor.ap_id),
            gt(actors.postCount, 0),
            objectExists,
          ),
        ),
    );
  }
  ops.push(db.delete(objects).where(eq(objects.apId, post.apId)));
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

  // The irreversible external delete is last: failure leaks a blob instead of
  // leaving a live post whose media has already been destroyed.
  await purgeMediaBlobs(c.env.MEDIA, mediaKeys);

  await federateDeletedPost({
    db,
    env: c.env,
    actorApId: actor.ap_id,
    post,
  });

  return c.json(ok({ deleted: true }));
}

export async function handleLikePost(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const postId = requireString(input, "post_id");
  const likeActive = Boolean(input.like);

  if (!postId) return c.json(errRequired("Post ID"), 400);

  // Read-gate the like exactly as the web route does (interactions.ts): an
  // unentitled actor who merely learns a followers-only / direct / private-
  // community post's apId must not be able to like it (which would bump
  // like_count and leak the post's existence). 404 when not readable.
  const post = await db
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
    .where(toolPostWhereByIdOrApId(c.env.APP_URL, postId))
    .get();
  // Block-gate too (the read-gate passes for any public post, so it alone does
  // not stop a blocked actor): an actor the author blocked must not bump the
  // author's like_count, mirroring the canonical like route (interactions.ts).
  if (!post) {
    return c.json(errNotFound("Post"), 404);
  }
  // Creating an interaction requires current read/moderation entitlement.
  // Removing a retained interaction stays available by id after access is
  // revoked, matching the canonical web unlike cleanup path.
  if (
    likeActive &&
    (!(await canViewerReadObjectFull(db, post, actor.ap_id)) ||
      (await actorIsBlockedBy(db, post.attributedTo, actor.ap_id)))
  ) {
    return c.json(errNotFound("Post"), 404);
  }

  // Co-commit the like-edge toggle AND the likeCount recompute in ONE atomic
  // batch (the canonical route does the same): a mid-request failure between the
  // toggle and the count UPDATE would otherwise leave likeCount diverged from the
  // likes table. The recompute is a COUNT(*) subquery so it is idempotent.
  const toggleStmt = likeActive
    ? db
        .insert(likes)
        .values({ actorApId: actor.ap_id, objectApId: post.apId })
        .onConflictDoNothing()
    : db
        .delete(likes)
        .where(
          and(
            eq(likes.actorApId, actor.ap_id),
            eq(likes.objectApId, post.apId),
          ),
        );
  await (db as unknown as Batchable).batch([
    toggleStmt,
    db
      .update(objects)
      .set({
        likeCount: sql`(SELECT COUNT(*) FROM ${likes} WHERE ${likes.objectApId} = ${post.apId})`,
      })
      .where(eq(objects.apId, post.apId)),
  ]);

  const likeCountResult = await db
    .select({ count: count() })
    .from(likes)
    .where(eq(likes.objectApId, post.apId))
    .get();
  const likeCount = likeCountResult?.count ?? 0;

  return c.json(ok({ liked: likeActive, like_count: likeCount }));
}

export async function handleBookmarkPost(
  c: ToolContext,
  input: Input,
  actor: { ap_id: string } | null,
) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get("db");
  const postId = requireString(input, "post_id");
  const bookmark = Boolean(input.bookmark);

  if (!postId) return c.json(errRequired("Post ID"), 400);

  const post = await db
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
    .where(toolPostWhereByIdOrApId(c.env.APP_URL, postId))
    .get();
  if (!post) return c.json(errNotFound("Post"), 404);

  if (
    bookmark &&
    (!(await canViewerReadObjectFull(db, post, actor.ap_id)) ||
      (await actorIsBlockedBy(db, post.attributedTo, actor.ap_id)))
  ) {
    return c.json(errNotFound("Post"), 404);
  }

  await togglePostRelation(db, bookmarks, actor.ap_id, post.apId, bookmark);

  return c.json(ok({ bookmarked: bookmark }));
}
