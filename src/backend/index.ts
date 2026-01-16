import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, Variables, Actor } from './types';

// Import route modules
import authRoutes from './routes/auth';
import actorsRoutes from './routes/actors';
import followRoutes from './routes/follow';
import timelineRoutes from './routes/timeline';
import postsRoutes from './routes/posts';
import notificationsRoutes from './routes/notifications';
import storiesRoutes from './routes/stories';
import searchRoutes from './routes/search';
import communitiesRoutes from './routes/communities';
import dmRoutes from './routes/dm';
import mediaRoutes from './routes/media';
import activitypubRoutes from './routes/activitypub';

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================================
// COOP/COEP HEADERS (Required for FFmpeg WASM SharedArrayBuffer)
// ============================================================

app.use('*', async (c, next) => {
  await next();
  // These headers enable SharedArrayBuffer for FFmpeg WASM
  // Using 'credentialless' instead of 'require-corp' to allow cross-origin resources
  c.header('Cross-Origin-Opener-Policy', 'same-origin');
  c.header('Cross-Origin-Embedder-Policy', 'credentialless');
});

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

app.use('/api/*', async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    // Sessions now store actor ap_id in member_id column (legacy compatibility)
    const session = await c.env.DB.prepare(
      `SELECT s.*, a.* FROM sessions s
       JOIN actors a ON s.member_id = a.ap_id
       WHERE s.id = ? AND s.expires_at > datetime('now')`
    ).bind(sessionId).first<any>();

    if (session) {
      c.set('actor', session as Actor);
    }
  }
  await next();
});

// ============================================================
// MOUNT ROUTES
// ============================================================

// Auth routes
app.route('/api/auth', authRoutes);

// Actor/Profile routes
app.route('/api/actors', actorsRoutes);

// Follow routes
app.route('/api/follow', followRoutes);

// Timeline routes
app.route('/api/timeline', timelineRoutes);

// Posts, likes, bookmarks routes
// Note: bookmarks endpoint is at /api/posts/bookmarks
app.route('/api/posts', postsRoutes);

// Notifications routes
app.route('/api/notifications', notificationsRoutes);

// Stories routes
app.route('/api/stories', storiesRoutes);

// Search routes
app.route('/api/search', searchRoutes);

// Communities routes
app.route('/api/communities', communitiesRoutes);

// DM routes
app.route('/api/dm', dmRoutes);

// Media routes
app.route('/api/media', mediaRoutes);
app.route('/media', mediaRoutes);

// ActivityPub routes (WebFinger, actor endpoints, inbox/outbox)
app.route('/', activitypubRoutes);

// ============================================================
// FALLBACK TO STATIC ASSETS
// ============================================================

app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
