// Media upload and serving routes

import { Hono } from "hono";
import type {
  PublicAccountBindings as Bindings,
  Variables,
} from "@takos/platform/server";
import { makeData } from "../data";
import { ok, fail, releaseStore } from "@takos/platform/server";
import { auth } from "../middleware/auth";

const media = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const MAX_ALT_LENGTH = 1500;

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

function safeFileExt(name: string, type: string): string {
  const n = (name || "").toLowerCase();
  const dot = n.lastIndexOf(".");
  const extFromName = dot >= 0
    ? n.slice(dot + 1).replace(/[^a-z0-9]/g, "")
    : "";
  const fromType = inferExtFromType(type);
  return (extFromName || fromType || "").slice(0, 8);
}

function datePrefix(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}/${m}/${dd}`;
}

// GET /storage - List authenticated user's storage files
media.get("/storage", auth, async (c) => {
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user");
    if (!user?.id) return fail(c, "unauthorized", 401);

    if (!store.listMediaByUser) {
      return fail(c, "listMediaByUser not implemented", 500);
    }

    const files = await store.listMediaByUser(user.id);
    return ok(c, { files });
  } finally {
    await releaseStore(store);
  }
});

// POST /storage/upload - Authenticated upload (same as /media/upload)
media.post("/storage/upload", auth, async (c) => {
  const env = c.env;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user");

    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, "invalid form data", 400);
    const file = form.get("file") as File | null;
    if (!file) return fail(c, "file required", 400);
    const descriptionRaw = form.get("description") ?? form.get("alt");
    const description = typeof descriptionRaw === "string"
      ? descriptionRaw.slice(0, MAX_ALT_LENGTH).trim()
      : "";
    const ext = safeFileExt((file as any).name || "", file.type);
    const id = crypto.randomUUID().replace(/-/g, "");
    const prefix = `user-uploads/${(user as any)?.id || "anon"}/${datePrefix()}`;
    const key = `${prefix}/${id}${ext ? "." + ext : ""}`;
    await env.MEDIA.put(key, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const url = `/media/${encodeURI(key)}`;
    if (store.upsertMedia) {
      await store.upsertMedia({
        key,
        user_id: (user as any)?.id || "",
        url,
        description,
        content_type: file.type || "",
      });
    }
    return ok(c, { key, url, description: description || undefined }, 201);
  } finally {
    await releaseStore(store);
  }
});

// DELETE /storage - Delete a storage file
media.delete("/storage", auth, async (c) => {
  const env = c.env;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user");
    if (!user?.id) return fail(c, "unauthorized", 401);

    const body = await c.req.json().catch(() => ({}));
    const key = body?.key;
    if (!key || typeof key !== "string") {
      return fail(c, "key required", 400);
    }

    // Verify ownership
    if (store.getMedia) {
      const media = await store.getMedia(key);
      if (!media) return fail(c, "file not found", 404);
      if (media.user_id !== user.id) {
        return fail(c, "forbidden: not your file", 403);
      }
    }

    // Delete from R2
    await env.MEDIA.delete(key);

    // Delete from database if deleteMedia exists
    if (store.deleteMedia) {
      await store.deleteMedia(key);
    }

    return ok(c, { deleted: true });
  } finally {
    await releaseStore(store);
  }
});

media.post("/upload", auth, async (c) => {
  const env = c.env;
  if (!env.MEDIA) return fail(c, "media storage not configured", 500);
  const store = makeData(c.env as any, c);
  try {
    const user = c.get("user");

    const form = await c.req.formData().catch(() => null);
    if (!form) return fail(c, "invalid form data", 400);
    const file = form.get("file") as File | null;
    if (!file) return fail(c, "file required", 400);
    const descriptionRaw = form.get("description") ?? form.get("alt");
    const description = typeof descriptionRaw === "string"
      ? descriptionRaw.slice(0, MAX_ALT_LENGTH).trim()
      : "";
    const ext = safeFileExt((file as any).name || "", file.type);
    const id = crypto.randomUUID().replace(/-/g, "");
    const prefix = `user-uploads/${(user as any)?.id || "anon"}/${datePrefix()}`;
    const key = `${prefix}/${id}${ext ? "." + ext : ""}`;
    await env.MEDIA.put(key, file, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });
    const url = `/media/${encodeURI(key)}`;
    if (store.upsertMedia) {
      await store.upsertMedia({
        key,
        user_id: (user as any)?.id || "",
        url,
        description,
        content_type: file.type || "",
      });
    }
    return ok(c, { key, url, description: description || undefined }, 201);
  } finally {
    await releaseStore(store);
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
  const cc = obj.httpMetadata?.cacheControl ||
    "public, max-age=31536000, immutable";
  headers.set("Cache-Control", cc);
  if (obj.httpEtag) headers.set("ETag", obj.httpEtag);
  return new Response(obj.body, { headers });
});

export default media;
