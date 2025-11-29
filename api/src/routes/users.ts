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
  webfingerLookup,
  getOrFetchActor,
  processSingleInboxActivity,
  queueImmediateDelivery,
} from "@takos/platform/server";
import { auth, optionalAuth } from "../middleware/auth";
import { makeData } from "../data";
import { notify } from "../lib/notifications";

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

export function parseActorToUserId(actorUri: string, instanceDomain: string): string {
  try {
    const urlObj = new URL(actorUri);
    const normalizedDomain = instanceDomain.trim().toLowerCase();
    const host = urlObj.host.toLowerCase();
    const hostname = urlObj.hostname.toLowerCase();
    const isLocal =
      host === normalizedDomain ||
      hostname === normalizedDomain;

    if (isLocal) {
      const match = urlObj.pathname.match(/\/ap\/users\/([a-z0-9_]{3,20})\/?$/);
      if (match) return match[1];
    }

    const segments = urlObj.pathname.split("/").filter(Boolean);
    const handle = segments[segments.length - 1] || actorUri.split("/").pop() || "unknown";
    return `@${handle}@${urlObj.host || urlObj.hostname}`;
  } catch {
    return actorUri;
  }
}

function sanitizeUser(user: any) {
  if (!user) return null;
  const { jwt_secret, tenant_id, ...publicProfile } = user;
  return publicProfile;
}

function parseUserIdParam(input: string): { local: string; domain?: string } {
  const trimmed = (input || "").trim();
  const withoutPrefix = trimmed.replace(/^@+/, "");
  const parts = withoutPrefix.split("@");
  const local = (parts.shift() || "").trim();
  const domain = parts.length ? parts.join("@").trim() : undefined;
  return { local, domain: domain || undefined };
}

// Get my profile
users.get("/me", auth, async (c) => {
  console.log("[backend] /me handler", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
  });
  const user = c.get("user") as any;
  const store = makeData(c.env as any, c);
  try {
    const pinned_posts = await store.listPinnedPostsByUser?.(user.id, 5);
    // Remove sensitive/internal fields before returning
    const { jwt_secret, tenant_id, ...publicProfile } = user;
    return ok(c, { ...publicProfile, pinned_posts: pinned_posts ?? [] });
  } finally {
    await releaseStore(store);
  }
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

// Get my friends (ActivityPub based)
users.get("/me/friends", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const instanceDomain = requireInstanceDomain(c.env);

    // Get both followers and follows with accepted status
    const followers = await store.listApFollowers(me.id, "accepted", 1000);
    const following = await store.listApFollows(me.id, "accepted", 1000);

    // Convert to user IDs
    const followerIds = new Set(
      followers.map((f: any) => parseActorToUserId(f.remote_actor_id, instanceDomain)),
    );
    const followingIds = new Set(
      following.map((f: any) => parseActorToUserId(f.remote_actor_id, instanceDomain)),
    );

    // Friends are mutual follows
    const friendIds = [...followerIds].filter((id) => followingIds.has(id));

    // Fetch user details for each friend
    const friends = await Promise.all(
      friendIds.map(async (userId) => {
        const user = await store.getUser(userId).catch(() => null);
        const baseProfile = user
          ? (() => {
              const { jwt_secret, tenant_id, ...publicProfile } = user;
              return publicProfile;
            })()
          : { id: userId, display_name: userId };
        return {
          requester_id: userId,
          addressee_id: me.id,
          status: "accepted",
          requester: baseProfile,
          addressee: { id: me.id, display_name: me.display_name },
        };
      }),
    );

    return ok(c, friends.filter(Boolean));
  } finally {
    await releaseStore(store);
  }
});

// Get who I'm following
users.get("/me/following", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const url = new URL(c.req.url);
    const statusParam = (url.searchParams.get("status") || "").toLowerCase();
    const statusFilter =
      statusParam === "pending" ? "pending" : statusParam === "all" ? null : "accepted";
    const instanceDomain = requireInstanceDomain(c.env);

    const followerSet = new Set(
      (await store.listApFollowers(me.id, "accepted", 1000)).map(
        (f: any) => f.remote_actor_id,
      ),
    );
    const following = await store.listApFollows(me.id, statusFilter, 1000);

    const list = await Promise.all(
      following.map(async (f: any) => {
        const userId = parseActorToUserId(f.remote_actor_id, instanceDomain);
        const profile =
          sanitizeUser(await store.getUser(userId).catch(() => null)) ||
          ({ id: userId, display_name: userId } as any);
        const followsBack = followerSet.has(f.remote_actor_id);
        const isFriend = followsBack && f.status === "accepted";
        return {
          user: profile,
          status: f.status || "pending",
          follows_back: followsBack,
          is_friend: isFriend,
        };
      }),
    );

    return ok(c, list.filter(Boolean));
  } finally {
    await releaseStore(store);
  }
});

// Get my followers
users.get("/me/followers", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const url = new URL(c.req.url);
    const statusParam = (url.searchParams.get("status") || "").toLowerCase();
    const statusFilter =
      statusParam === "pending" ? "pending" : statusParam === "all" ? null : "accepted";
    const instanceDomain = requireInstanceDomain(c.env);

    const followingSet = new Set(
      (await store.listApFollows(me.id, "accepted", 1000)).map(
        (f: any) => f.remote_actor_id,
      ),
    );
    const followers = await store.listApFollowers(me.id, statusFilter, 1000);

    const list = await Promise.all(
      followers.map(async (f: any) => {
        const userId = parseActorToUserId(f.remote_actor_id, instanceDomain);
        const profile =
          sanitizeUser(await store.getUser(userId).catch(() => null)) ||
          ({ id: userId, display_name: userId } as any);
        const iFollow = followingSet.has(f.remote_actor_id);
        const isFriend = iFollow && f.status === "accepted";
        return {
          user: profile,
          status: f.status || "pending",
          follows_back: iFollow,
          is_friend: isFriend,
        };
      }),
    );

    return ok(c, list.filter(Boolean));
  } finally {
    await releaseStore(store);
  }
});

