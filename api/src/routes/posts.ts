import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { Visibility } from "@takos/platform/app/services/post-service";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { getAppAuthContext } from "../lib/auth-context";
import { createPostService } from "../services";

const posts = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const parsePagination = (url: URL, defaults = { limit: 20, offset: 0 }) => {
  const limit = Math.min(
    50,
    Math.max(1, parseInt(url.searchParams.get("limit") || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || `${defaults.offset}`, 10));
  return { limit, offset };
};

const normalizeMediaIds = (raw: unknown): string[] => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object" && typeof (item as any).url === "string") {
          return ((item as any).url as string).trim();
        }
        return "";
      })
      .filter(Boolean);
  }
  return [];
};

const parseVisibility = (raw: unknown): Visibility => {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  if (value === "unlisted" || value === "private" || value === "direct") {
    return value as Visibility;
  }
  return "public";
};

const parsePoll = (raw: any) => {
  if (!raw || typeof raw !== "object") return null;
  const options = Array.isArray(raw.options)
    ? raw.options.map((opt: any) => String(opt || "").trim()).filter(Boolean)
    : [];
  if (!options.length) return null;
  const expiresIn =
    typeof raw.expires_in === "number" && Number.isFinite(raw.expires_in)
      ? raw.expires_in
      : undefined;
  return {
    options,
    multiple: raw.multiple === undefined ? undefined : !!raw.multiple,
    expires_in: expiresIn,
  };
};

const toLegacyPost = (post: any): any => {
  if (!post) return post;
  const mediaUrls =
    Array.isArray((post as any).media) && !(post as any).media_urls
      ? (post as any).media.map((m: any) => m?.url).filter(Boolean)
      : (post as any).media_urls;
  return {
    ...post,
    text: (post as any).text ?? (post as any).content ?? "",
    media_urls: mediaUrls ?? [],
  };
};

const mapPosts = (list: any[]): any[] => list.map(toLegacyPost);

const ensureAuth = (ctx: AppAuthContext): AppAuthContext => {
  if (!ctx.userId) {
    throw new Error("unauthorized");
  }
  return ctx;
};

const buildCreatePostInput = (body: any, communityId?: string | null) => {
  const content = String(body.text ?? body.content ?? "").trim();
  const visibility = parseVisibility(body.visibility);
  const media_ids = normalizeMediaIds(body.media_ids ?? body.media);
  const poll = parsePoll(body.poll);
  return {
    content,
    visibility,
    community_id: communityId ?? body.community_id ?? null,
    in_reply_to_id: body.in_reply_to_id ?? body.in_reply_to ?? null,
    media_ids,
    sensitive: body.sensitive === undefined ? undefined : !!body.sensitive,
    content_warning:
      typeof body.content_warning === "string"
        ? body.content_warning.trim() || null
        : typeof body.spoiler_text === "string"
          ? body.spoiler_text.trim() || null
          : null,
    poll,
  };
};

const buildUpdatePostInput = (id: string, body: any): { id: string; content?: string; sensitive?: boolean; content_warning?: string | null; media_ids?: string[] } => {
  const input: { id: string; content?: string; sensitive?: boolean; content_warning?: string | null; media_ids?: string[] } = { id };
  if (body.text !== undefined || body.content !== undefined) {
    input.content = String(body.text ?? body.content ?? "").trim();
  }
  if (body.sensitive !== undefined) {
    input.sensitive = !!body.sensitive;
  }
  if (body.content_warning !== undefined || body.spoiler_text !== undefined) {
    const cw = body.content_warning ?? body.spoiler_text;
    input.content_warning = typeof cw === "string" ? cw.trim() || null : null;
  }
  if (body.media_ids !== undefined || body.media !== undefined) {
    input.media_ids = normalizeMediaIds(body.media_ids ?? body.media);
  }
  return input;
};

const handleError = (c: any, error: unknown) => {
  const message = (error as Error)?.message || "unexpected error";
  if (message === "unauthorized") {
    return fail(c, message, 401);
  }
  return fail(c, message, 400);
};

