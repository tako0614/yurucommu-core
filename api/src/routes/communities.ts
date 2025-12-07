import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { createCommunityService, createPostService } from "../services";
import { getAppAuthContext } from "../lib/auth-context";

const communities = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const parsePagination = (url: URL, defaults = { limit: 20, offset: 0 }) => {
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || `${defaults.offset}`, 10));
  return { limit, offset };
};

const ensureAuth = (ctx: AppAuthContext): AppAuthContext => {
  if (!ctx.userId) throw new Error("unauthorized");
  return ctx;
};

const handleError = (c: any, error: unknown) => {
  const message = (error as Error)?.message || "unexpected error";
  if (message === "unauthorized") return fail(c, message, 401);
  return fail(c, message, 400);
};

communities.get("/communities", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const q = (url.searchParams.get("q") || "").trim();
    const page = await service.listCommunities(authCtx, { limit, offset, query: q });
    return ok(c, page.communities);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const created = await service.createCommunity(authCtx, {
      name: String(body.name ?? body.id ?? "").trim(),
      display_name: String(body.display_name ?? body.name ?? "").trim(),
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon_url === "string" ? body.icon_url : body.icon,
      visibility: body.visibility === "public" ? "public" : "private",
    });
    return ok(c, created, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const community = await service.getCommunity(authCtx, c.req.param("id"));
    if (!community) return fail(c, "community not found", 404);
    const members = await service.listMembers(authCtx, c.req.param("id")).catch(() => []);
    return ok(c, { ...community, members });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.patch("/communities/:id", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const updated = await service.updateCommunity(authCtx, {
      id: c.req.param("id"),
      display_name: typeof body.display_name === "string" ? body.display_name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon_url === "string" ? body.icon_url : body.icon,
      visibility: body.visibility === "public" ? "public" : body.visibility === "private" ? "private" : undefined,
    });
    return ok(c, updated);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/channels", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const channels = await service.listChannels(authCtx, c.req.param("id"));
    return ok(c, channels);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/channels", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const channel = await service.createChannel(authCtx, {
      community_id: c.req.param("id"),
      name: String(body.name ?? "").trim(),
      description: typeof body.description === "string" ? body.description : undefined,
    });
    return ok(c, channel, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.patch("/communities/:id/channels/:channelId", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const channel = await service.updateChannel(authCtx, {
      community_id: c.req.param("id"),
      channel_id: c.req.param("channelId"),
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    });
    return ok(c, channel);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.delete("/communities/:id/channels/:channelId", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.deleteChannel(authCtx, c.req.param("id"), c.req.param("channelId"));
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/direct-invites", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const ids: string[] = Array.isArray(body.user_ids)
      ? body.user_ids
      : body.user_id
        ? [String(body.user_id)]
        : [];
    const invites = await service.sendDirectInvite(authCtx, {
      community_id: c.req.param("id"),
      user_ids: ids,
    });
    return ok(c, invites, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/leave", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.leaveCommunity(authCtx, c.req.param("id"));
    return ok(c, { community_id: c.req.param("id"), left: true });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/join", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.joinCommunity(authCtx, c.req.param("id"));
    return ok(c, { community_id: c.req.param("id"), joined: true });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/members", auth, async (c) => {
  try {
    const service = createCommunityService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const members = await service.listMembers(authCtx, c.req.param("id"));
    return ok(c, members);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/posts", auth, async (c) => {
  try {
    const posts = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const page = await posts.listTimeline(authCtx, { community_id: c.req.param("id"), limit, offset });
    return ok(c, page.posts);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/reactions-summary", auth, async (c) => {
  try {
    const posts = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const page = await posts.listTimeline(authCtx, { community_id: c.req.param("id"), limit: 100, offset: 0 });
    const summary: Record<string, Record<string, number>> = {};
    await Promise.all(
      page.posts.map(async (post: any) => {
        const reactions = await posts.listReactions(authCtx, (post as any).id);
        for (const reaction of reactions) {
          const postId = (reaction as any).post_id;
          const emoji = (reaction as any).emoji;
          if (!summary[postId]) summary[postId] = {};
          summary[postId][emoji] = (summary[postId][emoji] ?? 0) + 1;
        }
      }),
    );
    return ok(c, summary);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/invites", auth, async (c) => fail(c, "invite codes are disabled", 410));
communities.post("/communities/:id/invites", auth, async (c) => fail(c, "invite codes are disabled", 410));
communities.post("/communities/:id/invites/:code/disable", auth, async (c) =>
  fail(c, "invite codes are disabled", 410),
);
communities.post("/communities/:id/invites/reset", auth, async (c) =>
  fail(c, "invite codes are disabled", 410),
);
communities.post("/communities/:id/invitations/accept", auth, async (c) =>
  fail(c, "invitation workflow handled by community service", 501),
);
communities.post("/communities/:id/invitations/decline", auth, async (c) =>
  fail(c, "invitation workflow handled by community service", 501),
);

export default communities;