// Get my follow requests (ActivityPub based)
users.get("/me/follow-requests", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const url = new URL(c.req.url);
    const direction = url.searchParams.get("direction");
    const instanceDomain = requireInstanceDomain(c.env);

    let list: any[] = [];

    if (direction === "incoming" || !direction) {
      // Incoming: people who sent us follow requests (ap_followers with status=pending)
      const followers = await store.listApFollowers(me.id, "pending", 100);
      const incoming = await Promise.all(
        followers.map(async (f: any) => {
          const requesterId = parseActorToUserId(f.remote_actor_id, instanceDomain);
          const requester = await store.getUser(requesterId).catch(() => null);
          const requesterProfile = requester
            ? (() => {
                const { jwt_secret, tenant_id, ...publicProfile } = requester;
                return publicProfile;
              })()
            : { id: requesterId, display_name: requesterId };
          return {
            requester_id: requesterId,
            addressee_id: me.id,
            status: "pending",
            requester: requesterProfile,
            addressee: { id: me.id, display_name: me.display_name },
            created_at: new Date(),
          };
        }),
      );
      list = [...list, ...incoming.filter(Boolean)];
    }

    if (direction === "outgoing" || !direction) {
      // Outgoing: people we sent follow requests to (ap_follows with status=pending)
      const following = await store.listApFollows(me.id, "pending", 100);
      const outgoing = await Promise.all(
        following.map(async (f: any) => {
          const addresseeId = parseActorToUserId(f.remote_actor_id, instanceDomain);
          const addressee = await store.getUser(addresseeId).catch(() => null);
          const addresseeProfile = addressee
            ? (() => {
                const { jwt_secret, tenant_id, ...publicProfile } = addressee;
                return publicProfile;
              })()
            : { id: addresseeId, display_name: addresseeId };
          return {
            requester_id: me.id,
            addressee_id: addresseeId,
            status: "pending",
            requester: { id: me.id, display_name: me.display_name },
            addressee: addresseeProfile,
            created_at: new Date(),
          };
        }),
      );
      list = [...list, ...outgoing.filter(Boolean)];
    }

    return ok(c, list);
  } finally {
    await releaseStore(store);
  }
});

// Block list
users.get("/me/blocks", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const list = await store.listBlockedUsers(me.id);
    const sanitized = (list || []).map((entry: any) => {
      const user = entry.user || {};
      const { jwt_secret, tenant_id, ...publicProfile } = user;
      return {
        blocked_id: entry.blocked_id,
        created_at: entry.created_at,
        user: user.id ? publicProfile : null,
      };
    });
    return ok(c, sanitized);
  } finally {
    await releaseStore(store);
  }
});

