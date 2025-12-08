// Media upload and serving routes via MediaService / StorageService

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { auth } from "../middleware/auth";
import { createMediaService } from "../services";
import { getAppAuthContext } from "../lib/auth-context";
import { checkStorageQuota } from "../lib/storage-quota";
import type { AuthContext } from "../lib/auth-context-model";

const media = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const MAX_ALT_LENGTH = 1500;

const parsePagination = (url: URL, defaults = { limit: 20, offset: 0 }) => {
  const limit = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("limit") || `${defaults.limit}`, 10)),
  );
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") || `${defaults.offset}`, 10));
  return { limit, offset };
};

const inferExtFromType = (t: string) => {
  const m = (t || "").toLowerCase();
  if (m.includes("jpeg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("svg")) return "svg";
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  return "";
};

const safeFileExt = (name: string, type: string): string => {
  const n = (name || "").toLowerCase();
  const dot = n.lastIndexOf(".");
  const extFromName = dot >= 0 ? n.slice(dot + 1).replace(/[^a-z0-9]/g, "") : "";
  const fromType = inferExtFromType(type);
  return (extFromName || fromType || "").slice(0, 8);
};

const datePrefix = (d = new Date()) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${dd}`;
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

// GET /storage - List authenticated user's storage files
media.get("/storage", auth, async (c) => {
  try {
    const service = createMediaService(c.env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const url = new URL(c.req.url);
    const { limit, offset } = parsePagination(url);
    const list = await service.listStorage(authCtx, { limit, offset });
    return ok(c, list);
  } catch (error) {
    return handleError(c, error);
  }
});

const handleUpload = async (c: any) => {
  const env = c.env;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const authCtx = ensureAuth(getAppAuthContext(c));
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;
  if (!authContext?.isAuthenticated || !authContext.userId) {
    return fail(c, "Authentication required", 401, { code: "UNAUTHORIZED" });
  }
  const form = await c.req.formData().catch(() => null);
  if (!form) return fail(c, "invalid form data", 400);
  const file = form.get("file") as File | null;
  if (!file) return fail(c, "file required", 400);
  const quota = await checkStorageQuota(
    env.MEDIA,
    `user-uploads/${authContext.userId}`,
    authContext,
    (file as any).size ?? 0,
  );
  if (!quota.ok) {
    return fail(c, quota.guard.message, quota.guard.status, {
      code: quota.guard.code,
      details: quota.guard.details,
    });
  }
  const descriptionRaw = form.get("description") ?? form.get("alt");
  const description =
    typeof descriptionRaw === "string"
      ? descriptionRaw.slice(0, MAX_ALT_LENGTH).trim()
      : "";
  const ext = safeFileExt((file as any).name || "", file.type);
  const id = crypto.randomUUID().replace(/-/g, "");
  const prefix = `user-uploads/${authCtx.userId || "anon"}/${datePrefix()}`;
  const key = `${prefix}/${id}${ext ? "." + ext : ""}`;
  await env.MEDIA.put(key, file, {
    httpMetadata: {
      contentType: file.type || "application/octet-stream",
      cacheControl: "public, max-age=31536000, immutable",
    },
  });
  const url = `/media/${encodeURI(key)}`;
  return ok(c, { key, url, description: description || undefined }, 201);
};

// POST /storage/upload - Authenticated upload
media.post("/storage/upload", auth, async (c) => {
  try {
    return await handleUpload(c);
  } catch (error) {
    return handleError(c, error);
  }
});

// DELETE /storage - Delete a storage file
media.delete("/storage", auth, async (c) => {
  const env = c.env;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  try {
    const service = createMediaService(env);
    const authCtx = ensureAuth(getAppAuthContext(c));
    const body = await c.req.json().catch(() => ({}));
    const key = (body as any)?.key;
    if (!key || typeof key !== "string") {
      return fail(c, "key required", 400);
    }
    await service.deleteStorageObject(authCtx, key);
    return ok(c, { deleted: true });
  } catch (error) {
    return handleError(c, error);
  }
});

// POST /media/upload (alias)
media.post("/upload", auth, async (c) => {
  try {
    return await handleUpload(c);
  } catch (error) {
    return handleError(c, error);
  }
});

// Publicly serve media from R2 via Worker
media.get("/*", async (c) => {
  const env = c.env;
  if (!env.MEDIA) return c.text("Not Found", 404);
  const path = new URL(c.req.url).pathname;
  const key = decodeURIComponent(path.replace(/^\/media\//, ""));
  if (!key) return c.text("Not Found", 404);
  const obj = await env.MEDIA.get(key);
  if (!obj) return c.text("Not Found", 404);
  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  headers.set("Content-Type", ct);
  const cc = obj.httpMetadata?.cacheControl || "public, max-age=31536000, immutable";
  headers.set("Cache-Control", cc);
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

export default media;
