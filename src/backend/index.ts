import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, Variables, Actor } from './types';
import { getPrismaD1 } from './lib/db';

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
import takosProxyRoutes from './routes/takos-proxy';

// Import middleware
import { rateLimit, RateLimitConfigs } from './middleware/rate-limit';

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
// PRISMA MIDDLEWARE
// ============================================================

app.use('*', async (c, next) => {
  // Use pre-created Prisma client if available (non-Cloudflare runtimes),
  // otherwise create one with D1 adapter (Cloudflare Workers)
  const prisma = c.env.PRISMA ?? getPrismaD1(c.env.DB);
  c.set('prisma', prisma);
  await next();
});

// ============================================================
// AUTH MIDDLEWARE
// ============================================================

app.use('/api/*', async (c, next) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    const prisma = c.get('prisma');
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        expiresAt: { gt: new Date().toISOString() },
      },
      include: { member: true },
    });

    if (session) {
      // Convert Prisma model to Actor type
      const actor: Actor = {
        ap_id: session.member.apId,
        type: session.member.type,
        preferred_username: session.member.preferredUsername,
        name: session.member.name,
        summary: session.member.summary,
        icon_url: session.member.iconUrl,
        header_url: session.member.headerUrl,
        inbox: session.member.inbox,
        outbox: session.member.outbox,
        followers_url: session.member.followersUrl,
        following_url: session.member.followingUrl,
        public_key_pem: session.member.publicKeyPem,
        private_key_pem: session.member.privateKeyPem,
        takos_user_id: session.member.takosUserId,
        follower_count: session.member.followerCount,
        following_count: session.member.followingCount,
        post_count: session.member.postCount,
        is_private: session.member.isPrivate,
        role: session.member.role as 'owner' | 'moderator' | 'member',
        created_at: session.member.createdAt,
      };
      c.set('actor', actor);
    }
  }
  await next();
});

// ============================================================
// RATE LIMITING
// ============================================================

// Apply general rate limit to all API routes
app.use('/api/*', rateLimit(RateLimitConfigs.general));

// Apply stricter rate limits to specific endpoints
app.use('/api/auth/*', rateLimit(RateLimitConfigs.auth));
app.use('/api/search/*', rateLimit(RateLimitConfigs.search));
app.use('/api/media/*', rateLimit(RateLimitConfigs.mediaUpload));
app.use('/api/dm/*', rateLimit(RateLimitConfigs.dm));

// Rate limit for ActivityPub inbox (federation)
app.use('/ap/*/inbox', rateLimit(RateLimitConfigs.inbox));

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
app.route('/api/posts', postsRoutes);

// Bookmarks alias (frontend calls /api/bookmarks, backend has /api/posts/bookmarks)
app.get('/api/bookmarks', async (c) => {
  // Forward to posts/bookmarks handler
  const url = new URL(c.req.url);
  url.pathname = '/api/posts/bookmarks';
  const newReq = new Request(url.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

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

// Takos API proxy (for users logged in with Takos)
app.route('/api/takos', takosProxyRoutes);

// ActivityPub routes (WebFinger, actor endpoints, inbox/outbox)
app.route('/', activitypubRoutes);

// ============================================================
// FALLBACK TO STATIC ASSETS
// ============================================================

app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