// Mute list
users.get("/me/mutes", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const list = await store.listMutedUsers(me.id);
    const sanitized = (list || []).map((entry: any) => {
      const user = entry.user || {};
      const { jwt_secret, tenant_id, ...publicProfile } = user;
      return {
        muted_id: entry.muted_id,
        created_at: entry.created_at,
        user: user.id ? publicProfile : null,
      };
    });
    return ok(c, sanitized);
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

    const instanceDomain = requireInstanceDomain(c.env);
    const fetcher = fetch;
    const seen = new Set<string>();
    const results: any[] = [];

    const pushUnique = (profile: any) => {
      const keyParts = [
        (profile.id || profile.handle || "").toLowerCase(),
        (profile.domain || "").toLowerCase(),
      ];
      const key = keyParts.filter(Boolean).join("@");
      if (!key || seen.has(key)) return;
      seen.add(key);
      results.push(profile);
    };

    const users =
      (await store.searchUsers?.(q, 20)) ??
      (await store.searchUsersByName(q, 20));
    for (const u of users || []) {
      const { jwt_secret, tenant_id, ...publicProfile } = u as any;
      pushUnique(publicProfile);
    }

    // If query looks like a remote account, try WebFinger
    if (q.includes("@")) {
      const account = q.replace(/^@+/, "");
      const actorUri = await webfingerLookup(account, fetcher).catch(() => null);
      if (actorUri) {
        const actor = await getOrFetchActor(actorUri, c.env as any, false, fetcher).catch(
          () => null,
        );
        if (actor) {
          const avatar =
            (Array.isArray(actor.icon) ? actor.icon.find((i: any) => i?.url)?.url : undefined) ||
            (actor.icon && typeof actor.icon === "object" ? (actor.icon as any).url : undefined) ||
            null;
          const parts = account.split("@");
          const handle = (parts.shift() || account).trim();
          const domain = parts.join("@").trim() || instanceDomain;
          pushUnique({
            id: handle,
            handle,
            domain,
            actor_id: actor.id,
            display_name: actor.name || actor.preferredUsername || handle,
            avatar_url: avatar,
            url: (actor as any).url || actor.id,
          });
        }
      }
    }

    return ok(c, results);
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

    console.log(`[GET /users/:id] rawId="${rawId}", me=${me?.id || "anonymous"}`);

    // Normalize user ID (@user or @user@domain) without enforcing domain
    const parseUserIdParam = (input: string): { local: string; domain?: string } => {
      const trimmed = (input || "").trim();
      const withoutPrefix = trimmed.replace(/^@+/, "");
      const parts = withoutPrefix.split("@");
      const local = (parts.shift() || "").trim();
      const domain = parts.length ? parts.join("@").trim() : undefined;
      return { local, domain: domain || undefined };
    };

    const { local: normalizedId, domain: requestedDomain } = parseUserIdParam(rawId);
    const instanceDomain = requireInstanceDomain(c.env);

    if (!normalizedId) {
      console.error(`[GET /users/:id] Invalid user ID: rawId="${rawId}"`);
      return fail(c, "invalid user id", 400);
    }

    // Domain check: determine if this is a local or remote user
    const isLocalDomain = requestedDomain ? requestedDomain === instanceDomain : true;

    console.log(`[GET /users/:id] normalizedId="${normalizedId}", requestedDomain="${requestedDomain || "none"}", instanceDomain="${instanceDomain}", isLocalDomain=${isLocalDomain}`);

    if (isLocalDomain) {
      // LOCAL DOMAIN: Search in database
      console.log(`[GET /users/:id] Local domain - searching database`);

      const u: any = await store.getUser(normalizedId);
      console.log(`[GET /users/:id] Local user lookup result: ${u ? `found (id=${u.id})` : "not found"}`);

      if (!u) {
        console.error(`[GET /users/:id] User not found in local domain`);
        return fail(c, "user not found", 404);
      }
      if (me?.id && normalizedId !== me.id) {
        const blocked = await store.isBlocked?.(me.id, normalizedId).catch(() => false);
        const blocking = await store.isBlocked?.(normalizedId, me.id).catch(() => false);
        if (blocked || blocking) {
          return fail(c, "forbidden", 403);
        }
      }

      // Return local user profile
      let relation: any = null;
      let relationship: any = null;
      if (me?.id && normalizedId !== me.id) {
        const targetActorUri = getActorUri(normalizedId, instanceDomain);
        console.log(`[GET /users/:id] Checking relationship: me=${me.id}, target=${normalizedId}, targetActorUri=${targetActorUri}`);
        const [followingRecord, followerRecord] = await Promise.all([
          store.findApFollow(me.id, targetActorUri).catch((err) => {
            console.error(`[GET /users/:id] findApFollow error:`, err);
            return null;
          }),
          store.findApFollower(me.id, targetActorUri).catch((err) => {
            console.error(`[GET /users/:id] findApFollower error:`, err);
            return null;
          }),
        ]);
        console.log(`[GET /users/:id] followingRecord:`, followingRecord, `followerRecord:`, followerRecord);
        const followingStatus = followingRecord?.status || null;
        const followedByStatus = followerRecord?.status || null;
        const isFriend =
          followingStatus === "accepted" && followedByStatus === "accepted";

        if (isFriend) {
          relation = { status: "accepted" };
        }
        relationship = {
          following: followingStatus,
          followed_by: followedByStatus,
          is_friend: isFriend,
        };
        console.log(`[GET /users/:id] Final relationship:`, relationship);
      }

      const publicProfile = sanitizeUser(u) as any;
      const pinned_posts = await store.listPinnedPostsByUser?.(u.id, 5);
      return ok(c, {
        ...publicProfile,
        domain: instanceDomain || publicProfile.domain || undefined,
        friend_status: relation?.status || null,
        relationship,
        pinned_posts: pinned_posts ?? [],
      });
    } else {
      // REMOTE DOMAIN: Fetch via ActivityPub
      const account = `${normalizedId}@${requestedDomain}`;
      console.log(`[GET /users/:id] Remote domain - fetching via ActivityPub: "${account}"`);

      const fetcher = fetch;
      const actorUri = await webfingerLookup(account, fetcher);
      console.log(`[GET /users/:id] WebFinger result: ${actorUri ? `found actorUri="${actorUri}"` : "not found"}`);

      if (!actorUri) {
        console.error(`[GET /users/:id] WebFinger lookup failed`);
        return fail(c, "user not found", 404);
      }

      console.log(`[GET /users/:id] Fetching remote actor from actorUri="${actorUri}"`);
      const actor = await getOrFetchActor(actorUri, c.env as any, false, fetcher);
      console.log(`[GET /users/:id] Remote actor result: ${actor ? `success` : "failed"}`);

      if (!actor) {
        console.error(`[GET /users/:id] Failed to fetch remote actor`);
        return fail(c, "user not found", 404);
      }

      const avatar =
        (Array.isArray(actor.icon) ? actor.icon.find((i: any) => i?.url)?.url : undefined) ||
        (actor.icon && typeof actor.icon === "object" ? (actor.icon as any).url : undefined) ||
        null;

      if (me?.id) {
        const remoteBlockKey = `@${normalizedId}@${requestedDomain}`;
        const blocked = await store.isBlocked?.(me.id, remoteBlockKey).catch(() => false);
        if (blocked) {
          return fail(c, "forbidden", 403);
        }
      }

      let followingStatus: string | null = null;
      let followedByStatus: string | null = null;
      let isFriend = false;

      if (me?.id) {
        const [followingRecord, followerRecord] = await Promise.all([
          store.findApFollow(me.id, actor.id).catch(() => null),
          store.findApFollower(me.id, actor.id).catch(() => null),
        ]);
        followingStatus = followingRecord?.status || null;
        followedByStatus = followerRecord?.status || null;
        isFriend = followingStatus === "accepted" && followedByStatus === "accepted";
      }

      console.log(`[GET /users/:id] Returning remote user profile`);

      return ok(c, {
        id: normalizedId,
        handle: normalizedId,
        domain: requestedDomain,
        actor_id: actor.id,
        display_name: actor.name || actor.preferredUsername || normalizedId,
        avatar_url: avatar,
        url: (actor as any).url || actor.id,
        friend_status: isFriend ? "accepted" : null,
        relationship: {
          following: followingStatus,
          followed_by: followedByStatus,
          is_friend: isFriend,
        },
      });
    }
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

// Block a user
users.post("/users/:id/block", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (!targetId || targetId === me.id) return fail(c, "invalid target", 400);

    const instanceDomain = requireInstanceDomain(c.env);
    const fetcher = fetch;
    const { local: normalizedId, domain: requestedDomain } = parseUserIdParam(targetId);
    if (!normalizedId) return fail(c, "invalid target", 400);

    const isRemote =
      requestedDomain && requestedDomain.toLowerCase() !== instanceDomain.toLowerCase();

    let blockKey = normalizedId;
    let targetActorUri: string | null = null;

    if (isRemote) {
      const fullHandle = `${normalizedId}@${requestedDomain}`;
      const actorUri = await webfingerLookup(fullHandle, fetcher);
      if (!actorUri) return fail(c, "could not resolve remote user", 404);
      blockKey = `@${normalizedId}@${requestedDomain}`;
      targetActorUri = actorUri;
    } else {
      const target = await store.getUser(normalizedId);
      if (!target) return fail(c, "user not found", 404);
      targetActorUri = getActorUri(normalizedId, instanceDomain);
    }

    await store.blockUser(me.id, blockKey);
    await store.unmuteUser?.(me.id, blockKey);

    if (targetActorUri) {
      await Promise.all([
        store.deleteApFollowers(me.id, targetActorUri).catch(() => {}),
        store.deleteApFollows?.(me.id, targetActorUri).catch(() => {}),
      ]);
    }

    return ok(c, { blocked: true, blocked_id: blockKey });
  } finally {
    await releaseStore(store);
  }
});

