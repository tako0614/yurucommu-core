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

    // If no Origin/Referer header present
    if (!requestOrigin) {
      // Check for X-Requested-With header (commonly sent by JavaScript frameworks)
      // This provides defense against simple CSRF attacks since cross-origin
      // requests cannot set custom headers without CORS preflight
      const xRequestedWith = c.req.header('X-Requested-With');
      if (xRequestedWith) {
        // Custom header present - this is likely a legitimate AJAX request
        // Cross-origin requests cannot set custom headers without CORS approval
        return next();
      }

      // Check Content-Type for JSON - browsers don't allow cross-origin JSON POSTs
      // without CORS preflight
      const contentType = c.req.header('Content-Type');
      if (contentType && contentType.includes('application/json')) {
        // JSON content type requires CORS preflight for cross-origin requests
        return next();
      }

      // No Origin, no custom headers, and not JSON - reject for safety
      // This blocks simple form-based CSRF attacks
      console.warn('CSRF check failed: missing Origin header and no CSRF-safe indicators');
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