posts.post("/communities/:id/posts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const created = await service.createPost(authCtx, buildCreatePostInput(body, c.req.param("id")));
    return ok(c, toLegacyPost(created), 201);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const created = await service.createPost(authCtx, buildCreatePostInput(body, null));
    return ok(c, toLegacyPost(created), 201);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/communities/:id/posts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const page = await service.listTimeline(authCtx, { community_id: c.req.param("id"), limit, offset });
    return ok(c, mapPosts(page.posts));
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const visibility = parseVisibility(url.searchParams.get("visibility"));
    const page = await service.listTimeline(authCtx, { limit, offset, visibility });
    return ok(c, mapPosts(page.posts));
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts/search", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const query = (url.searchParams.get("q") || "").trim();
    const result = await service.searchPosts(authCtx, { query, limit, offset });
    return ok(c, { items: mapPosts(result.posts), next_offset: result.next_offset ?? null });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/hashtags/:tag/posts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const tag = c.req.param("tag") || "";
    const result = await service.searchPosts(authCtx, { query: `#${tag}`, limit, offset });
    return ok(c, mapPosts(result.posts));
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/hashtags/trending", auth, async (c) => ok(c, []));

posts.get("/posts/:id", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const post = await service.getPost(authCtx, c.req.param("id"));
    if (!post) return fail(c, "post not found", 404);
    return ok(c, toLegacyPost(post));
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts/:id/history", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const history = await service.listPostHistory(authCtx, c.req.param("id"));
    return ok(c, history);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts/:id/poll", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const poll = await service.getPoll(authCtx, c.req.param("id"));
    if (!poll) return fail(c, "poll not found", 404);
    return ok(c, poll);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts/:id/reposts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const result = await service.repost(authCtx, { post_id: c.req.param("id"), comment: body.comment });
    return ok(c, result, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.delete("/posts/:id/reposts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.undoRepost(authCtx, c.req.param("id"));
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts/:id/reposts", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const result = await service.listReposts(authCtx, {
      post_id: c.req.param("id"),
      limit,
      offset,
    });
    return ok(c, result);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts/:id/vote", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const optionIds = Array.isArray(body.option_ids)
      ? (body.option_ids as any[]).map((v) => String(v))
      : [];
    const poll = await service.voteOnPoll(authCtx, { post_id: c.req.param("id"), option_ids: optionIds });
    return ok(c, poll || { ok: true });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts/:id/reactions", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const reactions = await service.listReactions(authCtx, c.req.param("id"));
    return ok(c, reactions);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts/:id/reactions", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    await service.reactToPost(authCtx, {
      post_id: c.req.param("id"),
      emoji: typeof body.emoji === "string" && body.emoji.trim() ? body.emoji.trim() : "👍",
    });
    return ok(c, { reacted: true }, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.delete("/posts/:id/reactions/:reactionId", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.removeReaction(authCtx, c.req.param("reactionId"));
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts/:id/bookmark", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.addBookmark(authCtx, c.req.param("id"));
    return ok(c, { bookmarked: true });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.delete("/posts/:id/bookmark", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.removeBookmark(authCtx, c.req.param("id"));
    return ok(c, { bookmarked: false });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/me/bookmarks", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const result = await service.listBookmarks(authCtx, { limit, offset });
    return ok(c, { items: mapPosts(result.items), next_offset: result.next_offset ?? null });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/posts/:id/comments", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const comments = await service.listComments(authCtx, c.req.param("id"));
    return ok(c, mapPosts(comments));
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts/:id/comments", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const created = await service.createPost(
      authCtx,
      buildCreatePostInput(
        {
          ...body,
          in_reply_to_id: c.req.param("id"),
        },
        body.community_id ?? null,
      ),
    );
    return ok(c, toLegacyPost(created), 201);
  } catch (error) {
    return handleError(c, error);
  }
});

posts.delete("/posts/:id/comments/:commentId", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.deletePost(authCtx, c.req.param("commentId"));
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.get("/communities/:id/reactions-summary", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const page = await service.listTimeline(authCtx, { community_id: c.req.param("id"), limit: 100, offset: 0 });
    const summary: Record<string, Record<string, number>> = {};
    await Promise.all(
      page.posts.map(async (post: any) => {
        const reactions = await service.listReactions(authCtx, (post as any).id);
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

posts.delete("/posts/:id", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.deletePost(authCtx, c.req.param("id"));
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

posts.patch("/posts/:id", auth, async (c) => {
  try {
    const service = createPostService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const updated = await service.updatePost(authCtx, buildUpdatePostInput(c.req.param("id"), body));
    return ok(c, toLegacyPost(updated));
  } catch (error) {
    return handleError(c, error);
  }
});

posts.post("/posts/:id/pin", auth, async (c) => fail(c, "pinning not supported via service layer", 501));
posts.post("/posts/:id/unpin", auth, async (c) => fail(c, "pinning not supported via service layer", 501));

export default posts;