// Unblock a user
users.delete("/users/:id/block", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (!targetId || targetId === me.id) return fail(c, "invalid target", 400);

    const instanceDomain = requireInstanceDomain(c.env);
    const { local: normalizedId, domain: requestedDomain } = parseUserIdParam(targetId);
    if (!normalizedId) return fail(c, "invalid target", 400);

    const isRemote =
      requestedDomain && requestedDomain.toLowerCase() !== instanceDomain.toLowerCase();
    const blockKey = isRemote ? `@${normalizedId}@${requestedDomain}` : normalizedId;

    await store.unblockUser(me.id, blockKey);
    return ok(c, { blocked: false });
  } finally {
    await releaseStore(store);
  }
});

// Mute a user
users.post("/users/:id/mute", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (!targetId || targetId === me.id) return fail(c, "invalid target", 400);

    const instanceDomain = requireInstanceDomain(c.env);
    const fetcher = fetch;
    const { local: normalizedId, domain: requestedDomain } = parseUserIdParam(targetId);
    if (!normalizedId) return fail(c, "invalid target", 400);

    const isRemote =
      requestedDomain && requestedDomain.toLowerCase() !== instanceDomain.toLowerCase();
    let muteKey = normalizedId;

    if (isRemote) {
      const fullHandle = `${normalizedId}@${requestedDomain}`;
      const actorUri = await webfingerLookup(fullHandle, fetcher);
      if (!actorUri) return fail(c, "could not resolve remote user", 404);
      muteKey = `@${normalizedId}@${requestedDomain}`;
    } else {
      const target = await store.getUser(normalizedId);
      if (!target) return fail(c, "user not found", 404);
    }

    await store.muteUser(me.id, muteKey);
    return ok(c, { muted: true, muted_id: muteKey });
  } finally {
    await releaseStore(store);
  }
});

// Unmute a user
users.delete("/users/:id/mute", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (!targetId || targetId === me.id) return fail(c, "invalid target", 400);

    const instanceDomain = requireInstanceDomain(c.env);
    const { local: normalizedId, domain: requestedDomain } = parseUserIdParam(targetId);
    if (!normalizedId) return fail(c, "invalid target", 400);

    const isRemote =
      requestedDomain && requestedDomain.toLowerCase() !== instanceDomain.toLowerCase();
    const muteKey = isRemote ? `@${normalizedId}@${requestedDomain}` : normalizedId;

    await store.unmuteUser(me.id, muteKey);
    return ok(c, { muted: false });
  } finally {
    await releaseStore(store);
  }
});

// ---- Friends (ActivityPub Follow-based) ----

