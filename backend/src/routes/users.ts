// User-related routes (/me, /users, /notifications, /friends)

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import { auth, optionalAuth } from "../middleware/auth";
import { makeData } from "../data";

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// Get my profile
users.get("/me", auth, (c) => {
  console.log("[backend] /me handler", {
    path: new URL(c.req.url).pathname,
    method: c.req.method,
  });
  const user = c.get("user");
  return ok(c, user);
});

// Get notifications
users.get("/notifications", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const list = await store.listNotifications(me.id);
  return ok(c, list);
});

// Mark notification as read
users.post("/notifications/:id/read", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const id = c.req.param("id");
  await store.markNotificationRead(id);
  const count = await store.countUnreadNotifications(me.id);
  return ok(c, { id, read: true, unread_count: count });
});

// Get my communities
users.get("/me/communities", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const list = await store.listUserCommunities(user.id);
  return ok(c, list);
});

// Get my friends
users.get("/me/friends", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const me = c.get("user") as any;
  const list = await store.listFriendships(me.id, "accepted");
  return ok(c, list);
});

// Get my friend requests
users.get("/me/friend-requests", auth, async (c) => {
  const store = makeData(c.env as any, c);
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
});

// Get my invitations
users.get("/me/invitations", auth, async (c) => {
  const store = makeData(c.env as any, c);
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
});

// Search users
users.get("/users", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const url = new URL(c.req.url);
  const raw = (url.searchParams.get("q") || "").trim();
  const q = raw.startsWith("@") ? raw.slice(1) : raw;
  if (!q) return ok(c, []);
  const users =
    (await store.searchUsers?.(q, 20)) ??
    (await store.searchUsersByName(q, 20));
  return ok(c, users || []);
});

// Fetch another user's public profile
users.get("/users/:id", optionalAuth, async (c) => {
  const store = makeData(c.env as any, c);
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
  return ok(c, { ...u, friend_status: relation?.status || null });
});

// Update my profile
users.patch("/me", auth, async (c) => {
  const store = makeData(c.env as any, c);
  const user = c.get("user") as any;
  const body = await c.req.json().catch(() => ({})) as any;
  const updates: Record<string, any> = {};
  let newHandle: string | null = null;
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
      const existing = await store.getUser(handle);
      if (existing) {
        return fail(c, "handle already taken", 409);
      }
      newHandle = handle;
    }
  } else if (body.handle !== undefined) {
    return fail(c, "invalid handle", 400);
  }

  if (shouldMarkComplete) {
    updates.profile_completed_at = new Date().toISOString();
  }

  if (!Object.keys(updates).length && !newHandle) {
    return fail(c, "no valid fields", 400);
  }

  if (newHandle) {
    await store.updateUserId(user.id, newHandle);
  }
  if (Object.keys(updates).length > 0) {
    await store.updateUser(newHandle || user.id, updates);
  }

  const updated = await store.getUser(newHandle || user.id);
  return ok(c, updated);
});

// Register push device
users.post("/me/push-devices", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const { token, platform } = body;
    if (!token || !platform) return fail(c, "token and platform required", 400);
    const existing = await store.findPushDevice(token);
    if (existing) {
      await store.updatePushDevice(existing.id, { user_id: me.id, updated_at: new Date() });
      return ok(c, existing);
    }
    const device = await store.createPushDevice({
      id: crypto.randomUUID(),
      user_id: me.id,
      token,
      platform,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return ok(c, device, 201);
  } finally {
    // Note: store is not released here; caller should handle
  }
});

// Unregister push device
users.delete("/me/push-devices", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const me = c.get("user") as any;
    const body = await c.req.json().catch(() => ({})) as any;
    const { token } = body;
    if (!token) return fail(c, "token required", 400);
    const device = await store.findPushDevice(token);
    if (!device) return ok(c, { deleted: false });
    if (device.user_id !== me.id) return fail(c, "forbidden", 403);
    await store.deletePushDevice(device.id);
    return ok(c, { deleted: true });
  } finally {
    // Note: store is not released here; caller should handle
  }
});

export default users;
