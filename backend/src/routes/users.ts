// User-related routes (/me, /users, /notifications, /friends)

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import {
  ok,
  fail,
  getActorUri,
  getActivityUri,
  requireInstanceDomain,
  ACTIVITYSTREAMS_CONTEXT,
  releaseStore,
} from "@takos/platform/server";
import { auth, optionalAuth } from "../middleware/auth";
import { makeData } from "../data";
import { notify } from "../lib/notifications";

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Get my profile
users.get("/me", auth, (c) => {
  console.log("[backend] /me handler", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
  });
  const user = c.get("user") as any;
  // Remove sensitive/internal fields before returning
  const { jwt_secret, tenant_id, ...publicProfile } = user;
  return ok(c, publicProfile);
});

// Get notifications
users.get("/notifications", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const list = await store.listNotifications(me.id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// Mark notification as read
users.post("/notifications/:id/read", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const id = c.req.param("id");
    await store.markNotificationRead(id);
    const count = await store.countUnreadNotifications(me.id);
    return ok(c, { id, read: true, unread_count: count });
  } finally {
    await releaseStore(store);
  }
});

// Get my communities
users.get("/me/communities", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const list = await store.listUserCommunities(user.id);
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// Get my friends
users.get("/me/friends", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const list = await store.listFriendships(me.id, "accepted");
    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// Get my friend requests
users.get("/me/friend-requests", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const url = new URL(c.req.url);
    const direction = url.searchParams.get("direction");
    const list = await store.listFriendships(me.id, "pending");
    const filtered = list.filter((edge: any) => {
      if (direction === "incoming") return edge.addressee_id === me.id;
      if (direction === "outgoing") return edge.requester_id === me.id;
      return true;
    });
    return ok(c, filtered);
  } finally {
    await releaseStore(store);
  }
});

// Get my invitations
users.get("/me/invitations", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const list: any[] = await store.listMemberInvitesForUser(me.id);
    // enrich with community info
    const commIds = Array.from(new Set(list.map((x) => (x as any).community_id)));
    const comms = await Promise.all(commIds.map((id) => store.getCommunity(id)));
    const map = new Map<string, any>();
    comms.forEach((co: any) => {
      if (co) map.set(co.id, co);
    });
    const out = list.map((x: any) => ({
      ...x,
      community: map.get(x.community_id) || null,
    }));
    return ok(c, out);
  } finally {
    await releaseStore(store);
  }
});

// Search users
users.get("/users", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const url = new URL(c.req.url);
    const raw = (url.searchParams.get("q") || "").trim();
    const q = raw.startsWith("@") ? raw.slice(1) : raw;
    if (!q) return ok(c, []);
    const users =
      (await store.searchUsers?.(q, 20)) ??
      (await store.searchUsersByName(q, 20));
    // Remove sensitive/internal fields from each user
    const sanitized = (users || []).map((u: any) => {
      const { jwt_secret, tenant_id, ...publicProfile } = u;
      return publicProfile;
    });
    return ok(c, sanitized);
  } finally {
    await releaseStore(store);
  }
});

// Fetch another user's public profile
users.get("/users/:id", optionalAuth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const rawId = c.req.param("id");

    // Normalize user ID (handle @username format)
    const normalizeUserIdParam = (input: string): string => {
      const trimmed = (input || "").trim();
      const withoutPrefix = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
      const [local] = withoutPrefix.split("@");
      return local || withoutPrefix || trimmed;
    };

    const normalizedId = normalizeUserIdParam(rawId);
    const u: any = await store.getUser(normalizedId);
    if (!u) return fail(c, "user not found", 404);

    // Accounts are private by default. For now, still return basic profile, and include friend status.
    let relation: any = null;
    if (me?.id && normalizedId !== me.id) {
      relation = await store.getFriendshipBetween(me.id, normalizedId).catch(() => null);
    }

    // Remove sensitive/internal fields before returning
    const { jwt_secret, tenant_id, ...publicProfile } = u;
    return ok(c, { ...publicProfile, friend_status: relation?.status || null });
  } finally {
    await releaseStore(store);
  }
});

// Update my profile
users.patch("/me", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const updates: Record<string, any> = {};
    const shouldMarkComplete = !user.profile_completed_at;

    if (typeof body.display_name === "string") {
      updates.display_name = String(body.display_name).slice(0, 100);
    }
    if (typeof body.avatar_url === "string") {
      updates.avatar_url = String(body.avatar_url).slice(0, 500);
    }
    if (typeof body.handle === "string") {
      const handle = String(body.handle).trim().toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(handle)) {
        return fail(c, "invalid handle", 400);
      }
      if (handle !== user.id) {
        // Note: Changing user ID (handle) is not supported due to database constraints
        // and ActivityPub actor URI stability requirements
        return fail(c, "changing user handle is not supported", 400);
      }
    } else if (body.handle !== undefined) {
      return fail(c, "invalid handle", 400);
    }

    if (shouldMarkComplete) {
      updates.profile_completed_at = new Date().toISOString();
    }

    if (!Object.keys(updates).length) {
      return fail(c, "no valid fields", 400);
    }

    await store.updateUser(user.id, updates);
    const updated: any = await store.getUser(user.id);
    // Remove sensitive/internal fields before returning
    const { jwt_secret, tenant_id, ...publicProfile } = updated;
    return ok(c, publicProfile);
  } finally {
    await releaseStore(store);
  }
});

// Register push device
users.post("/me/push-devices", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const { token, platform, device_name, locale } = body;
    if (!token || !platform) return fail(c, "token and platform required", 400);
    const device = await store.registerPushDevice({
      user_id: me.id,
      token,
      platform,
      device_name,
      locale,
    });
    return ok(c, device, 201);
  } finally {
    await releaseStore(store);
  }
});

