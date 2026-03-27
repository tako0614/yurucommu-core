import { Hono } from 'hono';
import type { Env, Variables } from './types';
import { getDb } from '../db';
import { extractActorFromSession } from './lib/session-actor';

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
import takosToolsRoutes from './routes/takos-tools';
import recommendationsRoutes from './routes/recommendations';
import { appsApiRoutes, appsServeRoutes } from './routes/apps';

import { rateLimit, RateLimitConfigs } from './middleware/rate-limit';
import { csrfProtection } from './middleware/csrf';
import { createErrorMiddleware } from './middleware/error-handler';
import type { MessageBatch } from '@cloudflare/workers-types';
import type { DeliveryQueueMessageV1, DeliveryDlqMessageV1 } from './lib/delivery/types';
import { handleDeliveryDlqBatch, handleDeliveryQueueBatch } from './lib/delivery/queue';

type YurucommuApp = Hono<{ Bindings: Env; Variables: Variables }>;

export const YURUCOMMU_BACKEND_PLUGIN_API_VERSION = 1 as const;

export interface BackendPluginContextV1 {
  app: YurucommuApp;
}

export interface YurucommuBackendPluginV1 {
  apiVersion: typeof YURUCOMMU_BACKEND_PLUGIN_API_VERSION;
  name: string;
  setup?: (ctx: BackendPluginContextV1) => void;
  beforeRoutes?: (ctx: BackendPluginContextV1) => void;
  afterRoutes?: (ctx: BackendPluginContextV1) => void;
}

export interface CreateYurucommuBackendAppOptionsV1 {
  plugins?: YurucommuBackendPluginV1[];
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};

function getMimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function applyGlobalMiddleware(app: YurucommuApp): void {
  app.onError(createErrorMiddleware());

  app.use('*', async (c, next) => {
    await next();

    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Embedder-Policy', 'credentialless');

    const takosUrl = c.env.TAKOS_URL || 'https://takos.jp';
    const csp = [
      "default-src 'self'",
      // TODO: Replace 'unsafe-inline' with nonce-based CSP when framework supports it
      "script-src 'self' 'unsafe-inline' https://unpkg.com https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob:",
      "font-src 'self' data:",
      `connect-src 'self' https://unpkg.com wss: ${takosUrl}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'none'",
      `form-action 'self' ${takosUrl}`,
      "base-uri 'self'",
    ].join('; ');
    c.header('Content-Security-Policy', csp);

    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });

  app.use('*', async (c, next) => {
    const db = c.env.DB_INSTANCE ?? getDb(c.env.DB);
    c.set('db', db);
    await next();
  });

  app.use('/api/*', async (c, next) => {
    await extractActorFromSession(c);
    await next();
  });

  // Takos tools endpoints may be called from the browser (same-origin) and rely on
  // the same session cookie auth as the rest of the API.
  app.use('/.takos/tools/*', async (c, next) => {
    await extractActorFromSession(c);
    await next();
  });

  app.use('/api/*', csrfProtection());
  app.use('/.takos/tools/*', csrfProtection());

  app.use('/api/*', rateLimit(RateLimitConfigs.general));
  app.use('/.takos/tools/*', rateLimit(RateLimitConfigs.general));
  app.use('/api/auth/*', rateLimit(RateLimitConfigs.auth));
  app.use('/api/search/*', rateLimit(RateLimitConfigs.search));
  app.use('/api/media/*', rateLimit(RateLimitConfigs.mediaUpload));
  app.use('/api/dm/*', rateLimit(RateLimitConfigs.dm));
  app.post('/api/posts', rateLimit(RateLimitConfigs.postCreate));
  app.use('/ap/*/inbox', rateLimit(RateLimitConfigs.inbox));
}

function mountCoreRoutes(app: YurucommuApp): void {
  app.route('/api/auth', authRoutes);
  app.route('/api/actors', actorsRoutes);
  app.route('/api/follow', followRoutes);
  app.route('/api/timeline', timelineRoutes);
  app.route('/api/posts', postsRoutes);

  app.get('/api/bookmarks', async (c) => {
    const url = new URL(c.req.url);
    url.pathname = '/api/posts/bookmarks';
    const newReq = new Request(url.toString(), c.req.raw);
    return app.fetch(newReq, c.env, c.executionCtx);
  });

  app.route('/api/notifications', notificationsRoutes);
  app.route('/api/stories', storiesRoutes);
  app.route('/api/search', searchRoutes);
  app.route('/api/communities', communitiesRoutes);
  app.route('/api/dm', dmRoutes);
  app.route('/api/media', mediaRoutes);
  app.route('/media', mediaRoutes);
  app.route('/api/takos', takosProxyRoutes);
  app.route('/.takos/tools', takosToolsRoutes);
  app.route('/api/recommendations', recommendationsRoutes);
  app.route('/api/apps', appsApiRoutes);
  app.route('/hosted', appsServeRoutes);
  app.route('/', activitypubRoutes);
}

function mountStaticFallback(app: YurucommuApp): void {
  app.all('*', async (c) => {
    if (c.env.ASSETS) {
      return c.env.ASSETS.fetch(c.req.raw);
    }

    const storage = (c.env as { STORAGE?: R2Bucket }).STORAGE;
    if (storage) {
      const url = new URL(c.req.url);
      let assetPath = url.pathname;

      if (assetPath === '/' || assetPath === '') {
        assetPath = '/index.html';
      }

      const r2Key = `_assets${assetPath}`;

      try {
        const object = await storage.get(r2Key);
        if (object) {
          const headers = new Headers();
          headers.set('Content-Type', getMimeType(assetPath));
          headers.set('Cache-Control', assetPath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
          if (object.httpEtag) {
            headers.set('ETag', object.httpEtag);
          }
          return new Response(object.body, { headers });
        }

        if (!assetPath.includes('.')) {
          const indexObject = await storage.get('_assets/index.html');
          if (indexObject) {
            const headers = new Headers();
            headers.set('Content-Type', 'text/html; charset=utf-8');
            headers.set('Cache-Control', 'no-cache');
            return new Response(indexObject.body, { headers });
          }
        }
      } catch (err) {
        console.error('Failed to serve asset from R2:', err);
      }
    }

    return c.json({
      error: 'Static assets not configured',
      message: 'This instance is running in API-only mode. Frontend assets are not available.',
      hint: 'Access /api/* endpoints for API functionality.',
    }, 503);
  });
}

export function createYurucommuBackendApp(options: CreateYurucommuBackendAppOptionsV1 = {}): YurucommuApp {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  const plugins = options.plugins ?? [];
  const pluginContext: BackendPluginContextV1 = { app };

  for (const plugin of plugins) {
    if (plugin.apiVersion !== YURUCOMMU_BACKEND_PLUGIN_API_VERSION) {
      throw new Error(
        `[yurucommu] backend plugin "${plugin.name}" uses unsupported apiVersion=${plugin.apiVersion}. ` +
        `Expected ${YURUCOMMU_BACKEND_PLUGIN_API_VERSION}.`
      );
    }
  }

  applyGlobalMiddleware(app);
  for (const plugin of plugins) {
    plugin.setup?.(pluginContext);
  }
  for (const plugin of plugins) {
    plugin.beforeRoutes?.(pluginContext);
  }

  mountCoreRoutes(app);
  for (const plugin of plugins) {
    plugin.afterRoutes?.(pluginContext);
  }

  mountStaticFallback(app);
  return app;
}

const app = createYurucommuBackendApp();

export const backendApp = app;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },

  async queue(batch: MessageBatch<DeliveryQueueMessageV1 | DeliveryDlqMessageV1>, env: Env): Promise<void> {
    if (batch.queue === 'yurucommu-delivery') {
      return handleDeliveryQueueBatch(batch as MessageBatch<DeliveryQueueMessageV1>, env);
    }
    if (batch.queue === 'yurucommu-delivery-dlq') {
      return handleDeliveryDlqBatch(batch as MessageBatch<DeliveryDlqMessageV1>, env);
    }

    console.warn('[Queue] Unknown queue:', batch.queue);
    batch.ackAll();
  },
};