async function createFollowRequest(
  store: ReturnType<typeof makeData>,
  c: any,
  me: any,
  targetId: string,
  instanceDomain: string,
) {
  const myActorUri = getActorUri(me.id, instanceDomain);
  const targetActorUri = getActorUri(targetId, instanceDomain);

  const existingFollow: any = await store.findApFollow(me.id, targetActorUri).catch(() => null);

  if (existingFollow?.status === "accepted") {
    return {
      data: {
        requester_id: me.id,
        addressee_id: targetId,
        status: "accepted",
        created_at: existingFollow.created_at,
      },
      status: 200,
    };
  }

  const existingFollower: any = await store.findApFollower(me.id, targetActorUri).catch(() => null);

  if (existingFollower?.status === "pending") {
    await store.updateApFollowersStatus(me.id, targetActorUri, "accepted", new Date());

    const followRecord = existingFollower;
    const followActivityId = followRecord?.activity_id || `${targetActorUri}/follows/${me.id}`;
    const acceptActivityId = getActivityUri(
      me.id,
      `accept-follow-${targetId}-${Date.now()}`,
      instanceDomain,
    );

    const acceptActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Accept",
      id: acceptActivityId,
      actor: myActorUri,
      object: {
        type: "Follow",
        id: followActivityId,
        actor: targetActorUri,
        object: myActorUri,
      },
      published: new Date().toISOString(),
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: acceptActivityId,
      activity_type: "Accept",
      activity_json: JSON.stringify(acceptActivity),
      object_id: followActivityId,
      object_type: "Follow",
      created_at: new Date(),
    });

    const inboxResult = await store.createApInboxActivity({
      local_user_id: targetId,
      remote_actor_id: myActorUri,
      activity_id: acceptActivityId,
      activity_type: "Accept",
      activity_json: JSON.stringify(acceptActivity),
      status: "pending",
      created_at: new Date(),
    });
    try {
      if (inboxResult?.id) {
        await processSingleInboxActivity(store, c.env as any, inboxResult.id);
      }
    } catch (error) {
      console.error("Failed to process local Accept inbox activity", error);
    }

    await notify(
      store,
      c.env as Bindings,
      targetId,
      "follow_accepted",
      me.id,
      "user",
      me.id,
      `${me.display_name} がフォローを承認しました`,
      {
        allowDefaultPushFallback: true,
        defaultPushSecret: c.env.DEFAULT_PUSH_SERVICE_SECRET || "",
      },
    );

    return {
      data: {
        requester_id: me.id,
        addressee_id: targetId,
        status: "accepted",
        created_at: new Date(),
      },
      status: 200,
    };
  }

  const followActivityId = getActivityUri(
    me.id,
    `follow-${targetId}-${Date.now()}`,
    instanceDomain,
  );

  const followActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Follow",
    id: followActivityId,
    actor: myActorUri,
    object: targetActorUri,
    published: new Date().toISOString(),
  };

  await store.upsertApFollow({
    local_user_id: me.id,
    remote_actor_id: targetActorUri,
    activity_id: followActivityId,
    status: "pending",
    created_at: new Date(),
    accepted_at: null,
  });

  await store.upsertApOutboxActivity({
    id: crypto.randomUUID(),
    local_user_id: me.id,
    activity_id: followActivityId,
    activity_type: "Follow",
    activity_json: JSON.stringify(followActivity),
    object_id: targetActorUri,
    object_type: "Person",
    created_at: new Date(),
  });

  const inboxResult = await store.createApInboxActivity({
    local_user_id: targetId,
    remote_actor_id: myActorUri,
    activity_id: followActivityId,
    activity_type: "Follow",
    activity_json: JSON.stringify(followActivity),
    status: "pending",
    created_at: new Date(),
  });
  try {
    if (inboxResult?.id) {
      await processSingleInboxActivity(store, c.env as any, inboxResult.id);
    }
  } catch (error) {
    console.error("Failed to process local Follow inbox activity", error);
  }

  try {
    await notify(
      store,
      c.env as Bindings,
      targetId,
      "follow_request",
      me.id,
      "user",
      me.id,
      `${me.display_name} からフォローリクエスト`,
      {
        allowDefaultPushFallback: true,
        defaultPushSecret: c.env.DEFAULT_PUSH_SERVICE_SECRET || "",
      },
    );
  } catch (error) {
    console.error("Failed to create follow request notification", error);
  }

  return {
    data: {
      requester_id: me.id,
      addressee_id: targetId,
      status: "pending",
      created_at: new Date(),
    },
    status: 201,
  };
}

// Follow a user (primary follow endpoint)
users.post("/users/:id/follow", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (me.id === targetId) return fail(c, "cannot follow yourself");

    const instanceDomain = requireInstanceDomain(c.env);
    const fetcher = fetch;
    const isRemoteUser = targetId.startsWith("@") && targetId.split("@").length === 3;

    if (isRemoteUser) {
      const [, handle, domainRaw] = targetId.split("@");
      const domain = domainRaw?.toLowerCase() ?? "";
      const isLocalDomain = domain === instanceDomain.toLowerCase();

      if (!isLocalDomain) {
        const fullHandle = `${handle}@${domain}`;
        const actorUri = await webfingerLookup(fullHandle, fetcher);
        if (!actorUri) {
          return fail(c, "could not resolve remote user", 404);
        }

        const remoteActor = await getOrFetchActor(actorUri, c.env as any, false, fetcher);
        if (!remoteActor) {
          return fail(c, "could not resolve remote user", 404);
        }

        const existingFollow = await store.findApFollow(me.id, remoteActor.id).catch(() => null);
        if (existingFollow?.status === "accepted") {
          return ok(c, {
            requester_id: me.id,
            addressee_id: targetId,
            status: "accepted",
            created_at: existingFollow.created_at,
          });
        }
        if (existingFollow?.status === "pending") {
          return ok(c, {
            requester_id: me.id,
            addressee_id: targetId,
            status: "pending",
            created_at: existingFollow.created_at,
          });
        }

        const myActorUri = getActorUri(me.id, instanceDomain);
        const followActivityId = getActivityUri(
          me.id,
          `follow-${handle}-${Date.now()}`,
          instanceDomain,
        );

        const followActivity = {
          "@context": ACTIVITYSTREAMS_CONTEXT,
          type: "Follow",
          id: followActivityId,
          actor: myActorUri,
          object: remoteActor.id,
          published: new Date().toISOString(),
        };

        await store.upsertApFollow({
          local_user_id: me.id,
          remote_actor_id: remoteActor.id,
          activity_id: followActivityId,
          status: "pending",
          created_at: new Date(),
          accepted_at: null,
        });

        await store.upsertApOutboxActivity({
          id: crypto.randomUUID(),
          local_user_id: me.id,
          activity_id: followActivityId,
          activity_type: "Follow",
          activity_json: JSON.stringify(followActivity),
          object_id: remoteActor.id,
          object_type: "Person",
          created_at: new Date(),
        });

        const inboxUrl = remoteActor.inbox || (remoteActor.endpoints as any)?.sharedInbox;
        if (inboxUrl) {
          await queueImmediateDelivery(store, c.env as any, {
            activity_id: followActivityId,
            target_inbox_url: inboxUrl,
            status: "pending",
          });
        }

        return ok(
          c,
          {
            requester_id: me.id,
            addressee_id: targetId,
            status: "pending",
            created_at: new Date(),
          },
          201,
        );
      }

      // Local domain with @handle@domain format - treat as local user
      const targetUser = await store.getUser(handle).catch(() => null);
      if (!targetUser) {
        return fail(c, "user not found", 404);
      }

      const { data, status } = await createFollowRequest(store, c, me, handle, instanceDomain);
      return ok(c, data, status);
    }

    const targetUser = await store.getUser(targetId).catch(() => null);
    if (!targetUser) {
      return fail(c, "user not found", 404);
    }

    const { data, status } = await createFollowRequest(store, c, me, targetId, instanceDomain);
    return ok(c, data, status);
  } finally {
    await releaseStore(store);
  }
});

