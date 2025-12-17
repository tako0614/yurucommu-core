// Media upload and serving routes via MediaService / StorageService

import { Hono } from "hono";
import type { PublicAccountBindings as Bindings, Variables } from "@takos/platform/server";
import { HttpError, ok, fail } from "@takos/platform/server";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import type { ImageTransformOptions, UploadMediaInput } from "@takos/platform/app/services/media-service";
import { auth } from "../middleware/auth";
import { createMediaService } from "../services";
import { getAppAuthContext } from "../lib/auth-context";
import { checkStorageQuota } from "../lib/storage-quota";
import type { AuthContext } from "../lib/auth-context-model";
import { ErrorCodes } from "../lib/error-codes";

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

const parseTransformOptions = (url: URL): ImageTransformOptions | null => {
  const width = parseInt(url.searchParams.get("w") || "", 10);
  const height = parseInt(url.searchParams.get("h") || "", 10);
  const quality = parseInt(url.searchParams.get("quality") || url.searchParams.get("q") || "", 10);
  const blur = parseInt(url.searchParams.get("blur") || "", 10);
  const fit = (url.searchParams.get("fit") || "").trim().toLowerCase();
  const format = (url.searchParams.get("format") || url.searchParams.get("fm") || "").trim().toLowerCase();
  const options: ImageTransformOptions = {};
  if (!Number.isNaN(width) && width > 0) options.width = width;
  if (!Number.isNaN(height) && height > 0) options.height = height;
  if (fit && ["cover", "contain", "fill", "inside", "outside"].includes(fit)) options.fit = fit as ImageTransformOptions["fit"];
  if (format && ["webp", "avif", "jpeg", "png", "auto"].includes(format)) {
    options.format = format as ImageTransformOptions["format"];
  }
  if (!Number.isNaN(quality) && quality > 0) options.quality = quality;
  if (!Number.isNaN(blur) && blur > 0) options.blur = blur;
  return Object.keys(options).length ? options : null;
};

const ensureAuth = (ctx: AppAuthContext): AppAuthContext => {
  if (!ctx.userId) throw new HttpError(401, ErrorCodes.UNAUTHORIZED, "Authentication required");
  return ctx;
};

const handleError = (_c: any, error: unknown): never => {
  if (error instanceof HttpError) throw error;
  throw error;
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
  if (!env.MEDIA) return fail(c, "Media storage not configured", 500, { code: ErrorCodes.CONFIGURATION_ERROR });
  const service = createMediaService(env);
  const authCtx = ensureAuth(getAppAuthContext(c));
  const authContext = (c.get("authContext") as AuthContext | undefined) ?? null;
  if (!authContext?.isAuthenticated || !authContext.userId) {
    return fail(c, "Authentication required", 401, { code: ErrorCodes.UNAUTHORIZED });
  }
  const form = await c.req.formData().catch(() => null);
  if (!form) return fail(c, "invalid form data", 400);
  const file = form.get("file");
  if (!(typeof Blob !== "undefined" && file instanceof Blob)) return fail(c, "file required", 400);
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
  const altRaw = form.get("alt");
  const descriptionRaw = form.get("description");
  const alt =
    typeof altRaw === "string"
      ? altRaw.slice(0, MAX_ALT_LENGTH).trim()
      : undefined;
  const description =
    typeof descriptionRaw === "string"
      ? descriptionRaw.slice(0, MAX_ALT_LENGTH).trim()
      : undefined;
  const overrides: Partial<Omit<UploadMediaInput, "file">> = {};
  if (alt) overrides.alt = alt;
  if (description) overrides.description = description;
  const uploaded = await service.uploadFromFormData(authCtx, form, overrides);
  return ok(c, uploaded, 201);
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
  if (!env.MEDIA) {
    throw new HttpError(500, ErrorCodes.CONFIGURATION_ERROR, "Media storage not configured");
  }
  const url = new URL(c.req.url);
  const path = url.pathname;
  let key = "";
  try {
    key = decodeURIComponent(path.replace(/^\/media\//, ""));
  } catch (error) {
    throw new HttpError(400, ErrorCodes.INVALID_INPUT, "Invalid media path encoding", {
      path,
      error: String((error as Error)?.message ?? error),
    });
  }
  if (!key) {
    throw new HttpError(404, ErrorCodes.MEDIA_NOT_FOUND, "Media not found", { path });
  }
  const transform = parseTransformOptions(url);
  if (transform) {
    const service = createMediaService(env);
    const origin = `${url.protocol}//${url.host}`;
    const target = service.getTransformedUrl(key, transform, origin);
    return c.redirect(target, 302);
  }
  const obj = await env.MEDIA.get(key);
  if (!obj) {
    throw new HttpError(404, ErrorCodes.MEDIA_NOT_FOUND, "Media not found", { key });
  }
  const headers = new Headers();
  const ct = obj.httpMetadata?.contentType || "application/octet-stream";
  headers.set("Content-Type", ct);
  const cc = obj.httpMetadata?.cacheControl || "public, max-age=31536000, immutable";
  headers.set("Cache-Control", cc);
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

export default media;
