import { type Context, Hono } from "hono";
import { and, eq, like, or } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import type { Database } from "../../db/index.ts";
import { follows, mediaUploads, objects } from "../../db/index.ts";
import { generateId, safeJsonParse } from "../federation-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "media" });

const media = new Hono<{ Bindings: Env; Variables: Variables }>();
type MediaContext = Context<{ Bindings: Env; Variables: Variables }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
];

const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

// Cache durations for served media
const CACHE_MAX_AGE_IMAGE = 31536000; // 1 year for immutable content
const CACHE_MAX_AGE_VIDEO = 604800; // 1 week for videos

// Magic bytes signatures for file type validation
// These are the first bytes of valid files - used to verify actual content type
const MAGIC_BYTES: Record<string, { bytes: number[]; mask?: number[] }[]> = {
  "image/jpeg": [
    { bytes: [0xff, 0xd8, 0xff] }, // JPEG/JFIF
  ],
  "image/png": [
    { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }, // PNG
  ],
  "image/gif": [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  "image/webp": [
    // RIFF....WEBP - check first 4 bytes (RIFF) and bytes 8-11 (WEBP)
    { bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header (we'll also check WEBP below)
  ],
  "video/mp4": [
    // ftyp box at offset 4 (bytes 4-7 are 'ftyp')
    // Common MP4 signatures: ftypisom, ftypmp42, ftypMSNV, ftypM4V, etc.
    { bytes: [0x66, 0x74, 0x79, 0x70] }, // 'ftyp' at various offsets
  ],
  "video/webm": [
    { bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // EBML/WebM/Matroska
  ],
};

/**
 * Validates file content type by checking magic bytes
 * Returns true if the file content matches the expected MIME type
 */
function validateMagicBytes(buffer: ArrayBuffer, mimeType: string): boolean {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures) return false;

  const bytes = new Uint8Array(buffer);

  // Special handling for WebP - need to check both RIFF header and WEBP marker
  if (mimeType === "image/webp") {
    // Check RIFF header (bytes 0-3) and WEBP marker (bytes 8-11)
    const riff = [0x52, 0x49, 0x46, 0x46];
    const webp = [0x57, 0x45, 0x42, 0x50];
    if (bytes.length < 12) return false;
    const hasRiff = riff.every((b, i) => bytes[i] === b);
    const hasWebp = webp.every((b, i) => bytes[8 + i] === b);
    return hasRiff && hasWebp;
  }

  // Special handling for MP4 - ftyp can be at offset 4 or 0
  if (mimeType === "video/mp4") {
    const ftyp = [0x66, 0x74, 0x79, 0x70]; // 'ftyp'
    if (bytes.length < 12) return false;
    // Check for ftyp at offset 4 (most common)
    const hasftypAt4 = ftyp.every((b, i) => bytes[4 + i] === b);
    // Some MP4 files have ftyp at offset 0
    const hasftypAt0 = ftyp.every((b, i) => bytes[i] === b);
    return hasftypAt4 || hasftypAt0;
  }

  // Standard magic bytes check
  for (const sig of signatures) {
    if (bytes.length < sig.bytes.length) continue;

    const matches = sig.bytes.every((byte, index) => {
      if (sig.mask) {
        return (bytes[index] & sig.mask[index]) === byte;
      }
      return bytes[index] === byte;
    });

    if (matches) return true;
  }

  return false;
}

// MIME type to file extension mapping (acts as both whitelist and lookup)
const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

function getExtensionFromMimeType(mimeType: string): string | null {
  return MIME_TO_EXTENSION[mimeType] || null;
}

// Validate filename: lowercase hex ID + allowed extension, no path traversal
const VALID_MEDIA_FILENAME = /^[a-f0-9]+\.(jpg|png|gif|webp|mp4|webm)$/;

function isValidMediaFilename(filename: string): boolean {
  if (!VALID_MEDIA_FILENAME.test(filename)) return false;
  // Defense in depth: reject path traversal characters
  if (
    filename.includes("..") ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\x00")
  )
    return false;
  return true;
}

// Upload media file to R2
media.post("/upload", async (c) => {
  try {
    const actor = c.get("actor");
    if (!actor) return c.json({ error: "Unauthorized" }, 401);

    const formData = await c.req.formData();
    const file = formData.get("file") as File;
    if (!file) return c.json({ error: "No file provided" }, 400);

    const contentType = file.type;
    if (!ALLOWED_TYPES.includes(contentType)) {
      return c.json(
        { error: "Invalid file type", allowed: ALLOWED_TYPES },
        400,
      );
    }

    const isVideo = contentType.startsWith("video/");
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      const maxMB = maxSize / 1024 / 1024;
      return c.json(
        {
          error: `File too large. Maximum size is ${maxMB}MB for ${
            isVideo ? "videos" : "images"
          }`,
        },
        413,
      );
    }

    const arrayBuffer = await file.arrayBuffer();

    // Validate actual content against declared MIME type via magic bytes
    if (!validateMagicBytes(arrayBuffer, contentType)) {
      return c.json(
        {
          error: "File content does not match declared type",
          hint: "The file appears to be a different format than specified",
        },
        400,
      );
    }

    const id = generateId();
    const ext = getExtensionFromMimeType(contentType);
    // Defense in depth: reject if MIME type is somehow not in extension map
    if (!ext) return c.json({ error: "Unsupported file type" }, 400);

    const filename = `${id}.${ext}`;
    const r2Key = `uploads/${filename}`;

    const media = c.env.MEDIA;
    if (!media) {
      return c.json({ error: "Object storage unavailable" }, 503);
    }
    const r2Upload = media.put(r2Key, arrayBuffer, {
      httpMetadata: { contentType },
    });

    // Record ownership and upload to R2 in parallel
    const db = c.get("db");
    const dbRecord = db.insert(mediaUploads).values({
      id,
      r2Key,
      uploaderApId: actor.ap_id,
      contentType,
      size: file.size,
    });

    await Promise.all([r2Upload, dbRecord]);

    const url = `/media/${filename}`;

    return c.json({
      url,
      r2_key: r2Key,
      content_type: contentType,
      id,
    });
  } catch (error) {
    // Log error internally but don't expose details to client
    log.error("Media upload failed", {
      event: "media.upload.failed",
      reason: errorMessage(error),
      error,
    });
    return c.json({ error: "Upload failed" }, 500);
  }
});

type MediaAuthResult = { allowed: boolean; reason?: string; isPublic: boolean };
const DENY_AUTH_REQUIRED: MediaAuthResult = {
  allowed: false,
  reason: "Authentication required",
  isPublic: false,
};
const DENY_NOT_AUTHORIZED: MediaAuthResult = {
  allowed: false,
  reason: "Not authorized",
  isPublic: false,
};
const ALLOW_PUBLIC: MediaAuthResult = { allowed: true, isPublic: true };
const ALLOW_PRIVATE: MediaAuthResult = { allowed: true, isPublic: false };

// Check if user can access media based on associated object visibility
async function checkMediaAuthorization(
  db: Database,
  mediaUrl: string,
  currentActorApId: string | null,
  r2Key: string,
): Promise<MediaAuthResult> {
  const obj = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      visibility: objects.visibility,
      toJson: objects.toJson,
    })
    .from(objects)
    .where(
      or(
        like(objects.attachmentsJson, "%" + mediaUrl + "%"),
        like(objects.attachmentsJson, "%" + r2Key + "%"),
      ),
    )
    .get();

  // Unattached media: only the uploader may access
  if (!obj) {
    if (!currentActorApId) return DENY_AUTH_REQUIRED;

    const uploadRecord = await db
      .select()
      .from(mediaUploads)
      .where(
        and(
          eq(mediaUploads.r2Key, r2Key),
          eq(mediaUploads.uploaderApId, currentActorApId),
        ),
      )
      .get();
    return uploadRecord
      ? ALLOW_PRIVATE
      : {
          allowed: false,
          reason: "Not authorized to access this media",
          isPublic: false,
        };
  }

  if (obj.visibility === "public" || obj.visibility === "unlisted") {
    return ALLOW_PUBLIC;
  }

  // Non-public content requires authentication
  if (!currentActorApId) return DENY_AUTH_REQUIRED;

  // Author can always access their own media
  if (obj.attributedTo === currentActorApId) return ALLOW_PRIVATE;

  if (obj.visibility === "followers") {
    const follow = await db
      .select()
      .from(follows)
      .where(
        and(
          eq(follows.followerApId, currentActorApId),
          eq(follows.followingApId, obj.attributedTo),
          eq(follows.status, "accepted"),
        ),
      )
      .get();
    return follow ? ALLOW_PRIVATE : DENY_NOT_AUTHORIZED;
  }

  if (obj.visibility === "direct") {
    const recipients = safeJsonParse<string[]>(obj.toJson, []);
    return recipients.includes(currentActorApId)
      ? ALLOW_PRIVATE
      : DENY_NOT_AUTHORIZED;
  }

  // Unknown visibility - deny by default
  return DENY_NOT_AUTHORIZED;
}