// Unfollow a user
users.delete("/users/:id/follow", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const targetId = c.req.param("id");
    if (!targetId || me.id === targetId) return fail(c, "invalid target", 400);

    const instanceDomain = requireInstanceDomain(c.env);
    const myActorUri = getActorUri(me.id, instanceDomain);
    const fetcher = fetch;

    const isRemoteUser = targetId.startsWith("@") && targetId.split("@").length === 3;
    let targetActorUri: string;
    let localTargetId: string | null = null;

    if (isRemoteUser) {
      const [, handle, domain] = targetId.split("@");
      if (domain?.toLowerCase() === instanceDomain.toLowerCase()) {
        localTargetId = handle;
        targetActorUri = getActorUri(handle, instanceDomain);
      } else {
        const lookup = await webfingerLookup(`${handle}@${domain}`, fetcher);
        if (!lookup) return fail(c, "could not resolve remote user", 400);
        targetActorUri = lookup;
      }
    } else {
      localTargetId = targetId;
      targetActorUri = getActorUri(targetId, instanceDomain);
    }

    const followRecord = await store.findApFollow(me.id, targetActorUri).catch(() => null);
    if (followRecord) {
      await store.deleteApFollows(me.id, targetActorUri);
    }

    const followActivityId =
      followRecord?.activity_id || `${targetActorUri}/follows/${me.id}`;
    const undoActivityId = getActivityUri(
      me.id,
      `undo-follow-${targetId.replace(/@/g, "_")}-${Date.now()}`,
      instanceDomain,
    );

    const undoActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Undo",
      id: undoActivityId,
      actor: myActorUri,
      object: {
        type: "Follow",
        id: followActivityId,
        actor: myActorUri,
        object: targetActorUri,
      },
      published: new Date().toISOString(),
    };

    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: undoActivityId,
      activity_type: "Undo",
      activity_json: JSON.stringify(undoActivity),
      object_id: followActivityId,
      object_type: "Follow",
      created_at: new Date(),
    });

    if (localTargetId) {
      const inboxResult = await store.createApInboxActivity({
        local_user_id: localTargetId,
        remote_actor_id: myActorUri,
        activity_id: undoActivityId,
        activity_type: "Undo",
        activity_json: JSON.stringify(undoActivity),
        status: "pending",
        created_at: new Date(),
      });
      try {
        if (inboxResult?.id) {
          await processSingleInboxActivity(store, c.env as any, inboxResult.id);
        }
      } catch (error) {
        console.error("Failed to process local Undo inbox activity", error);
      }
    } else {
      const remoteActor = await getOrFetchActor(targetActorUri, c.env as any, false, fetcher);
      if (remoteActor?.inbox) {
        await queueImmediateDelivery(store, c.env as any, {
          activity_id: undoActivityId,
          target_inbox_url: remoteActor.inbox,
          status: "pending",
        });
      }
    }

    return ok(c, { unfollowed: true, target: targetId });
  } finally {
    await releaseStore(store);
  }
});

