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
    // Log error internally but don't expose details to client
    console.error('Media upload failed:', error instanceof Error ? error.message : 'Unknown error');
    return c.json({ error: 'Upload failed' }, 500);
  }
});

// Check if user can access media based on associated object visibility
async function checkMediaAuthorization(
  prisma: PrismaClient,
  mediaUrl: string,
  currentActorApId: string | null
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
  // For security, require authentication for unattached media
  if (!obj) {
    // Media not attached to any object - require authentication as a precaution
    // This handles newly uploaded media that hasn't been attached to a post yet
    if (!currentActorApId) {
      return { allowed: false, reason: 'Authentication required' };
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

    // Extract file extension from id (e.g., "abc123.jpg")
    const match = id.match(/^([a-f0-9]+)\.(jpg|png|gif|webp|mp4|webm|bin)$/);
    if (!match) {
      return c.notFound();
    }

    // Authorization check
    const actor = c.get('actor');
    const prisma = c.get('prisma');
    const mediaUrl = `/media/${id}`;
    const authResult = await checkMediaAuthorization(
      prisma,
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