async function serveMediaByR2Key(c: MediaContext, r2Key: string) {
  try {
    if (!r2Key.startsWith("uploads/")) return c.notFound();
    const filename = r2Key.slice("uploads/".length);
    if (!filename || !isValidMediaFilename(filename)) return c.notFound();

    const mediaUrl = `/media/${filename}`;

    // Defense in depth: ensure resolved path stays within uploads/
    if (!r2Key.startsWith("uploads/") || r2Key.includes("..")) {
      return c.notFound();
    }

    const actor = c.get("actor");
    const db = c.get("db");
    const authResult = await checkMediaAuthorization(
      db,
      mediaUrl,
      actor?.ap_id || null,
      r2Key,
    );
    if (!authResult.allowed) {
      return c.json({ error: authResult.reason || "Forbidden" }, 403);
    }

    const media = c.env.MEDIA;
    if (!media) {
      return c.json({ error: "Object storage unavailable" }, 503);
    }
    const object = await media.get(r2Key);
    if (!object) return c.notFound();

    const contentType =
      object.httpMetadata?.contentType || "application/octet-stream";
    const cacheScope = authResult.isPublic ? "public" : "private";
    const maxAge = contentType.startsWith("video/")
      ? CACHE_MAX_AGE_VIDEO
      : CACHE_MAX_AGE_IMAGE;
    const etag = object.httpEtag;

    if (!object.body) {
      return c.body(null, 200, {
        "Content-Type": contentType,
        "Cache-Control": `${cacheScope}, max-age=${maxAge}`,
        ...(etag ? { ETag: etag } : {}),
      });
    }
    return c.body(object.body, 200, {
      "Content-Type": contentType,
      "Cache-Control": `${cacheScope}, max-age=${maxAge}`,
      ...(etag ? { ETag: etag } : {}),
    });
  } catch (error) {
    log.error("Media fetch failed", {
      event: "media.fetch.failed",
      reason: errorMessage(error),
      error,
    });
    return c.json({ error: "Failed to fetch media" }, 500);
  }
}

// Serve media files from R2 with cache headers.
media.get("/:id", async (c) => {
  const id = c.req.param("id");
  return serveMediaByR2Key(c, `uploads/${id}`);
});

export default media;