// Accept follow request
users.post("/users/:id/follow/accept", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const requesterId = c.req.param("id");

    const instanceDomain = requireInstanceDomain(c.env);
    const myActorUri = getActorUri(me.id, instanceDomain);
    const fetcher = fetch;

    // Check if requester is a remote user (format: @handle@domain)
    const isRemoteUser = requesterId.startsWith("@") && requesterId.split("@").length === 3;
    let requesterUri: string | null = null;
    let isLocal = true;

    if (isRemoteUser) {
      // Remote user - resolve via WebFinger
      const parts = requesterId.slice(1).split("@"); // Remove leading @
      const remoteHandle = parts[0].toLowerCase();
      const remoteDomain = parts[1].toLowerCase();
      isLocal = remoteDomain === instanceDomain.toLowerCase();

      if (isLocal) {
        // Actually a local user with full handle format
        requesterUri = getActorUri(remoteHandle, instanceDomain);
      } else {
        // True remote user - lookup via WebFinger
        const lookupResult = await webfingerLookup(`${remoteHandle}@${remoteDomain}`, fetcher);
        if (lookupResult) {
          requesterUri = lookupResult;
        } else {
          const cachedActor = await store.findApActorByHandleAndDomain(remoteHandle, remoteDomain);
          if (!cachedActor) {
            return fail(c, "could not resolve remote user", 400);
          }
          requesterUri = cachedActor.id;
        }
      }
    } else {
      // Local user
      requesterUri = getActorUri(requesterId, instanceDomain);
    }

    if (!requesterUri) {
      return fail(c, "could not resolve remote user", 400);
    }

    // Find the Follow request in ap_followers
    const followRecord = await store.findApFollower(me.id, requesterUri);
    if (!followRecord || followRecord.status !== "pending") {
      return fail(c, "no pending request", 400);
    }

    // Update status to accepted
    await store.updateApFollowersStatus(
      me.id,
      requesterUri,
      "accepted",
      new Date(),
    );

    // Also create a follow from me to requester (mutual follow)
    const myFollowActivityId = getActivityUri(
      me.id,
      `follow-${requesterId.replace(/@/g, "_")}-${Date.now()}`,
      instanceDomain,
    );

    const myFollowActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Follow",
      id: myFollowActivityId,
      actor: myActorUri,
      object: requesterUri,
      published: new Date().toISOString(),
    };

    // Store in ap_follows (immediately accepted since we're accepting their request)
    await store.upsertApFollow({
      local_user_id: me.id,
      remote_actor_id: requesterUri,
      activity_id: myFollowActivityId,
      status: "accepted",
      created_at: new Date(),
      accepted_at: new Date(),
    });

    // Store in outbox
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: myFollowActivityId,
      activity_type: "Follow",
      activity_json: JSON.stringify(myFollowActivity),
      object_id: requesterUri,
      object_type: "Person",
      created_at: new Date(),
    });

    // Deliver the Follow activity
    if (isLocal) {
      const localRequesterId = isRemoteUser
        ? requesterId.slice(1).split("@")[0]
        : requesterId;
      const followInboxResult = await store.createApInboxActivity({
        local_user_id: localRequesterId,
        remote_actor_id: myActorUri,
        activity_id: myFollowActivityId,
        activity_type: "Follow",
        activity_json: JSON.stringify(myFollowActivity),
        status: "pending",
        created_at: new Date(),
      });
      // Process immediately
      try {
        if (followInboxResult?.id) {
          await processSingleInboxActivity(store, c.env as any, followInboxResult.id);
        }
      } catch (error) {
        console.error("Failed to process local Follow inbox activity", error);
      }
    }

    // Generate Accept Activity
    const followActivityId = followRecord.activity_id || `${requesterUri}/follows/${me.id}`;
    const acceptActivityId = getActivityUri(
      me.id,
      `accept-follow-${requesterId.replace(/@/g, "_")}-${Date.now()}`,
      instanceDomain,
    );

    const acceptActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Accept",
      id: acceptActivityId,
      actor: myActorUri,
      object: {
        type: "Follow",
        id: followActivityId,
        actor: requesterUri,
        object: myActorUri,
      },
      published: new Date().toISOString(),
    };

    // Store in outbox
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: acceptActivityId,
      activity_type: "Accept",
      activity_json: JSON.stringify(acceptActivity),
      object_id: followActivityId,
      object_type: "Follow",
      created_at: new Date(),
    });

    if (isLocal) {
      // Local user - deliver via inbox
      const localRequesterId = isRemoteUser
        ? requesterId.slice(1).split("@")[0] // Extract handle from @handle@domain
        : requesterId;
      const inboxResult = await store.createApInboxActivity({
        local_user_id: localRequesterId,
        remote_actor_id: myActorUri,
        activity_id: acceptActivityId,
        activity_type: "Accept",
        activity_json: JSON.stringify(acceptActivity),
        status: "pending",
        created_at: new Date(),
      });
      // Process immediately so the sender sees the accepted state without the scheduled worker
      try {
        if (inboxResult?.id) {
          await processSingleInboxActivity(store, c.env as any, inboxResult.id);
        }
      } catch (error) {
        console.error("Failed to process local Accept inbox activity", error);
      }

      await notify(
        store,
        c.env as Bindings,
        localRequesterId,
        "follow_accepted",
        me.id,
        "user",
        me.id,
        `${me.display_name} がフォローを承認しました`,
        {
          allowDefaultPushFallback: true,
          defaultPushSecret: c.env.DEFAULT_PUSH_SERVICE_SECRET || "",
        },
      );
    } else {
      // Remote user - fetch actor to get inbox and deliver via HTTP
      const remoteActor = await getOrFetchActor(requesterUri, c.env as any, false, fetcher);
      if (remoteActor?.inbox) {
        const deliveryId = await queueImmediateDelivery(store, c.env as any, {
          activity_id: acceptActivityId,
          target_inbox_url: remoteActor.inbox,
          status: "pending",
        });
        if (deliveryId) {
          console.log(`✓ Queued and attempted immediate Accept delivery to ${remoteActor.inbox}`);
        }
      } else {
        console.warn(`Could not find inbox for remote actor ${requesterUri}`);
      }
    }

    return ok(c, {
      requester_id: requesterId,
      addressee_id: me.id,
      status: "accepted",
      created_at: new Date(),
    });
  } finally {
    await releaseStore(store);
  }
});

