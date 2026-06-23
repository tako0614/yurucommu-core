import { type Context, Hono } from "hono";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import type { Database } from "../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  follows,
  mediaUploads,
  objects,
} from "../../db/index.ts";
import { generateId, safeJsonParse } from "../federation-helpers.ts";
import { canViewerReadObject } from "../lib/community-visibility.ts";
import { stripImageMetadata } from "../lib/strip-image-metadata.ts";
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

// Limits are chosen to stay within the Cloudflare Workers ~128MB memory budget.
// The upload path reads only a small header slice into memory for magic-byte
// validation and streams the body straight to R2 (no full-file ArrayBuffer), so
// the dominant cost is `c.req.formData()` materializing the multipart field.
// We keep video at 40MB so that even a transient full-buffer (~40MB) plus
// multipart/runtime overhead stays comfortably under budget on large uploads.
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 40 * 1024 * 1024; // 40MB (was 100MB; lowered to fit Worker memory budget)

// Number of leading bytes to read for magic-byte validation. All supported
// signatures (incl. WebP RIFF/WEBP at offset 8-11 and MP4 ftyp at offset 4-7)
// are decided within the first 12 bytes; read a small slice for headroom.
const MAGIC_BYTES_HEADER_LEN = 64;

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

    // Parse multipart in its own try so a non-multipart / malformed body is a
    // 400, not a 500 from the outer catch.
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ error: "Invalid multipart form data" }, 400);
    }
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

    // Read only the leading header bytes for magic-byte validation instead of
    // buffering the entire file into Worker memory. This avoids the ~2x
    // (formData + arrayBuffer) memory blow-up that risked OOM on large uploads.
    const headerBuffer = await file
      .slice(0, MAGIC_BYTES_HEADER_LEN)
      .arrayBuffer();

    // Validate actual content against declared MIME type via magic bytes
    if (!validateMagicBytes(headerBuffer, contentType)) {
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
    // Images: buffer the (size-capped, <=20MB) bytes and STRIP privacy metadata
    // (EXIF GPS / timestamp / camera serial, IPTC, XMP) before storing — these
    // are served verbatim under a 1-year public cache, so an unstripped geotag
    // would leak the poster's location. Pixels are untouched (byte-surgery, no
    // re-encode). Videos stay STREAMED: metadata stripping there needs a
    // transcode pipeline, and buffering a 40MB video would pressure the Worker
    // memory budget.
    if (isVideo) {
      await media.put(r2Key, file.stream(), {
        httpMetadata: { contentType },
      });
    } else {
      const original = new Uint8Array(await file.arrayBuffer());
      const cleaned = stripImageMetadata(original, contentType);
      // Hand R2 a tightly-sized ArrayBuffer (the strip may return a view over a
      // larger backing buffer, or the original `file` buffer on pass-through).
      const cleanedBuffer = cleaned.buffer.slice(
        cleaned.byteOffset,
        cleaned.byteOffset + cleaned.byteLength,
      ) as ArrayBuffer;
      await media.put(r2Key, cleanedBuffer, {
        httpMetadata: { contentType },
      });
    }

    // Record ownership AFTER the blob lands. If the DB write fails, delete the
    // now-unreferenced blob: the media GC reaps R2 by iterating media_uploads
    // rows, so a blob with NO DB record can never be reaped and would leak
    // forever. (Previously the put + insert ran in Promise.all, so a DB failure
    // while the put succeeded orphaned the blob.)
    const db = c.get("db");
    try {
      await db.insert(mediaUploads).values({
        id,
        r2Key,
        uploaderApId: actor.ap_id,
        contentType,
        size: file.size,
      });
    } catch (dbError) {
      await media.delete(r2Key).catch(() => {});
      throw dbError;
    }

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

type ReferencingObject = {
  apId: string;
  type: string;
  attributedTo: string;
  visibility: string;
  toJson: string;
  communityApId: string | null;
  endTime: string | null;
};

// Locate the object that attached this media using ONLY indexed lookups.
//
// Media is uploaded by an actor (media_uploads.uploader_ap_id, indexed) and
// then attached to that actor's own object. The referencing object is found by
// scanning that uploader's objects (objects.attributed_to, indexed) and
// substring-matching the media reference in application code — instead of a
// leading-wildcard LIKE over the full objects table, which is unindexable and
// scans every row on every GET /media/:id.
//
// `r2Key` is the unique, indexed media identity (media_uploads_r2_key_idx); the
// uploaderApId comes from that record. The author-scoped object set is small and
// served by objects_attributed_to_idx.
function attachmentMatches(
  attachmentsJson: string,
  mediaUrl: string,
  r2Key: string,
): boolean {
  // Same substring semantics as the previous LIKE("%...%") match, evaluated in
  // app code over the candidate (already indexed-narrowed) rows.
  return attachmentsJson.includes(mediaUrl) || attachmentsJson.includes(r2Key);
}

async function findReferencingObject(
  db: Database,
  uploaderApId: string,
  mediaUrl: string,
  r2Key: string,
): Promise<ReferencingObject | null> {
  // Push the substring match into SQL (LIKE) instead of materializing EVERY
  // object the uploader has ever authored and substring-matching each in app
  // code. A prolific uploader has thousands of objects, almost none of which
  // reference this media; the old `eq(attributedTo).all()` loaded all of their
  // attachmentsJson per media request. The LIKE narrows to the (usually 0-1)
  // rows that actually contain the URL/key, gated by the indexed attributedTo.
  // Substring-match in SQL via `instr()` (not `LIKE '%needle%'`), gated by the
  // indexed attributed_to. `attachmentMatches` re-checks every survivor EXACTLY,
  // so this only needs to narrow. Why instr() and not LIKE: a `%<64-char r2 key>%`
  // LIKE pattern trips D1's "LIKE or GLOB pattern too complex" limit
  // (SQLITE_ERROR 7500), which 500'd EVERY media fetch since the SQL-match
  // optimization landed (~commit d9f0823f). instr() is a plain literal substring
  // search — no wildcards, no escaping, no pattern-complexity limit.
  const candidates = await db
    .select({
      apId: objects.apId,
      type: objects.type,
      attributedTo: objects.attributedTo,
      visibility: objects.visibility,
      toJson: objects.toJson,
      communityApId: objects.communityApId,
      endTime: objects.endTime,
      attachmentsJson: objects.attachmentsJson,
    })
    .from(objects)
    .where(
      and(
        eq(objects.attributedTo, uploaderApId),
        or(
          sql`instr(${objects.attachmentsJson}, ${mediaUrl}) > 0`,
          sql`instr(${objects.attachmentsJson}, ${r2Key}) > 0`,
        ),
      ),
    )
    .all();

  for (const row of candidates) {
    if (attachmentMatches(row.attachmentsJson, mediaUrl, r2Key)) {
      return {
        apId: row.apId,
        type: row.type,
        attributedTo: row.attributedTo,
        visibility: row.visibility,
        toJson: row.toJson,
        communityApId: row.communityApId,
        endTime: row.endTime,
      };
    }
  }
  return null;
}

// Check if user can access media based on associated object visibility
async function checkMediaAuthorization(
  db: Database,
  mediaUrl: string,
  currentActorApId: string | null,
  r2Key: string,
): Promise<MediaAuthResult> {
  // Resolve media identity by its unique, indexed r2Key (media_uploads_r2_key_idx).
  const uploadRecord = await db
    .select({ uploaderApId: mediaUploads.uploaderApId })
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, r2Key))
    .get();

  // Profile media (an actor's icon / header) is not attached to any object, yet
  // it is part of the public actor document served to anyone — including
  // unauthenticated federation peers fetching /ap/users/:name. So media that the
  // uploader references as their own avatar/header is world-readable. Scoped to
  // the uploader's own indexed actor row (you can only set your own profile).
  //
  // Checked BEFORE findReferencingObject: an avatar/header is the hot public
  // path (every federation peer rendering the actor) and references no object,
  // so resolving it here short-circuits the object scan entirely.
  if (uploadRecord) {
    const profileRef = await db
      .select({ apId: actors.apId })
      .from(actors)
      .where(
        and(
          eq(actors.apId, uploadRecord.uploaderApId),
          or(eq(actors.iconUrl, mediaUrl), eq(actors.headerUrl, mediaUrl)),
        ),
      )
      .get();
    if (profileRef) return ALLOW_PUBLIC;

    // Community icon set via a local /media upload. Unlike an actor avatar it is
    // stored on the `communities` table (not an actors row) and is attached to
    // no object, so without this branch it falls through to the uploader-only
    // `!obj` deny below — every community avatar would 401/403 for federation
    // peers and non-uploader members (broken image), even though the Group actor
    // document at /ap/groups/:name publishes a PUBLIC community's icon to anyone.
    // A PUBLIC community's icon is world-readable; a PRIVATE community's stays
    // members-only (mirrors the Group-doc / community-post gates).
    const communityRef = await db
      .select({
        visibility: communities.visibility,
        apId: communities.apId,
        createdBy: communities.createdBy,
      })
      .from(communities)
      .where(
        and(eq(communities.iconUrl, mediaUrl), isNull(communities.deletedAt)),
      )
      .get();
    // Bind the icon reference to the blob's uploader, the same way the actor
    // avatar branch is scoped to the uploader's own actor row. An iconUrl is an
    // attacker-controllable cosmetic string: any user can point THEIR public
    // community's icon at a victim's PRIVATE blob. Without this binding that
    // alone would serve the victim's private media as world-readable (cross-user
    // media IDOR). Only honor the icon branch when the uploader controls this
    // community (its creator or a current member, the analog of "you can only
    // set your own profile"); otherwise the reference proves nothing and we fall
    // through to the real per-attachment / uploader-only gates below.
    if (communityRef) {
      const uploaderControlsCommunity =
        communityRef.createdBy === uploadRecord.uploaderApId ||
        !!(await db
          .select({ actorApId: communityMembers.actorApId })
          .from(communityMembers)
          .where(
            and(
              eq(communityMembers.communityApId, communityRef.apId),
              eq(communityMembers.actorApId, uploadRecord.uploaderApId),
            ),
          )
          .get());
      if (uploaderControlsCommunity) {
        if (communityRef.visibility === "public") return ALLOW_PUBLIC;
        const allowed = await canViewerReadObject(
          db,
          { communityApId: communityRef.apId },
          currentActorApId,
        );
        if (allowed) return ALLOW_PRIVATE;
        return currentActorApId ? DENY_NOT_AUTHORIZED : DENY_AUTH_REQUIRED;
      }
    }
  }

  const obj = uploadRecord
    ? await findReferencingObject(
        db,
        uploadRecord.uploaderApId,
        mediaUrl,
        r2Key,
      )
    : null;

  // Unattached media (no upload record, or no referencing object found): only
  // the uploader may access. Authorize against the indexed media_uploads row.
  if (!obj) {
    if (!currentActorApId) return DENY_AUTH_REQUIRED;

    const isUploader = !!(
      uploadRecord && uploadRecord.uploaderApId === currentActorApId
    );
    return isUploader
      ? ALLOW_PRIVATE
      : {
          allowed: false,
          reason: "Not authorized to access this media",
          isPublic: false,
        };
  }

  // Author can always access their own media (even after leaving a community).
  if (currentActorApId && obj.attributedTo === currentActorApId) {
    return ALLOW_PRIVATE;
  }

  // Stories are ephemeral (24h endTime). Once expired, the blob must not be
  // served to anyone but the author (handled just above) — mirror the feed /
  // single-object gates (gt(endTime, now)) so the media lifetime matches the
  // content lifetime instead of lingering until the best-effort reap fires.
  if (
    obj.type === "Story" &&
    obj.endTime &&
    obj.endTime <= new Date().toISOString()
  ) {
    return currentActorApId ? DENY_NOT_AUTHORIZED : DENY_AUTH_REQUIRED;
  }

  // Community-scoped media (a Story / community post is stored
  // `visibility = "public"` but addressed to a community): a PRIVATE community's
  // blob must stay members-only, so the world-readable `ALLOW_PUBLIC` below
  // would leak it. `canViewerReadObject` short-circuits to true for
  // public / non-community objects (never widening access) and gates a private
  // community on membership. Served PRIVATE (no shared cache) so a
  // member-fetched private blob is never replayed to a non-member from CDN cache.
  if (obj.communityApId) {
    const allowed = await canViewerReadObject(
      db,
      { communityApId: obj.communityApId },
      currentActorApId,
    );
    if (!allowed) {
      return currentActorApId ? DENY_NOT_AUTHORIZED : DENY_AUTH_REQUIRED;
    }
    // Community membership is necessary but NOT sufficient: a community post
    // created with visibility=followers/direct must ALSO pass that per-post gate
    // so this blob matches the post-detail / outbox / feed gates (which all
    // follower-gate such a post). Public / unlisted / Story community posts are
    // member-readable; followers/direct fall through to the gates below.
    if (obj.visibility !== "followers" && obj.visibility !== "direct") {
      return ALLOW_PRIVATE;
    }
  }

  // A personal Story is stored visibility="public" but its REACH is the author's
  // followers (addressed to=<actor>/followers; it only surfaces in followers'
  // story feed). The public short-circuit below would make its media blob
  // world-readable to anyone with the URL, so gate it on follower status like a
  // followers-only post. (Community stories were gated by the branch above; the
  // author by the branch above that.)
  if (obj.type === "Story") {
    if (!currentActorApId) return DENY_AUTH_REQUIRED;
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

  if (obj.visibility === "public" || obj.visibility === "unlisted") {
    return ALLOW_PUBLIC;
  }

  // Non-public content requires authentication
  if (!currentActorApId) return DENY_AUTH_REQUIRED;

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
      // Never cache an authorization denial: media URLs are content-addressed
      // and long-lived, but who may read one changes over time (a follow is
      // accepted, a profile sets the image as its public avatar). A cached 403
      // on the immutable URL would otherwise mask the later-granted access.
      c.header("Cache-Control", "no-store");
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
