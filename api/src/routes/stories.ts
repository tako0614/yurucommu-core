import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { createStoryService } from "../services";
import { getAppAuthContext } from "../lib/auth-context";

const stories = new Hono<{ Bindings: Bindings; Variables: Variables }>();

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

const buildStoryInput = (body: any, communityId?: string | null): { items: any[]; community_id: string | null; audience: "community" | "all"; visible_to_friends: boolean } => {
  const items = Array.isArray(body.items) ? body.items : [];
  return {
    items,
    community_id: communityId ?? body.community_id ?? null,
    audience: body.audience === "community" ? "community" : "all",
    visible_to_friends: body.visible_to_friends === undefined ? true : !!body.visible_to_friends,
  };
};

stories.post("/communities/:id/stories", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const created = await service.createStory(authCtx, buildStoryInput(body, c.req.param("id")));
    return ok(c, created, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.post("/stories", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const created = await service.createStory(authCtx, buildStoryInput(body, body.community_id ?? null));
    return ok(c, created, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/stories", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const page = await service.listStories(authCtx, { limit, offset });
    return ok(c, page.stories);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/communities/:id/stories", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const page = await service.listStories(authCtx, {
      community_id: c.req.param("id"),
      limit,
      offset,
    });
    return ok(c, page.stories);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/stories/:id", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const story = await service.getStory(authCtx, c.req.param("id"));
    if (!story) return fail(c, "story not found", 404);
    return ok(c, story);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.patch("/stories/:id", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = (await c.req.json().catch(() => ({}))) as any;
    const updated = await service.updateStory(authCtx, {
      id: c.req.param("id"),
      items: Array.isArray(body.items) ? body.items : undefined,
      audience: body.audience === "community" ? "community" : body.audience === "all" ? "all" : undefined,
      visible_to_friends:
        body.visible_to_friends === undefined ? undefined : !!body.visible_to_friends,
    });
    return ok(c, updated);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.delete("/stories/:id", auth, async (c) => {
  try {
    const service = createStoryService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    await service.deleteStory(authCtx, c.req.param("id"));
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

stories.post("/internal/tasks/cleanup-stories", async (c) => {
  return fail(c, "cleanup handled by story service", 503);
});

export type CleanupResult = {
  deleted: number;
  checked: number;
  skipped?: boolean;
  reason?: string;
};

export type CleanupOptions = {
  limit?: number;
  force?: boolean;
  throttleMs?: number;
};

/**
 * Cleanup expired stories (stub implementation).
 * The actual cleanup is handled by the story service internally.
 */
export async function cleanupExpiredStories(
  _env: Bindings,
  _options?: CleanupOptions,
): Promise<CleanupResult> {
  // Story cleanup is handled internally by the object service.
  // This stub exists for cron compatibility.
  return { deleted: 0, checked: 0, skipped: true, reason: "handled internally" };
}

export default stories;
