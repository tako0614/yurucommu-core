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
  ACTIVITYSTREAMS_CONTEXT
} from "@takos/platform/server";
import { auth } from "../middleware/auth";

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

/**
 * FCM直接配信: デバイストークンに直接プッシュ通知を送信
 */
async function dispatchFcmDirect(
  env: Bindings,
  store: ReturnType<typeof makeData>,
  user_id: string,
  notification: {
    id: string;
    type: string;
    message: string;
    actor_id: string;
    ref_type: string;
    ref_id: string;
  },
) {
  const serverKey = env.FCM_SERVER_KEY;
  if (!serverKey) {
    console.warn("FCM_SERVER_KEY not configured");
    return;
  }

  // ユーザーのデバイストークンを取得
  const devices = await store.listPushDevicesByUser(user_id);
  if (!devices || devices.length === 0) {
    console.log("no push devices registered for user", user_id);
    return;
  }

  const tokens = Array.from(new Set(devices.map((d: any) => d.token).filter((t: string) => t?.trim())));
  if (tokens.length === 0) return;

  const title = env.PUSH_NOTIFICATION_TITLE?.trim() || "通知";
  const data: Record<string, string> = {
    notification_id: notification.id,
    type: notification.type,
    ref_type: notification.ref_type,
    ref_id: notification.ref_id,
    actor_id: notification.actor_id,
  };

  const endpoint = "https://fcm.googleapis.com/fcm/send";

  // 各デバイストークンに送信
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `key=${serverKey}`,
          },
          body: JSON.stringify({
            to: token,
            notification: {
              title,
              body: notification.message || "",
            },
            data,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("FCM send failed", res.status, text);
        }
      } catch (error: unknown) {
        console.error("FCM send error", error);
      }
    }),
  );
}

// Helper: notify user
async function notify(
  store: ReturnType<typeof makeData>,
  env: Bindings,
  user_id: string,
  type: string,
  actor_id: string,
  ref_type: string,
  ref_id: string,
  message: string,
) {
  const record = {
    id: crypto.randomUUID(),
    user_id,
    type,
    actor_id,
    ref_type,
    ref_id,
    message,
    created_at: new Date(),
    read: 0,
  };
  await store.addNotification(record);

  const instanceDomain = requireInstanceDomain(env);

  // 優先順位1: カスタムFCM直接配信
  if (env.FCM_SERVER_KEY) {
    try {
      await dispatchFcmDirect(env, store, user_id, record);
    } catch (error: unknown) {
      console.error("FCM direct dispatch failed", error);
    }
    return;
  }

  // 優先順位2: カスタムPush Gateway
  const gateway = env.PUSH_GATEWAY_URL;
  const secret = env.PUSH_WEBHOOK_SECRET;
  if (gateway && secret) {
    try {
      const payload = {
        tenant: instanceDomain,
        userId: user_id,
        notification: record,
      };
      await fetch(`${gateway}/internal/push/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Push-Secret": secret,
        },
        body: JSON.stringify(payload),
      });
    } catch (error: unknown) {
      console.error("push gateway dispatch failed", error);
    }
    return;
  }

  // 優先順位3: デフォルト push service
  try {
    const pushServiceUrl = env.DEFAULT_PUSH_SERVICE_URL || "https://yurucommu.com/internal/push/events";
    const payload = {
      tenant: instanceDomain,
      userId: user_id,
      notification: record,
    };
    await fetch(pushServiceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Push-Secret": env.DEFAULT_PUSH_SERVICE_SECRET || "takos-default-push-secret",
      },
      body: JSON.stringify(payload),
    });
  } catch (error: unknown) {
    console.error("default push service dispatch failed", error);
  }
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
    await store.createPost(post);

    // Generate and save Create Activity to ap_outbox_activities
    const instanceDomain = requireInstanceDomain(c.env);
    const protocol = "https";
    const noteObject = generateNoteObject(
      { ...post, media_json: JSON.stringify(post.media_urls) },
      { id: user.id },
      instanceDomain,
      protocol
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

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!);

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
    await store.createPost(post);

    // Generate and save Create Activity to ap_outbox_activities
    const instanceDomain = requireInstanceDomain(c.env);
    const protocol = "https";
    const noteObject = generateNoteObject(
      { ...post, media_json: JSON.stringify(post.media_urls) },
      { id: user.id },
      instanceDomain,
      protocol
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

    // Enqueue delivery to followers (optimized)
    await enqueueDeliveriesToFollowers(store, user.id, post.ap_activity_id!);

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

export default posts;