// Unregister push device
users.delete("/me/push-devices", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const body = await c.req.json().catch(() => ({})) as any;
    const { token } = body;
    if (!token) return fail(c, "token required", 400);
    await store.removePushDevice(token);
    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

// ---- Friendships ----
// Send friend request
users.post("/users/:id/friends", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (me.id === targetId) return fail(c, "cannot friend yourself");
    const existing: any = await store
      .getFriendshipBetween(me.id, targetId)
      .catch(() => null);
    if (existing) {
      if (existing.status === "accepted") return ok(c, existing);
      if (existing.status === "pending" && existing.addressee_id === me.id) {
        const updated = await store.setFriendStatus(
          existing.requester_id,
          existing.addressee_id,
          "accepted",
        );
        await notify(
          store,
          c.env as Bindings,
          existing.requester_id,
          "friend_accepted",
          me.id,
          "user",
          me.id,
          `${me.display_name} が友達リクエストを承認しました`,
          {
            allowDefaultPushFallback: true,
            defaultPushSecret: c.env.DEFAULT_PUSH_SERVICE_SECRET || "",
          },
        );
        return ok(c, updated);
      }
      if (existing.status === "pending" && existing.requester_id === me.id) {
        return ok(c, existing);
      }
    }
    const created: any = await store.createFriendRequest(me.id, targetId);
    await notify(
      store,
      c.env as Bindings,
      targetId,
      "friend_request",
      me.id,
      "user",
      me.id,
      `${me.display_name} から友達リクエスト`,
      {
        allowDefaultPushFallback: true,
        defaultPushSecret: c.env.DEFAULT_PUSH_SERVICE_SECRET || "",
      },
    );
    return ok(c, created, 201);
  } finally {
    await releaseStore(store);
  }
});

// Accept friend request
users.post("/users/:id/friends/accept", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const requesterId = c.req.param("id");
    const rel: any = await store.getFriendRequest(requesterId, me.id);
    if (!rel || rel.status !== "pending") {
      return fail(c, "no pending request", 400);
    }
    const updated: any = await store.setFriendStatus(
      requesterId,
      me.id,
      "accepted",
    );
    await notify(
      store,
      c.env as Bindings,
      requesterId,
      "friend_accepted",
      me.id,
      "user",
      me.id,
      `${me.display_name} が友達リクエストを承認しました`,
      {
        allowDefaultPushFallback: true,
        defaultPushSecret: c.env.DEFAULT_PUSH_SERVICE_SECRET || "",
      },
    );

    // Generate and save Accept Activity for Follow
    const instanceDomain = requireInstanceDomain(c.env);
    const actorUri = getActorUri(me.id, instanceDomain);
    const requesterUri = getActorUri(requesterId, instanceDomain);

    // Find the original Follow activity ID (stored in ap_followers or friendships)
    const followRecord = await store.findApFollower(me.id, requesterUri);
    const followActivityId =
      followRecord?.activity_id ||
      followRecord?.id ||
      `${requesterUri}/follows/${me.id}`;

    const activityId = getActivityUri(
      me.id,
      `accept-follow-${requesterId}-${Date.now()}`,
      instanceDomain,
    );
    const acceptActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Accept",
      id: activityId,
      actor: actorUri,
      object: {
        type: "Follow",
        id: followActivityId,
        actor: requesterUri,
        object: actorUri,
      },
      published: new Date().toISOString(),
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: activityId,
      activity_type: "Accept",
      activity_json: JSON.stringify(acceptActivity),
      object_id: followActivityId,
      object_type: "Follow",
      created_at: new Date(),
    });

    // Enqueue delivery to requester
    const requesterActor = await store.findApActor(requesterUri);
    if (requesterActor?.inbox_url) {
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: activityId,
        target_inbox_url: requesterActor.inbox_url,
        status: "pending",
        created_at: new Date(),
      });
    }

    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

// Reject friend request
users.post("/users/:id/friends/reject", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const requesterId = c.req.param("id");
    const rel: any = await store.getFriendRequest(requesterId, me.id);
    if (!rel || rel.status !== "pending") {
      return fail(c, "no pending request", 400);
    }
    const updated: any = await store.setFriendStatus(
      requesterId,
      me.id,
      "rejected",
    );

    // Generate and save Reject Activity for Follow
    const instanceDomain = requireInstanceDomain(c.env);
    const actorUri = getActorUri(me.id, instanceDomain);
    const requesterUri = getActorUri(requesterId, instanceDomain);

    // Find the original Follow activity ID
    const followRecord = await store.findApFollower(me.id, requesterUri);
    const followActivityId =
      followRecord?.activity_id ||
      followRecord?.id ||
      `${requesterUri}/follows/${me.id}`;

    const activityId = getActivityUri(
      me.id,
      `reject-follow-${requesterId}-${Date.now()}`,
      instanceDomain,
    );
    const rejectActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Reject",
      id: activityId,
      actor: actorUri,
      object: {
        type: "Follow",
        id: followActivityId,
        actor: requesterUri,
        object: actorUri,
      },
      published: new Date().toISOString(),
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: activityId,
      activity_type: "Reject",
      activity_json: JSON.stringify(rejectActivity),
      object_id: followActivityId,
      object_type: "Follow",
      created_at: new Date(),
    });

    // Enqueue delivery to requester
    const requesterActor = await store.findApActor(requesterUri);
    if (requesterActor?.inbox_url) {
      await store.createApDeliveryQueueItem({
        id: crypto.randomUUID(),
        activity_id: activityId,
        target_inbox_url: requesterActor.inbox_url,
        status: "pending",
        created_at: new Date(),
      });
    }

    return ok(c, updated);
  } finally {
    await releaseStore(store);
  }
});

export default users;
