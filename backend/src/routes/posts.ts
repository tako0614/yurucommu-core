// Post-related routes (create, list, reactions, comments)

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { makeData } from "../data";
import {
  ok,
  fail,
  nowISO,
  uuid,
  HttpError,
  releaseStore,
  enqueueDeliveriesToFollowers,
  getActorUri,
  getObjectUri,
  getActivityUri,
  requireInstanceDomain,
  generateNoteObject,
  ACTIVITYSTREAMS_CONTEXT,
} from "@takos/platform/server";
import { auth } from "../middleware/auth";
import { notify } from "../lib/notifications";

const posts = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Helper: check community membership
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!communityId) return true;
  return await store.hasMembership(communityId, userId);
}

// Helper: build post payload
async function buildPostPayload(
  store: ReturnType<typeof makeData>,
  user: any,
  body: any,
  options: {
    communityId: string | null;
    allowBodyCommunityOverride: boolean;
    env: Bindings;
  }
): Promise<any> {
  const { communityId, allowBodyCommunityOverride, env } = options;
  let targetCommunityId = communityId;

  if (allowBodyCommunityOverride && body.community_id) {
    targetCommunityId = String(body.community_id);
  }

  if (targetCommunityId) {
    const community = await store.getCommunity(targetCommunityId);
    if (!community) throw new HttpError(404, "community not found");
    if (!(await requireMember(store, targetCommunityId, user.id))) {
      throw new HttpError(403, "forbidden");
    }
  }

  const type = String(body.type || "text");
  const text = String(body.text || "").trim();
  const media_urls = Array.isArray(body.media) ? body.media : [];

  if (!text && media_urls.length === 0) {
    throw new HttpError(400, "text or media is required");
  }

  const audienceInput = String(body.audience || "all");
  const audience =
    audienceInput === "community" && targetCommunityId ? "community" : "all";
  const broadcastAll = audience === "all";
  const visibleToFriends = broadcastAll
    ? body.visible_to_friends === undefined
      ? true
      : !!body.visible_to_friends
    : false;

  const id = uuid();
  const instanceDomain = requireInstanceDomain(env);
  const ap_object_id = getObjectUri(user.id, id, instanceDomain);
  const ap_activity_id = getActivityUri(user.id, `create-${id}`, instanceDomain);

  return {
    id,
    community_id: targetCommunityId,
    author_id: user.id,
    type,
    text,
    media_urls,
    created_at: nowISO(),
    pinned: 0,
    broadcast_all: broadcastAll,
    visible_to_friends: visibleToFriends,
    attributed_community_id: targetCommunityId,
    ap_object_id,
    ap_activity_id,
  };
}

async function createPostWithActivity(
  store: ReturnType<typeof makeData>,
  env: Bindings,
  user: { id: string },
  post: Awaited<ReturnType<typeof buildPostPayload>>,
): Promise<void> {
  await store.createPost(post);

  const instanceDomain = requireInstanceDomain(env);
  const protocol = "https";
  const noteObject = generateNoteObject(
    { ...post, media_json: JSON.stringify(post.media_urls) },
    { id: user.id },
    instanceDomain,
    protocol,
  );
  const actorUri = getActorUri(user.id, instanceDomain);
  const createActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Create",
    id: post.ap_activity_id,
    actor: actorUri,
    object: noteObject,
    published: new Date(post.created_at).toISOString(),
    to: noteObject.to,
    cc: noteObject.cc,
  };

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: user.id,
    activity_id: post.ap_activity_id!,
    activity_type: "Create",
    activity_json: JSON.stringify(createActivity),
    object_id: post.ap_object_id ?? null,
    object_type: "Note",
    created_at: new Date(),
  });

  await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!);
}

// POST /communities/:id/posts
posts.post("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const community_id = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    const post = await buildPostPayload(store, user, body, {
      communityId: community_id,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    await createPostWithActivity(store, c.env as Bindings, user, post);

    return ok(c, post, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create post failed", error);
    return fail(c, "failed to create post", 500);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts
posts.post("/", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const body = (await c.req.json().catch(() => ({}))) as any;
  try {
    const post = await buildPostPayload(store, user, body, {
      communityId: null,
      allowBodyCommunityOverride: false,
      env: c.env,
    });
    await createPostWithActivity(store, c.env as Bindings, user, post);

    return ok(c, post, 201);
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return fail(c, error.message, error.status);
    }
    console.error("create global post failed", error);
    return fail(c, "failed to create post", 500);
  } finally {
    await releaseStore(store);
  }
});

