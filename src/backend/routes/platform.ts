import { Hono } from 'hono';
import type { Env, LocalUser } from '../types';
import {
  verifyPlatformJWT,
  isJTIUsed,
  markJTIUsed,
  getCapabilities,
} from '../services/platform';
import { processOutboxQueue } from '../services/activitypub/activities';
import { createSession, setSessionCookie } from '../services/session';

const platform = new Hono<{ Bindings: Env }>();

function sanitizeReturnTo(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

// GET /_platform/capabilities
platform.get('/capabilities', (c) => {
  return c.json(getCapabilities());
});

// POST /_platform/sso
platform.post('/sso', async (c) => {
  const formData = await c.req.formData();
  const token = formData.get('token') as string;
  const returnTo = sanitizeReturnTo(formData.get('return_to') as string | null);

  if (!token) {
    return c.json({ error: 'Missing token' }, 400);
  }

  const tenantId = c.env.TENANT_ID;
  if (!tenantId) {
    return c.json({ error: 'Tenant ID not configured' }, 500);
  }

  try {
    // Ensure tenant is initialized before issuing a session
    const localUser = await c.env.DB.prepare(
      `SELECT * FROM local_users LIMIT 1`
    ).first<LocalUser>();

    if (!localUser) {
      return c.json({ error: 'Tenant not initialized' }, 400);
    }

    const payload = await verifyPlatformJWT({
      token,
      publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
      expectedAudience: tenantId,
    });

    // Check for replay
    if (await isJTIUsed(c.env, payload.jti)) {
      return c.json({ error: 'Token already used' }, 400);
    }

    // Mark JTI as used
    await markJTIUsed(c.env, payload.jti, payload.exp);

    // Create session
    const session = await createSession(c.env, localUser.id);
    const maxAge = 7 * 24 * 60 * 60; // 7 days

    return new Response(null, {
      status: 302,
      headers: {
        'Location': returnTo,
        'Set-Cookie': setSessionCookie(session.id, maxAge),
      },
    });
  } catch (err) {
    console.error('SSO error:', err);
    return c.json({ error: 'Invalid token' }, 400);
  }
});

// POST /_platform/admin (optional)
platform.post('/admin', async (c) => {
  // Verify platform JWT from Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing authorization' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const tenantId = c.env.TENANT_ID;
    if (!tenantId) {
      return c.json({ error: 'Tenant ID not configured' }, 500);
    }

    const localUser = await c.env.DB.prepare(
      `SELECT * FROM local_users LIMIT 1`
    ).first<LocalUser>();

    if (!localUser) {
      return c.json({ error: 'Tenant not initialized' }, 400);
    }

    const payload = await verifyPlatformJWT({
      token,
      publicKeyPem: c.env.PLATFORM_PUBLIC_KEY,
      expectedAudience: tenantId,
    });

    if (payload.role !== 'owner' && payload.role !== 'admin') {
      return c.json({ error: 'Insufficient role' }, 403);
    }

    if (await isJTIUsed(c.env, payload.jti)) {
      return c.json({ error: 'Token already used' }, 400);
    }

    await markJTIUsed(c.env, payload.jti, payload.exp);

    const body = await c.req.json<{ action: string; [key: string]: unknown }>();

    switch (body.action) {
      case 'get_stats':
        // Return basic stats
        const postsCount = await c.env.DB.prepare(
          `SELECT COUNT(*) as count FROM posts`
        ).first<{ count: number }>();
        const followersCount = await c.env.DB.prepare(
          `SELECT COUNT(*) as count FROM follows WHERE status = 'accepted'`
        ).first<{ count: number }>();
        const hostname = c.env.HOSTNAME || new URL(c.req.url).host;
        const followingCount = await c.env.DB.prepare(
          `SELECT COUNT(*) as count FROM follows WHERE follower_actor LIKE ? AND status = 'accepted'`
        ).bind(`https://${hostname}%`).first<{ count: number }>();

        return c.json({
          posts: postsCount?.count || 0,
          followers: followersCount?.count || 0,
          following: followingCount?.count || 0,
        });

      case 'run_maintenance': {
        // Cleanup expired sessions and JTIs
        const nowMs = Date.now();
        const nowSeconds = Math.floor(nowMs / 1000);
        await c.env.DB.prepare(
          `DELETE FROM sessions WHERE expires_at < ?`
        ).bind(nowMs).run();
        await c.env.DB.prepare(
          `DELETE FROM used_jtis WHERE expires_at < ?`
        ).bind(nowSeconds).run();
        // Process outbound deliveries
        const maintenanceHost = c.env.HOSTNAME || new URL(c.req.url).host;
        await processOutboxQueue(c.env, localUser, maintenanceHost);
        return c.json({ success: true });
      }

      case 'push_asset': {
        // Receive an asset from the platform and store in MEDIA R2
        const assetPath = body.path as string;
        const assetData = body.data as string; // base64 encoded
        const contentType = body.content_type as string;

        if (!assetPath || !assetData) {
          return c.json({ error: 'Missing path or data' }, 400);
        }

        // Decode base64 data
        const binaryString = atob(assetData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        // Store in R2 under assets/ prefix
        const key = `assets/${assetPath}`;
        await c.env.MEDIA.put(key, bytes.buffer, {
          httpMetadata: { contentType: contentType || 'application/octet-stream' },
        });

        return c.json({ success: true, path: assetPath });
      }

      case 'delete_asset': {
        const assetPath = body.path as string;
        if (!assetPath) {
          return c.json({ error: 'Missing path' }, 400);
        }

        const key = `assets/${assetPath}`;
        await c.env.MEDIA.delete(key);

        return c.json({ success: true, path: assetPath });
      }

      case 'list_assets': {
        const prefix = 'assets/';
        const objects = await c.env.MEDIA.list({ prefix });

        const assets = objects.objects.map((obj) => ({
          path: obj.key.slice(prefix.length),
          size: obj.size,
        }));

        return c.json({ assets });
      }

      default:
        return c.json({ error: 'Unknown action' }, 400);
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return c.json({ error: 'Invalid token' }, 401);
  }
});

export default platform;
