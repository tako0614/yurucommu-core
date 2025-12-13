// User-related routes backed by UserService / NotificationService
// Block/Mute operations are delegated to Default App (App layer)

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail, HttpError } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth, optionalAuth } from "../middleware/auth";
import { getAppAuthContext } from "../lib/auth-context";
import { ErrorCodes } from "../lib/error-codes";
import {
  createNotificationService,
  createPostService,
  createUserService,
} from "../services";
import { buildTakosAppEnv, loadStoredAppManifest, loadTakosApp } from "../lib/app-sdk-loader";

// Helper to proxy requests to Default App for Block/Mute operations
const proxyToDefaultApp = async (c: any, pathname: string, options?: RequestInit): Promise<Response> => {
  const appId = "default";
  const app = await loadTakosApp(appId, c.env);
  const manifest = await loadStoredAppManifest(c.env, appId);
  const appEnv = buildTakosAppEnv(c, appId, manifest);
  const url = new URL(c.req.url);
  url.pathname = pathname;
  const req = new Request(url.toString(), {
    method: options?.method ?? c.req.method,
    headers: options?.headers ?? c.req.raw.headers,
    body: options?.body,
  });
  return await app.fetch(req, appEnv);
};

const users = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const parsePagination = (url: URL, defaults = { limit: 20, offset: 0 }) => {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || `${defaults.offset}`, 10));
  return { limit, offset };
};

const ensureAuth = (ctx: AppAuthContext): AppAuthContext => {
  if (!ctx.userId) throw new HttpError(401, ErrorCodes.UNAUTHORIZED, "Authentication required");
  return ctx;
};

const handleError = (_c: any, error: unknown): never => {
  if (error instanceof HttpError) throw error;
  throw error;
};

const readJson = async (res: Response): Promise<any> => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const proxyToDefaultApp = async (
  c: any,
  pathname: string,
  search: string = "",
): Promise<Response> => {
  const appId = "default";
  const app = await loadTakosApp(appId, c.env);
  const manifest = await loadStoredAppManifest(c.env, appId);
  const appEnv = buildTakosAppEnv(c, appId, manifest);

  const url = new URL(c.req.url);
  url.pathname = pathname;
  url.search = search;
  const req = new Request(url.toString(), c.req.raw);
  return await app.fetch(req, appEnv);
};

export function parseActorToUserId(actorUri: string, instanceDomain: string): string {
  const url = new URL(actorUri);
  const hostname = url.hostname;
  const host = url.host;
  const localDomain = instanceDomain.split(":")[0] || instanceDomain;
  const isLocal = host === instanceDomain || hostname === localDomain;

  const match = url.pathname.match(/\/ap\/users\/([^/]+)(?:\/|$)/);
  const handle = match?.[1] || url.pathname.split("/").filter(Boolean).pop() || "unknown";

  if (isLocal) return handle;
  return `@${handle}@${hostname}`;
}

// Get my profile
users.get("/me", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const userService = createUserService(c.env);
    const postService = createPostService(c.env);
    const me = await userService.getUser(authCtx, authCtx.userId!);
    const pinned_posts = await postService
      .listPinnedPosts(authCtx, { user_id: authCtx.userId!, limit: 5 })
      .catch(() => []);
    return ok(c, { ...me, pinned_posts: pinned_posts ?? [] });
  } catch (error) {
    return handleError(c, error);
  }
});

// Get notifications
users.get("/notifications", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const list = await service.listNotifications(authCtx, {});
    return ok(c, list);
  } catch (error) {
    return handleError(c, error);
  }
});

// Mark notification as read
users.post("/notifications/:id/read", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const result = await service.markNotificationRead(authCtx, c.req.param("id"));
    return ok(c, result);
  } catch (error) {
    return handleError(c, error);
  }
});

// Get my communities
users.get("/me/communities", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(c, "/me/communities");
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to list communities", res.status);
    return ok(c, json?.communities ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

// Get my friends (mutual follows)
users.get("/me/friends", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const following = await service.listFollowing(authCtx, { limit: 100, offset: 0 });
    const followers = await service.listFollowers(authCtx, { limit: 100, offset: 0 });
    const followerIds = new Set((followers.users || []).map((u: any) => u.id));
    const friends = (following.users || []).filter((u: any) => followerIds.has(u.id));
    return ok(c, friends);
  } catch (error) {
    return handleError(c, error);
  }
});

// Get who I'm following
users.get("/me/following", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const list = await service.listFollowing(authCtx, { limit, offset });
    return ok(c, list.users);
  } catch (error) {
    return handleError(c, error);
  }
});

// Get my followers
users.get("/me/followers", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const list = await service.listFollowers(authCtx, { limit, offset });
    return ok(c, list.users);
  } catch (error) {
    return handleError(c, error);
  }
});

// Get my follow requests
users.get("/me/follow-requests", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const url = new URL(c.req.url);
    const directionParam = url.searchParams.get("direction");
    const direction =
      directionParam === "incoming" || directionParam === "outgoing" ? directionParam : "all";
    const list = await service.listFollowRequests(authCtx, { direction: direction as any });
    return ok(c, list);
  } catch (error) {
    return handleError(c, error);
  }
});

// Block list
users.get("/me/blocks", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const list = await service.listBlocks(authCtx, {});
    return ok(c, list.users);
  } catch (error) {
    return handleError(c, error);
  }
});

// Mute list
users.get("/me/mutes", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const list = await service.listMutes(authCtx, {});
    return ok(c, list.users);
  } catch (error) {
    return handleError(c, error);
  }
});

