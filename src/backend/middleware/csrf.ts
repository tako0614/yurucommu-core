// CSRF protection middleware for Yurucommu backend
// Uses Origin/Referer header validation for state-changing requests

import { Context, Next } from 'hono';
import type { Env, Variables } from '../types';

/**
 * Extract the origin from a URL
 */
function getOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * CSRF protection middleware
 * Validates Origin header for state-changing requests (POST, PUT, DELETE, PATCH)
 *
 * SameSite=Lax cookies provide primary protection, but this adds defense-in-depth
 */
export function csrfProtection() {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) => {
    // Only check state-changing methods
    const method = c.req.method.toUpperCase();
    if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      return next();
    }

    // Skip CSRF check for ActivityPub inbox endpoints (they use HTTP Signatures)
    const path = c.req.path;
    if (path.includes('/inbox') && path.includes('/ap/')) {
      return next();
    }

    // Get the expected origin from APP_URL
    const appUrl = c.env.APP_URL;
    const expectedOrigin = getOrigin(appUrl);

    // Get the request origin (prefer Origin header, fall back to Referer)
    const originHeader = c.req.header('Origin');
    const refererHeader = c.req.header('Referer');
    const requestOrigin = originHeader || getOrigin(refererHeader ?? null);

    // Origin/Referer is mandatory for state-changing requests.
    if (!requestOrigin) {
      console.warn('CSRF check failed: missing Origin/Referer header');
      return c.json({ error: 'CSRF validation failed: missing Origin header' }, 403);
    }

    // Validate the origin
    if (requestOrigin !== expectedOrigin) {
      // Check if it's a development environment with different ports
      const isDev = appUrl?.includes('localhost') || appUrl?.includes('127.0.0.1');
      if (isDev && requestOrigin?.includes('localhost')) {
        // Allow cross-port requests in development
        return next();
      }

      console.warn(`CSRF check failed: expected ${expectedOrigin}, got ${requestOrigin}`);
      return c.json({ error: 'CSRF validation failed' }, 403);
    }

    return next();
  };
}
