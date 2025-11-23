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

export default users;
