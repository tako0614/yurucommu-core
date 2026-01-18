import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import type { PrismaClient } from '../../generated/prisma';
import { generateId } from '../utils';

const media = new Hono<{ Bindings: Env; Variables: Variables }>();

// Allowed MIME types for media upload
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

// Magic bytes signatures for file type validation
// These are the first bytes of valid files - used to verify actual content type
const MAGIC_BYTES: Record<string, { bytes: number[]; mask?: number[] }[]> = {
  'image/jpeg': [
    { bytes: [0xFF, 0xD8, 0xFF] }, // JPEG/JFIF
  ],
  'image/png': [
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }, // PNG
  ],
  'image/gif': [
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }, // GIF87a
    { bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }, // GIF89a
  ],
  'image/webp': [
    // RIFF....WEBP - check first 4 bytes (RIFF) and bytes 8-11 (WEBP)
    { bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF header (we'll also check WEBP below)
  ],
  'video/mp4': [
    // ftyp box at offset 4 (bytes 4-7 are 'ftyp')
    // Common MP4 signatures: ftypisom, ftypmp42, ftypMSNV, ftypM4V, etc.
    { bytes: [0x66, 0x74, 0x79, 0x70] }, // 'ftyp' at various offsets
  ],
  'video/webm': [
    { bytes: [0x1A, 0x45, 0xDF, 0xA3] }, // EBML/WebM/Matroska
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
  if (mimeType === 'image/webp') {
    // Check RIFF header (bytes 0-3) and WEBP marker (bytes 8-11)
    const riff = [0x52, 0x49, 0x46, 0x46];
    const webp = [0x57, 0x45, 0x42, 0x50];
    if (bytes.length < 12) return false;
    const hasRiff = riff.every((b, i) => bytes[i] === b);
    const hasWebp = webp.every((b, i) => bytes[8 + i] === b);
    return hasRiff && hasWebp;
  }

  // Special handling for MP4 - ftyp can be at offset 4 or 0
  if (mimeType === 'video/mp4') {
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

// Allowed file extensions (whitelist - no .bin for security)
const ALLOWED_EXTENSIONS = ['jpg', 'png', 'gif', 'webp', 'mp4', 'webm'] as const;
type AllowedExtension = typeof ALLOWED_EXTENSIONS[number];

// Get file extension from MIME type (returns null for unsupported types)
function getExtensionFromMimeType(mimeType: string): AllowedExtension | null {
  const extensions: Record<string, AllowedExtension> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return extensions[mimeType] || null;
}

// Validate filename to prevent path traversal and ensure only allowed extensions
function isValidMediaFilename(filename: string): boolean {
  // Must be: lowercase hex ID + . + allowed extension
  // Pattern: only lowercase hex chars for ID, followed by dot, followed by allowed extension
  const pattern = /^[a-f0-9]+\.(jpg|png|gif|webp|mp4|webm)$/;
  if (!pattern.test(filename)) {
    return false;
  }

  // Additional path traversal checks (defense in depth)
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\') || filename.includes('\x00')) {
    return false;
  }

  return true;
}

// POST /api/media/upload - Upload media file to R2
media.post('/upload', async (c) => {
  try {
    const actor = c.get('actor');
    if (!actor) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    const contentType = file.type;

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(contentType)) {
      return c.json({
        error: 'Invalid file type',
        allowed: ALLOWED_TYPES,
      }, 400);
    }

    // Check file size based on content type
    const isVideo = contentType.startsWith('video/');
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;

    if (file.size > maxSize) {
      const maxMB = maxSize / 1024 / 1024;
      return c.json({
        error: `File too large. Maximum size is ${maxMB}MB for ${isVideo ? 'videos' : 'images'}`
      }, 413);
    }

    // Get file buffer
    const arrayBuffer = await file.arrayBuffer();

    // Validate actual file content using magic bytes
    // Don't trust the client-provided Content-Type header
    if (!validateMagicBytes(arrayBuffer, contentType)) {
      return c.json({
        error: 'File content does not match declared type',
        hint: 'The file appears to be a different format than specified',
      }, 400);
    }

    // Generate unique ID and extension
    const id = generateId();
    const ext = getExtensionFromMimeType(contentType);

    // Security: Reject unsupported MIME types (should never happen after ALLOWED_TYPES check, but defense in depth)
    if (!ext) {
      return c.json({ error: 'Unsupported file type' }, 400);
    }

    const r2Key = `uploads/${id}.${ext}`;

    // Upload to R2
    await c.env.MEDIA.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: contentType,
      },
    });

    // Record the upload for ownership tracking (security fix)
    const prisma = c.get('prisma');
    await prisma.mediaUpload.create({
      data: {
        id,
        r2Key,
        uploaderApId: actor.ap_id,
        contentType,
        size: file.size,
      },
    });

    // Generate public URL (assumes R2 public bucket or custom domain)
    const url = `/media/${id}.${ext}`;

    return c.json({
      url,
      r2_key: r2Key,
      content_type: contentType,
      id,
    });
  } catch (error) {
    // Log error internally but don't expose details to client
    console.error('Media upload failed:', error instanceof Error ? error.message : 'Unknown error');
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// Check if user can access media based on associated object visibility
async function checkMediaAuthorization(
  prisma: PrismaClient,
  mediaUrl: string,
  currentActorApId: string | null,
  r2Key: string
): Promise<{ allowed: boolean; reason?: string }> {
  // Find object(s) that reference this media URL
  // Search in attachmentsJson which contains URLs like /media/{id}.{ext}
  const obj = await prisma.object.findFirst({
    where: {
      attachmentsJson: {
        contains: mediaUrl,
      },
    },
    select: {
      apId: true,
      attributedTo: true,
      visibility: true,
      toJson: true,
    },
  });

  // If media is not attached to any object, it may be orphaned or newly uploaded
  // SECURITY FIX: Only allow the uploader to access their own unattached media
  if (!obj) {
    // Media not attached to any object - require authentication
    if (!currentActorApId) {
      return { allowed: false, reason: 'Authentication required' };
    }

    // Check if this user uploaded the media by looking up the upload record
    const uploadRecord = await prisma.mediaUpload.findFirst({
      where: {
        r2Key: r2Key,
        uploaderApId: currentActorApId,
      },
    });

    if (!uploadRecord) {
      // User is not the uploader of this unattached media
      return { allowed: false, reason: 'Not authorized to access this media' };
    }

    return { allowed: true };
  }

  // Public visibility - allow all
  if (obj.visibility === 'public' || obj.visibility === 'unlisted') {
    return { allowed: true };
  }

  // For non-public content, require authentication
  if (!currentActorApId) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // Author can always access their own media
  if (obj.attributedTo === currentActorApId) {
    return { allowed: true };
  }

  // Followers-only visibility
  if (obj.visibility === 'followers') {
    const follow = await prisma.follow.findUnique({
      where: {
        followerApId_followingApId: {
          followerApId: currentActorApId,
          followingApId: obj.attributedTo,
        },
        status: 'accepted',
      },
    });

    if (follow) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Not authorized' };
  }

  // Direct messages - check if user is in recipients
  if (obj.visibility === 'direct') {
    try {
      const recipients: string[] = JSON.parse(obj.toJson || '[]');
      if (recipients.includes(currentActorApId)) {
        return { allowed: true };
      }
    } catch {
      // Invalid JSON, deny access
    }
    return { allowed: false, reason: 'Not authorized' };
  }

  // Unknown visibility - deny by default
  return { allowed: false, reason: 'Not authorized' };
}

// GET /media/* - Serve media files from R2 with cache headers
media.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    if (!id) {
      return c.notFound();
    }

    // Security: Validate filename format and prevent path traversal
    // Only allow: lowercase hex ID + . + allowed extension (no .bin)
    if (!isValidMediaFilename(id)) {
      return c.notFound();
    }

    // Additional security: Ensure the resolved path stays within uploads directory
    const r2Key = `uploads/${id}`;

    // Verify the key doesn't escape the uploads directory (defense in depth)
    if (!r2Key.startsWith('uploads/') || r2Key.includes('..')) {
      return c.notFound();
    }

    // Authorization check
    const actor = c.get('actor');
    const prisma = c.get('prisma');
    const mediaUrl = `/media/${id}`;
    const authResult = await checkMediaAuthorization(
      prisma,
      mediaUrl,
      actor?.ap_id || null,
      r2Key
    );

    if (!authResult.allowed) {
      return c.json({ error: authResult.reason || 'Forbidden' }, 403);
    }

    // Fetch from R2
    const object = await c.env.MEDIA.get(r2Key);

    if (!object) {
      return c.notFound();
    }

    // Get content type from metadata
    const contentType = object.httpMetadata?.contentType || 'application/octet-stream';

    // Determine cache duration based on content type and visibility
    // Private content should have shorter cache and private cache control
    let cacheControl = 'public, max-age=31536000'; // 1 year for immutable content
    if (contentType.startsWith('video/')) {
      cacheControl = 'public, max-age=604800'; // 1 week for videos
    }

    // Return file with cache headers
    return c.body(object.body, 200, {
      'Content-Type': contentType,
      'Cache-Control': cacheControl,
      'ETag': object.httpMetadata?.contentType || 'true',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Failed to fetch media', details: errorMessage }, 500);
  }
});

export default media;
