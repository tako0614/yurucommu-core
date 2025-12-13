import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail, HttpError } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { getAppAuthContext } from "../lib/auth-context";
import { buildTakosAppEnv, loadStoredAppManifest, loadTakosApp } from "../lib/app-sdk-loader";
import { ErrorCodes } from "../lib/error-codes";

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

stories.post("/communities/:id/stories", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const communityId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(communityId)}/stories`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, { code: ErrorCodes.COMMUNITY_NOT_FOUND, details: { communityId } });
      }
      return fail(c, json?.error ?? "Failed to create story", res.status);
    }
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.post("/stories", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(c, "/stories");
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to create story", res.status);
    return ok(c, json, 201);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/stories", auth, async (c) => {
  try {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    ensureAuth(getAppAuthContext(c));
    const proxyUrl = new URL(url.toString());
    proxyUrl.searchParams.set("limit", String(limit));
    proxyUrl.searchParams.set("offset", String(offset));
    const res = await proxyToDefaultApp(c, "/stories", proxyUrl.search);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to list stories", res.status);
    return ok(c, json?.stories ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/communities/:id/stories", auth, async (c) => {
  try {
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    ensureAuth(getAppAuthContext(c));
    const proxyUrl = new URL(url.toString());
    proxyUrl.searchParams.set("limit", String(limit));
    proxyUrl.searchParams.set("offset", String(offset));
    const res = await proxyToDefaultApp(
      c,
      `/communities/${encodeURIComponent(c.req.param("id"))}/stories`,
      proxyUrl.search,
    );
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Community not found", 404, {
          code: ErrorCodes.COMMUNITY_NOT_FOUND,
          details: { communityId: c.req.param("id") },
        });
      }
      return fail(c, json?.error ?? "Failed to list stories", res.status);
    }
    return ok(c, json?.stories ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/stories/:id", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const storyId = c.req.param("id");
    const res = await proxyToDefaultApp(c, `/stories/${encodeURIComponent(storyId)}`);
    const json = await readJson(res);
    if (!res.ok) {
      if (res.status === 404) {
        return fail(c, "Story not found", 404, { code: ErrorCodes.NOT_FOUND, details: { storyId } });
      }
      return fail(c, json?.error ?? "Failed to fetch story", res.status);
    }
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.patch("/stories/:id", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(c, `/stories/${encodeURIComponent(c.req.param("id"))}`);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to update story", res.status);
    return ok(c, json);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.delete("/stories/:id", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(c, `/stories/${encodeURIComponent(c.req.param("id"))}`);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to delete story", res.status);
    return ok(c, json ?? { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

stories.post("/internal/tasks/cleanup-stories", async (c) => {
  try {
    const result = await cleanupExpiredStories(c.env);
    return ok(c, result);
  } catch (error) {
    console.error("Story cleanup failed:", error);
    return fail(c, "Story cleanup failed", 500);
  }
});

export type CleanupResult = {
  deleted: number;
  checked: number;
  skipped?: boolean;
  reason?: string;
  errors?: string[];
};

export type CleanupOptions = {
  limit?: number;
  force?: boolean;
  throttleMs?: number;
};

/**
 * Cleanup expired stories.
 *
 * ストーリーは 24 時間の TTL を持ち、`takos:story.expiresAt` で有効期限が設定される。
 * この関数は期限切れのストーリーを検索し、ObjectService を通じて削除する。
 *
 * Cron: every 5 minutes (星/5 星 星 星 星)
 */
export async function cleanupExpiredStories(
  env: Bindings,
  options?: CleanupOptions,
): Promise<CleanupResult> {
  const limit = options?.limit ?? 100;
  const now = new Date().toISOString();
  const errors: string[] = [];
  let deleted = 0;
  let checked = 0;

  try {
    // ObjectService を使用してストーリーを取得
    const { createObjectService } = await import("@takos/platform/app/services/object-service");
    const objects = createObjectService(env as any);

    // システムコンテキストで実行（cron タスクのため認証不要）
    const systemCtx = {
      userId: null,
      sessionId: null,
      isAuthenticated: false,
      plan: { name: "system", limits: {}, features: [] },
      limits: {},
    } as any;

    // ストーリーを検索（Note タイプで takos:story 拡張を持つもの）
    // ObjectService.query は直接 takos:story でフィルタできないため、
    // 全 Note を取得して手動でフィルタする（改善余地あり）
    const page = await objects.query(systemCtx, {
      type: "Note",
      limit,
      includeDeleted: false,
    });

    for (const obj of page.items) {
      const story = obj["takos:story"] as { expiresAt?: string } | undefined;
      if (!story?.expiresAt) continue;

      checked++;

      // 期限切れかチェック
      if (story.expiresAt < now) {
        try {
          await objects.delete(systemCtx, obj.id);
          deleted++;
          console.log(`Deleted expired story: ${obj.id} (expired: ${story.expiresAt})`);
        } catch (deleteError) {
          const errorMsg = `Failed to delete story ${obj.id}: ${deleteError}`;
          console.error(errorMsg);
          errors.push(errorMsg);
        }
      }
    }

    return {
      deleted,
      checked,
      ...(errors.length > 0 ? { errors } : {}),
    };
  } catch (error) {
    console.error("Story cleanup error:", error);
    return {
      deleted,
      checked,
      skipped: true,
      reason: `Error: ${error}`,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }
}

export default stories;
