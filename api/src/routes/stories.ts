import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { getAppAuthContext } from "../lib/auth-context";
import { buildTakosAppEnv, loadStoredAppManifest, loadTakosApp } from "../lib/app-sdk-loader";

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
    const res = await proxyToDefaultApp(c, `/communities/${encodeURIComponent(c.req.param("id"))}/stories`);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "Failed to create story", res.status);
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
    if (!res.ok) return fail(c, json?.error ?? "Failed to list stories", res.status);
    return ok(c, json?.stories ?? []);
  } catch (error) {
    return handleError(c, error);
  }
});

stories.get("/stories/:id", auth, async (c) => {
  try {
    ensureAuth(getAppAuthContext(c));
    const res = await proxyToDefaultApp(c, `/stories/${encodeURIComponent(c.req.param("id"))}`);
    const json = await readJson(res);
    if (!res.ok) return fail(c, json?.error ?? "story not found", res.status);
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
  return ok(c, { deleted: 0, checked: 0, skipped: true, reason: "not implemented (story TTL enforced by app reads)" });
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
 * Story TTL is currently enforced by app reads; GC can be added later.
 */
export async function cleanupExpiredStories(
  _env: Bindings,
  _options?: CleanupOptions,
): Promise<CleanupResult> {
  return { deleted: 0, checked: 0, skipped: true, reason: "not implemented (story TTL enforced by app reads)" };
}

export default stories;