// Get my invitations (stub)
users.get("/me/invitations", auth, async (c) => ok(c, []));

// Search users
users.get("/users", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const query = (url.searchParams.get("q") || "").trim();
    const result = await service.searchUsers(authCtx, { query, limit, offset });
    return ok(c, result.users);
  } catch (error) {
    return handleError(c, error);
  }
});

// Fetch another user's public profile
users.get("/users/:id", optionalAuth, async (c) => {
  try {
    const authCtx = getAppAuthContext(c);
    const service = createUserService(c.env);
    const postService = createPostService(c.env);
    const userId = c.req.param("id");
    const user = await service.getUser(authCtx, userId);
    if (!user) {
      return fail(c, "User not found", 404, { code: ErrorCodes.USER_NOT_FOUND, details: { userId } });
    }
    const pinned_posts = await postService
      .listPinnedPosts(authCtx, { user_id: userId, limit: 5 })
      .catch(() => []);
    return ok(c, { ...user, pinned_posts: pinned_posts ?? [] });
  } catch (error) {
    return handleError(c, error);
  }
});

// Update my profile
users.patch("/me", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    const body = (await c.req.json().catch(() => ({}))) as any;
    const updated = await service.updateProfile(authCtx, {
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
      avatar: typeof body.avatar_url === "string" ? body.avatar_url : body.avatar,
      bio: typeof body.bio === "string" ? body.bio : undefined,
    });
    return ok(c, updated);
  } catch (error) {
    return handleError(c, error);
  }
});

// Register push device (not supported in service layer yet)
users.post("/me/push-devices", auth, async (c) =>
  fail(c, "push device registration is handled by notification service", 501),
);

// Unregister push device (not supported in service layer yet)
users.delete("/me/push-devices", auth, async (c) =>
  fail(c, "push device registration is handled by notification service", 501),
);

// Follow a user
users.post("/users/:id/follow", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    await service.follow(authCtx, c.req.param("id"));
    return ok(c, { following: true });
  } catch (error) {
    return handleError(c, error);
  }
});

// Unfollow a user
users.delete("/users/:id/follow", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    await service.unfollow(authCtx, c.req.param("id"));
    return ok(c, { following: false });
  } catch (error) {
    return handleError(c, error);
  }
});

// Accept follow request
users.post("/users/:id/follow/accept", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    await service.acceptFollowRequest(authCtx, c.req.param("id"));
    return ok(c, { accepted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

// Reject follow request
users.post("/users/:id/follow/reject", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createUserService(c.env);
    await service.rejectFollowRequest(authCtx, c.req.param("id"));
    return ok(c, { rejected: true });
  } catch (error) {
    return handleError(c, error);
  }
});

// Block a user - delegated to Default App (App layer)
users.post("/users/:id/block", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const targetId = c.req.param("id");
    const res = await proxyToDefaultApp(c, "/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    });
    if (!res.ok) {
      const data = await res.json<any>().catch(() => ({}));
      return fail(c, data?.error ?? "Failed to block user", res.status);
    }
    return ok(c, { blocked: true });
  } catch (error) {
    return handleError(c, error);
  }
});

// Unblock a user - delegated to Default App (App layer)
users.delete("/users/:id/block", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const targetId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/blocks/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json<any>().catch(() => ({}));
      return fail(c, data?.error ?? "Failed to unblock user", res.status);
    }
    return ok(c, { blocked: false });
  } catch (error) {
    return handleError(c, error);
  }
});

// Mute a user - delegated to Default App (App layer)
users.post("/users/:id/mute", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const targetId = c.req.param("id");
    const res = await proxyToDefaultApp(c, "/mutes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    });
    if (!res.ok) {
      const data = await res.json<any>().catch(() => ({}));
      return fail(c, data?.error ?? "Failed to mute user", res.status);
    }
    return ok(c, { muted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

// Unmute a user - delegated to Default App (App layer)
users.delete("/users/:id/mute", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const targetId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/mutes/${encodeURIComponent(targetId)}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json<any>().catch(() => ({}));
      return fail(c, data?.error ?? "Failed to unmute user", res.status);
    }
    return ok(c, { muted: false });
  } catch (error) {
    return handleError(c, error);
  }
});

// Get user's pinned posts
users.get("/users/:id/pinned", optionalAuth, async (c) => {
  try {
    const authCtx = getAppAuthContext(c);
    const postService = createPostService(c.env);
    const url = new URL(c.req.url);
    const { limit } = parsePagination(url, { limit: 10, offset: 0 });
    const pinned = await postService.listPinnedPosts(authCtx, {
      user_id: c.req.param("id"),
      limit,
    });
    return ok(c, pinned ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

// Send a notification via NotificationService (internal/debug)
users.post("/notifications/send", auth, async (c) => {
  try {
    const authCtx = ensureAuth(getAppAuthContext(c));
    const service = createNotificationService(c.env);
    const body = (await c.req.json().catch(() => ({}))) as any;
    if (!service.send) return fail(c, "notification sending not available", 501);
    await service.send(authCtx, {
      recipientId: body.recipientId || body.user_id,
      type: body.type || "custom",
      actorId: body.actorId || authCtx.userId,
      refType: body.refType || null,
      refId: body.refId || null,
      message: body.message || "",
      data: body.data || null,
    });
    return ok(c, { sent: true });
  } catch (error) {
    return handleError(c, error);
  }
});

export default users;