// GET /communities/:id/posts
posts.get("/communities/:id/posts", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const community_id = c.req.param("id");
    if (!(await store.getCommunity(community_id))) {
      return fail(c, "community not found", 404);
    }
    if (!(await requireMember(store, community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const list: any[] = await store.listPostsByCommunity(community_id);
    list.sort((a, b) =>
      (Number(b.pinned) - Number(a.pinned)) ||
      (a.created_at < b.created_at ? 1 : -1)
    );
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts
posts.get("/", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const list: any[] = await store.listGlobalPostsForUser(user.id);
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/reactions
posts.get("/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const list = await store.listReactionsByPost(post_id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /posts/:id/comments
posts.get("/:id/comments", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const list: any[] = await store.listCommentsByPost(post_id);
    list.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// GET /communities/:id/reactions-summary
posts.get("/communities/:id/reactions-summary", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const community_id = c.req.param("id");
    if (!(await store.getCommunity(community_id))) {
      return fail(c, "community not found", 404);
    }
    if (!(await requireMember(store, community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const communityPosts: any[] = await store.listPostsByCommunity(community_id);
    const allReactions: any[] = [];
    for (const post of communityPosts) {
      const reactions = await store.listReactionsByPost(post.id);
      allReactions.push(...reactions);
    }
    const grouped: Record<string, any[]> = {};
    for (const r of allReactions) {
      const key = (r as any).post_id;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }
    return ok(c, grouped);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/reactions
posts.post("/:id/reactions", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const body = await c.req.json().catch(() => ({})) as any;
    const emoji = body.emoji || "👍";

    // Generate ActivityPub URIs
    const instanceDomain = requireInstanceDomain(c.env);
    const reactionId = uuid();
    const ap_activity_id = getActivityUri(
      user.id,
      `like-${reactionId}`,
      instanceDomain,
    );

    const reaction = {
      id: reactionId,
      post_id,
      user_id: user.id,
      emoji,
      created_at: nowISO(),
      ap_activity_id,
    };

    // Generate and save Like Activity
    const postObjectId = (post as any).ap_object_id ||
      getObjectUri((post as any).author_id, post_id, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const likeActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Like",
      id: ap_activity_id,
      actor: actorUri,
      object: postObjectId,
      published: new Date(reaction.created_at).toISOString(),
      content: emoji !== "👍" ? emoji : undefined, // For emoji reactions (Misskey compat)
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: ap_activity_id,
      activity_type: "Like",
      activity_json: JSON.stringify(likeActivity),
      object_id: postObjectId,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to post author (for local inbox processing)
    if ((post as any).author_id !== user.id) {
      const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: ap_activity_id,
        target_inbox_url: postAuthorInbox,
        status: "pending",
        created_at: new Date(),
      });
    }

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id);

    // Keep notification for real-time UI updates
    if ((post as any).author_id !== user.id) {
      await notify(
        store,
        c.env as Bindings,
        (post as any).author_id,
        "like",
        user.id,
        "post",
        post_id,
        `${user.display_name} があなたの投稿にリアクションしました`,
      );
    }
    return ok(c, reaction, 201);
  } finally {
    await releaseStore(store);
  }
});

// POST /posts/:id/comments
posts.post("/:id/comments", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);
    if (!(await requireMember(store, (post as any).community_id, user.id))) {
      return fail(c, "forbidden", 403);
    }
    const body = await c.req.json().catch(() => ({})) as any;
    const text = (body.text || "").trim();
    if (!text) return fail(c, "text is required");

    // Generate ActivityPub URIs
    const instanceDomain = requireInstanceDomain(c.env);
    const commentId = uuid();
    const ap_object_id = getObjectUri(user.id, commentId, instanceDomain);
    const ap_activity_id = getActivityUri(
      user.id,
      `create-comment-${commentId}`,
      instanceDomain,
    );

    const comment = {
      id: commentId,
      post_id,
      author_id: user.id,
      text,
      created_at: nowISO(),
      ap_object_id,
      ap_activity_id,
    };

    // Generate and save Create Activity (Note with inReplyTo)
    const noteObject = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Note",
      id: ap_object_id,
      attributedTo: getActorUri(user.id, instanceDomain),
      content: `<p>${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
      published: new Date(comment.created_at).toISOString(),
      inReplyTo: (post as any).ap_object_id ||
        getObjectUri((post as any).author_id, post_id, instanceDomain),
      to: [
        (post as any).broadcast_all
          ? "https://www.w3.org/ns/activitystreams#Public"
          : getActorUri((post as any).author_id, instanceDomain),
      ],
    };

    const actorUri = getActorUri(user.id, instanceDomain);
    const createActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Create",
      id: ap_activity_id,
      actor: actorUri,
      object: noteObject,
      published: noteObject.published,
      to: noteObject.to,
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: ap_activity_id,
      activity_type: "Create",
      activity_json: JSON.stringify(createActivity),
      object_id: ap_object_id,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to post author (for local inbox processing)
    if ((post as any).author_id !== user.id) {
      const postAuthorInbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: ap_activity_id,
        target_inbox_url: postAuthorInbox,
        status: "pending",
        created_at: new Date(),
      });
    }

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, ap_activity_id);

    // Keep notification for real-time UI updates
    if ((post as any).author_id !== user.id) {
      await notify(
        store,
        c.env as Bindings,
        (post as any).author_id,
        "comment",
        user.id,
        "post",
        post_id,
        `${user.display_name} があなたの投稿にコメントしました`,
      );
    }
    return ok(c, comment, 201);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id
posts.delete("/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    // Check ownership
    if ((post as any).author_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    // Generate Delete Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const deleteActivityId = getActivityUri(user.id, `delete-${post_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const postObjectId = (post as any).ap_object_id || getObjectUri(user.id, post_id, instanceDomain);

    const deleteActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Delete",
      id: deleteActivityId,
      actor: actorUri,
      object: postObjectId,
      published: new Date().toISOString(),
    };

    // Save Delete Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: deleteActivityId,
      activity_type: "Delete",
      activity_json: JSON.stringify(deleteActivity),
      object_id: postObjectId,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, deleteActivityId);

    // Delete the post from database
    await store.deletePost(post_id);

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// PATCH /posts/:id
posts.patch("/:id", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    // Check ownership
    if ((post as any).author_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    const body = await c.req.json().catch(() => ({})) as any;
    const updateFields: Record<string, any> = {};

    if (body.text !== undefined) updateFields.text = String(body.text || "").trim();
    if (body.media !== undefined) updateFields.media_urls = Array.isArray(body.media) ? body.media : [];
    if (body.pinned !== undefined) updateFields.pinned = !!body.pinned;

    if (!updateFields.text && (!updateFields.media_urls || updateFields.media_urls.length === 0)) {
      return fail(c, "text or media is required", 400);
    }

    // Update post
    const updatedPost = await store.updatePost(post_id, updateFields);

    // Generate Update Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const updateActivityId = getActivityUri(user.id, `update-${post_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const noteObject = generateNoteObject(
      { ...updatedPost, media_json: JSON.stringify(updatedPost.media_urls || []) },
      { id: user.id },
      instanceDomain,
      "https",
    );

    const updateActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Update",
      id: updateActivityId,
      actor: actorUri,
      object: noteObject,
      published: new Date().toISOString(),
    };

    // Save Update Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: updateActivityId,
      activity_type: "Update",
      activity_json: JSON.stringify(updateActivity),
      object_id: (post as any).ap_object_id || getObjectUri(user.id, post_id, instanceDomain),
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, updateActivityId);

    return ok(c, updatedPost);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id/comments/:commentId
posts.delete("/:id/comments/:commentId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const comment_id = c.req.param("commentId");

    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    const comment = await store.getComment(comment_id);
    if (!comment) return fail(c, "comment not found", 404);
    if ((comment as any).post_id !== post_id) return fail(c, "comment does not belong to this post", 400);

    // Check ownership
    if ((comment as any).author_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    // Generate Delete Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const deleteActivityId = getActivityUri(user.id, `delete-comment-${comment_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const commentObjectId = (comment as any).ap_object_id || getObjectUri(user.id, comment_id, instanceDomain);

    const deleteActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Delete",
      id: deleteActivityId,
      actor: actorUri,
      object: commentObjectId,
      published: new Date().toISOString(),
    };

    // Save Delete Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: deleteActivityId,
      activity_type: "Delete",
      activity_json: JSON.stringify(deleteActivity),
      object_id: commentObjectId,
      object_type: "Note",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, deleteActivityId);

    // Delete the comment from database
    await store.deleteComment(comment_id);

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// DELETE /posts/:id/reactions/:reactionId
posts.delete("/:id/reactions/:reactionId", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const post_id = c.req.param("id");
    const reaction_id = c.req.param("reactionId");

    const post = await store.getPost(post_id);
    if (!post) return fail(c, "post not found", 404);

    const reaction = await store.getReaction(reaction_id);
    if (!reaction) return fail(c, "reaction not found", 404);
    if ((reaction as any).post_id !== post_id) return fail(c, "reaction does not belong to this post", 400);

    // Check ownership
    if ((reaction as any).user_id !== user.id) {
      return fail(c, "forbidden", 403);
    }

    // Generate Undo Activity
    const instanceDomain = requireInstanceDomain(c.env);
    const undoActivityId = getActivityUri(user.id, `undo-like-${reaction_id}`, instanceDomain);
    const actorUri = getActorUri(user.id, instanceDomain);
    const likeActivityId = (reaction as any).ap_activity_id || getActivityUri(user.id, `like-${reaction_id}`, instanceDomain);

    const undoActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Undo",
      id: undoActivityId,
      actor: actorUri,
      object: {
        type: "Like",
        id: likeActivityId,
        actor: actorUri,
        object: (post as any).ap_object_id || getObjectUri((post as any).author_id, post_id, instanceDomain),
      },
      published: new Date().toISOString(),
    };

    // Save Undo Activity
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: user.id,
      activity_id: undoActivityId,
      activity_type: "Undo",
      activity_json: JSON.stringify(undoActivity),
      object_id: likeActivityId,
      object_type: "Like",
      created_at: new Date(),
    });

    // Enqueue delivery to followers
    await enqueueDeliveriesToFollowers(store, user.id, undoActivityId);

    // Delete the reaction from database
    await store.deleteReaction(reaction_id);

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

export default posts;
