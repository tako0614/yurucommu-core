import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail, HttpError } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { createPostService } from "../services";
import { getAppAuthContext } from "../lib/auth-context";
import { buildTakosAppEnv, loadStoredAppManifest, loadTakosApp } from "../lib/app-sdk-loader";
import { ErrorCodes } from "../lib/error-codes";

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

communities.get("/communities", auth, async (c) => {
  try {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const q = (url.searchParams.get("q") || "").trim();
    ensureAuth(getAppAuthContext(c));
    const proxyUrl = new URL(url.toString());
    proxyUrl.searchParams.set("limit", String(limit));
    proxyUrl.searchParams.set("offset", String(offset));
    if (q) proxyUrl.searchParams.set("q", q);
    const res = await proxyToDefaultApp(c, "/communities", proxyUrl.search);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to list communities", res.status);
    return ok(c, json?.communities ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(c, "/communities");
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to create community", res.status);
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(communityId)}`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to fetch community", res.status);
    }
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.patch("/communities/:id", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(communityId)}`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to update community", res.status);
    }
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/channels", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(communityId)}/channels`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to list channels", res.status);
    }
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/channels", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(communityId)}/channels`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to create channel", res.status);
    }
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.patch("/communities/:id/channels/:channelId", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const channelId = c.req.param("channelId");
    const res = await proxyToDefaultApp(
      c,
      `/communities/${encodeURIComponent(communityId)}/channels/${encodeURIComponent(channelId)}`,
    );
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { communityId, channelId } });
      }
      return fail(c, json?.error ?? "Failed to update channel", res.status);
    }
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.delete("/communities/:id/channels/:channelId", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const channelId = c.req.param("channelId");
    const res = await proxyToDefaultApp(
      c,
      `/communities/${encodeURIComponent(communityId)}/channels/${encodeURIComponent(channelId)}`,
    );
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Not found", 404, { code: ErrorCodes.NOT_FOUND, details: { communityId, channelId } });
      }
      return fail(c, json?.error ?? "Failed to delete channel", res.status);
    }
    return ok(c, json ?? { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/direct-invites", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(c.req.param("id"))}/direct-invites`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to send invites", res.status);
    }
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/leave", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(c.req.param("id"))}/leave`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to leave community", res.status);
    }
    return ok(c, json ?? { community_id: c.req.param("id"), left: true });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.post("/communities/:id/join", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(c.req.param("id"))}/join`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to join community", res.status);
    }
    return ok(c, json ?? { community_id: c.req.param("id"), joined: true });
  } catch (error) {
    return handleError(c, error);
  }
});

communities.get("/communities/:id/members", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(c.req.param("id"))}/members`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to list members", res.status);
    }
    return ok(c, json ?? []);
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
