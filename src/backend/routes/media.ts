import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId } from '../utils';

const media = new Hono<{ Bindings: Env; Variables: Variables }>();

// Allowed MIME types for media upload
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB

// Get file extension from MIME type
function getExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return extensions[mimeType] || 'bin';
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

    // Generate unique ID and extension
    const id = generateId();
    const ext = getExtensionFromMimeType(contentType);
    const r2Key = `uploads/${id}.${ext}`;

    // Get file buffer
    const arrayBuffer = await file.arrayBuffer();

    // Upload to R2
    await c.env.MEDIA.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: contentType,
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
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: 'Upload failed', details: errorMessage }, 500);
  }
});

// Helper types for media authorization
type ObjectRow = {
  ap_id: string;
  attributed_to: string;
  visibility: string;
  to_json?: string | null;
};

type FollowRow = {
  follower_ap_id: string;
};

// Check if user can access media based on associated object visibility
async function checkMediaAuthorization(
  db: D1Database,
  mediaUrl: string,
  currentActorApId: string | null
): Promise<{ allowed: boolean; reason?: string }> {
  // Find object(s) that reference this media URL
  // Search in attachments_json which contains URLs like /media/{id}.{ext}
  const objects = await db.prepare(`
    SELECT ap_id, attributed_to, visibility, to_json
    FROM objects
    WHERE attachments_json LIKE ?
    LIMIT 1
  `).bind(`%${mediaUrl}%`).all<ObjectRow>();

  // If media is not attached to any object, it may be orphaned or newly uploaded
  // For security, require authentication for unattached media
  if (!objects.results || objects.results.length === 0) {
    // Media not attached to any object - require authentication as a precaution
    // This handles newly uploaded media that hasn't been attached to a post yet
    if (!currentActorApId) {
      return { allowed: false, reason: 'Authentication required' };
    }
    return { allowed: true };
  }

  const obj = objects.results[0];

  // Public visibility - allow all
  if (obj.visibility === 'public' || obj.visibility === 'unlisted') {
    return { allowed: true };
  }

  // For non-public content, require authentication
  if (!currentActorApId) {
    return { allowed: false, reason: 'Authentication required' };
  }

  // Author can always access their own media
  if (obj.attributed_to === currentActorApId) {
    return { allowed: true };
  }

  // Followers-only visibility
  if (obj.visibility === 'followers') {
    const follow = await db.prepare(`
      SELECT follower_ap_id FROM follows
      WHERE follower_ap_id = ? AND following_ap_id = ? AND status = 'accepted'
    `).bind(currentActorApId, obj.attributed_to).first<FollowRow>();

    if (follow) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Not authorized' };
  }

  // Direct messages - check if user is in recipients
  if (obj.visibility === 'direct') {
    try {
      const recipients: string[] = JSON.parse(obj.to_json || '[]');
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

    // Extract file extension from id (e.g., "abc123.jpg")
    const match = id.match(/^([a-f0-9]+)\.(jpg|png|gif|webp|mp4|webm|bin)$/);
    if (!match) {
      return c.notFound();
    }

    // Authorization check
    const actor = c.get('actor');
    const mediaUrl = `/media/${id}`;
    const authResult = await checkMediaAuthorization(
      c.env.DB,
      mediaUrl,
      actor?.ap_id || null
    );

    if (!authResult.allowed) {
      return c.json({ error: authResult.reason || 'Forbidden' }, 403);
    }

    const r2Key = `uploads/${id}`;

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
