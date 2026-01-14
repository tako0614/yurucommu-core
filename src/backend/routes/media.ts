import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId } from '../utils';

const media = new Hono<{ Bindings: Env; Variables: Variables }>();

// Allowed MIME types for media upload
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];

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

    // Check file size (limit to 100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      return c.json({ error: 'File too large (max 100MB)' }, 400);
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

    const r2Key = `uploads/${id}`;

    // Fetch from R2
    const object = await c.env.MEDIA.get(r2Key);

    if (!object) {
      return c.notFound();
    }

    // Get content type from metadata
    const contentType = object.httpMetadata?.contentType || 'application/octet-stream';

    // Determine cache duration based on content type
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
