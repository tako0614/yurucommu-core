import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';
import type { Env, LocalUser } from './types';
import { getSession, getSessionIdFromCookie, deleteSession, clearSessionCookie } from './services/session';
import { processOutboxQueue } from './services/activitypub/activities';
import platform from './routes/platform';
import activitypub from './routes/activitypub';
import api from './routes/api';

type Variables = {
  user?: LocalUser;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

function isAllowedOrigin(origin: string, hostname: string): boolean {
  if (origin === `https://${hostname}`) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
    return true;
  }
  return false;
}

// CORS
app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return null;
    const hostname = c.env.HOSTNAME || new URL(c.req.url).hostname;
    return isAllowedOrigin(origin, hostname) ? origin : null;
  },
  credentials: true,
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Platform Protocol routes (public)
app.route('/_platform', platform);

// ActivityPub routes (public)
app.route('/', activitypub);

// Auth middleware for protected API routes
const requireAuth = async (c: any, next: any) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie'));
  if (!sessionId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const session = await getSession(c.env, sessionId);
  if (!session) {
    return c.json({ error: 'Session expired' }, 401);
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM local_users WHERE id = ?'
  ).bind(session.user_id).first<LocalUser>();

  if (!user) {
    return c.json({ error: 'User not found' }, 401);
  }

  c.set('user', user);
  await next();
};

// Optional auth (for setup endpoint)
const optionalAuth = async (c: any, next: any) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie'));
  if (sessionId) {
    const session = await getSession(c.env, sessionId);
    if (session) {
      const user = await c.env.DB.prepare(
        'SELECT * FROM local_users WHERE id = ?'
      ).bind(session.user_id).first<LocalUser>();
      if (user) {
        c.set('user', user);
      }
    }
  }
  await next();
};

// Logout
app.post('/api/logout', async (c) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie'));
  if (sessionId) {
    await deleteSession(c.env, sessionId);
  }
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
});

// Setup endpoint (no auth required, but only works once)
app.post('/api/setup', optionalAuth, async (c, next) => {
  // Forward to api router
  const apiRouter = new Hono<{ Bindings: Env; Variables: Variables }>();
  apiRouter.route('/', api);
  return apiRouter.fetch(new Request(c.req.url, c.req.raw), c.env);
});

// Protected API routes
app.use('/api/*', requireAuth);
app.route('/api', api);

  // Media serving from R2
  app.get('/media/:filename', async (c) => {
    const filename = c.req.param('filename');
    if (!/^[a-f0-9]{32}\.[a-z0-9]+$/i.test(filename)) {
      return c.notFound();
    }

    // Find the file in R2 (search in all user directories)
    const mediaId = filename.split('.')[0];
    const directKey = `media/${filename}`;
    let mapping: { r2_key: string } | null = null;
    try {
      mapping = await c.env.DB.prepare(
        `SELECT r2_key FROM media_files WHERE id = ?`
      ).bind(mediaId).first<{ r2_key: string }>();
    } catch (error) {
      console.warn('media_files lookup failed:', error);
    }
    let object = mapping ? await c.env.MEDIA.get(mapping.r2_key) : null;

    if (!object) {
      object = await c.env.MEDIA.get(directKey);
      if (object) {
        const contentType = object.httpMetadata?.contentType || null;
        try {
          await c.env.DB.prepare(
            `INSERT OR REPLACE INTO media_files (id, r2_key, content_type, created_at)
             VALUES (?, ?, ?, datetime('now'))`
          ).bind(mediaId, directKey, contentType).run();
        } catch (error) {
          console.warn('media_files insert failed:', error);
        }
      }
    }

    if (!object) {
      // Legacy lookup for older uploads stored under media/<userId>/...
      const objects = await c.env.MEDIA.list({ prefix: 'media/' });
      let targetKey: string | null = null;

      for (const obj of objects.objects) {
        if (obj.key.endsWith(`/${filename}`)) {
          targetKey = obj.key;
          break;
        }
      }

      if (!targetKey) {
        return c.notFound();
      }

      object = await c.env.MEDIA.get(targetKey);
      if (object) {
        const contentType = object.httpMetadata?.contentType || null;
        try {
          await c.env.DB.prepare(
            `INSERT OR REPLACE INTO media_files (id, r2_key, content_type, created_at)
             VALUES (?, ?, ?, datetime('now'))`
          ).bind(mediaId, targetKey, contentType).run();
        } catch (error) {
          console.warn('media_files insert failed:', error);
        }
      }
    }

  if (!object) {
    return c.notFound();
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Cache-Control', 'public, max-age=31536000');

  return new Response(object.body, { headers });
});

// Profile page (public)
app.get('/@:username', async (c) => {
  const username = c.req.param('username');

  const user = await c.env.DB.prepare(
    `SELECT * FROM local_users WHERE username = ?`
  ).bind(username).first<LocalUser>();

  if (!user) {
    return c.notFound();
  }

  // Serve SPA for profile pages
  // The frontend will fetch the user data via API
  return serveStatic({ path: './index.html' })(c, async () => {});
});

// Post page (public, for ActivityPub)
app.get('/posts/:id', async (c) => {
  const postId = c.req.param('id');
  const accept = c.req.header('Accept') || '';

  const post = await c.env.DB.prepare(
    `SELECT p.*, u.username FROM posts p JOIN local_users u ON p.user_id = u.id WHERE p.id = ?`
  ).bind(postId).first<{ id: string; content: string; published_at: string; username: string; content_warning: string | null }>();

  if (!post) {
    return c.notFound();
  }

  // Return ActivityPub object for AP clients
  if (accept.includes('application/activity+json') || accept.includes('application/ld+json')) {
    const hostname = c.env.HOSTNAME || new URL(c.req.url).host;
    const actorUrl = `https://${hostname}/users/${post.username}`;
    const postUrl = `https://${hostname}/posts/${postId}`;

    const note: Record<string, unknown> = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: postUrl,
      type: 'Note',
      content: post.content,
      published: post.published_at,
      attributedTo: actorUrl,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${actorUrl}/followers`],
    };

    if (post.content_warning) {
      note.summary = post.content_warning;
    }

    return c.json(note, 200, {
      'Content-Type': 'application/activity+json',
    });
  }

  // Serve SPA for browsers
  return serveStatic({ path: './index.html' })(c, async () => {});
});

// Serve static files
app.get('/assets/*', serveStatic());

// SPA fallback
app.get('*', serveStatic({ path: './index.html' }));

// 404 handler
app.notFound((c) => {
  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json') || accept.includes('application/activity+json')) {
    return c.json({ error: 'Not Found' }, 404);
  }
  return serveStatic({ path: './index.html' })(c, async () => {});
});

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

async function runOutbox(env: Env): Promise<void> {
  if (!env.HOSTNAME) return;
  const localUser = await env.DB.prepare(
    `SELECT * FROM local_users LIMIT 1`
  ).first<LocalUser>();
  if (!localUser) return;
  await processOutboxQueue(env, localUser, env.HOSTNAME);
}

export default {
  fetch: app.fetch,
  scheduled: (event: ScheduledEvent, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(runOutbox(env));
  },
};