// Reject follow request
users.post("/users/:id/follow/reject", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const requesterId = c.req.param("id");

    const instanceDomain = requireInstanceDomain(c.env);
    const myActorUri = getActorUri(me.id, instanceDomain);
    const fetcher = fetch;

    // Check if requester is a remote user (format: @handle@domain)
    const isRemoteUser = requesterId.startsWith("@") && requesterId.split("@").length === 3;
    let requesterUri: string | null = null;
    let isLocal = true;

    if (isRemoteUser) {
      // Remote user - resolve via WebFinger
      const parts = requesterId.slice(1).split("@"); // Remove leading @
      const remoteHandle = parts[0].toLowerCase();
      const remoteDomain = parts[1].toLowerCase();
      isLocal = remoteDomain === instanceDomain.toLowerCase();

      if (isLocal) {
        // Actually a local user with full handle format
        requesterUri = getActorUri(remoteHandle, instanceDomain);
      } else {
        // True remote user - lookup via WebFinger
        const lookupResult = await webfingerLookup(`${remoteHandle}@${remoteDomain}`, fetcher);
        if (lookupResult) {
          requesterUri = lookupResult;
        } else {
          const cachedActor = await store.findApActorByHandleAndDomain(remoteHandle, remoteDomain);
          if (!cachedActor) {
            return fail(c, "could not resolve remote user", 400);
          }
          requesterUri = cachedActor.id;
        }
      }
    } else {
      // Local user
      requesterUri = getActorUri(requesterId, instanceDomain);
    }

    if (!requesterUri) {
      return fail(c, "could not resolve remote user", 400);
    }

    // Find the Follow request in ap_followers
    const followRecord = await store.findApFollower(me.id, requesterUri);
    if (!followRecord || followRecord.status !== "pending") {
      return fail(c, "no pending request", 400);
    }

    // Update status to rejected
    await store.updateApFollowersStatus(
      me.id,
      requesterUri,
      "rejected",
      new Date(),
    );

    // Generate Reject Activity
    const followActivityId = followRecord.activity_id || `${requesterUri}/follows/${me.id}`;
    const rejectActivityId = getActivityUri(
      me.id,
      `reject-follow-${requesterId.replace(/@/g, "_")}-${Date.now()}`,
      instanceDomain,
    );

    const rejectActivity = {
      "@context": ACTIVITYSTREAMS_CONTEXT,
      type: "Reject",
      id: rejectActivityId,
      actor: myActorUri,
      object: {
        type: "Follow",
        id: followActivityId,
        actor: requesterUri,
        object: myActorUri,
      },
      published: new Date().toISOString(),
    };

    // Store in outbox
    await store.upsertApOutboxActivity({
      id: crypto.randomUUID(),
      local_user_id: me.id,
      activity_id: rejectActivityId,
      activity_type: "Reject",
      activity_json: JSON.stringify(rejectActivity),
      object_id: followActivityId,
      object_type: "Follow",
      created_at: new Date(),
    });

    if (isLocal) {
      // Local user - deliver via inbox
      const localRequesterId = isRemoteUser
        ? requesterId.slice(1).split("@")[0] // Extract handle from @handle@domain
        : requesterId;
      const inboxResult = await store.createApInboxActivity({
        local_user_id: localRequesterId,
        remote_actor_id: myActorUri,
        activity_id: rejectActivityId,
        activity_type: "Reject",
        activity_json: JSON.stringify(rejectActivity),
        status: "pending",
        created_at: new Date(),
      });
      // Process immediately so the requester sees the rejected state without waiting
      try {
        if (inboxResult?.id) {
          await processSingleInboxActivity(store, c.env as any, inboxResult.id);
        }
      } catch (error) {
        console.error("Failed to process local Reject inbox activity", error);
      }
    } else {
      // Remote user - fetch actor to get inbox and deliver via HTTP
      const remoteActor = await getOrFetchActor(requesterUri, c.env as any, false, fetcher);
      if (remoteActor?.inbox) {
        const deliveryId = await queueImmediateDelivery(store, c.env as any, {
          activity_id: rejectActivityId,
          target_inbox_url: remoteActor.inbox,
          status: "pending",
        });
        if (deliveryId) {
          console.log(`✓ Queued and attempted immediate Reject delivery to ${remoteActor.inbox}`);
        }
      } else {
        console.warn(`Could not find inbox for remote actor ${requesterUri}`);
      }
    }

    return ok(c, {
      requester_id: requesterId,
      addressee_id: me.id,
      status: "rejected",
      created_at: new Date(),
    });
  } finally {
    await releaseStore(store);
  }
});

// GET /users/:id/pinned - Get user's pinned posts
users.get("/users/:id/pinned", optionalAuth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const rawId = c.req.param("id");
    const limit = Math.min(20, Math.max(1, parseInt(c.req.query("limit") || "10", 10)));
    const instanceDomain = requireInstanceDomain(c.env);
    const fetcher = fetch;
    const { local: userId, domain: requestedDomain } = parseUserIdParam(rawId);

    if (!userId) return fail(c, "invalid user id", 400);

    const isRemote =
      requestedDomain && requestedDomain.toLowerCase() !== instanceDomain.toLowerCase();

    // Check for blocks
    const me = c.get("user") as any;
    if (me?.id && userId !== me.id) {
      const blockKey = isRemote ? `@${userId}@${requestedDomain}` : userId;
      const blocked = await store.isBlocked?.(me.id, blockKey).catch(() => false);
      const blocking = await store.isBlocked?.(blockKey, me.id).catch(() => false);
      if (blocked || blocking) {
        return fail(c, "forbidden", 403);
      }
    }

    if (isRemote) {
      // Remote user: resolve actor to validate, but we don't store remote pinned posts yet.
      const account = `${userId}@${requestedDomain}`;
      const actorUri = await webfingerLookup(account, fetcher);
      if (!actorUri) return fail(c, "user not found", 404);
      const actor = await getOrFetchActor(actorUri, c.env as any, false, fetcher);
      if (!actor) return fail(c, "user not found", 404);
      return ok(c, []);
    }

    // Local user
    const user = await store.getUser(userId);
    if (!user) return fail(c, "user not found", 404);

    const pinned_posts = await store.listPinnedPostsByUser?.(userId, limit);
    return ok(c, pinned_posts || []);
  } finally {
    await releaseStore(store);
  }
});

export default users;
