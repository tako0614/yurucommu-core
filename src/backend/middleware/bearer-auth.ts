import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types.ts';

export function requireBearerAuth(
  requiredScope: string,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const auth = c.req.header('Authorization');
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    const token = auth.slice(7);
    const takosUrl = c.env.TAKOS_URL ?? 'https://takos.jp';
    const clientId = c.env.TAKOS_CLIENT_ID ?? c.env.CLIENT_ID;
    const clientSecret = c.env.TAKOS_CLIENT_SECRET ?? c.env.CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return c.json({ error: 'server_error', error_description: 'OAuth client not configured' }, 500);
    }

    const res = await fetch(`${takosUrl}/oauth/introspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: clientId, client_secret: clientSecret }).toString(),
    });
    if (!res.ok) {
      return c.json({ error: 'server_error', error_description: 'Introspect failed' }, 500);
    }

    const info = await res.json() as {
      active: boolean; scope?: string; sub?: string; client_id?: string;
    };
    if (!info.active) {
      return c.json({ error: 'invalid_token' }, 401);
    }
    const scopes = (info.scope ?? '').split(' ');
    if (!scopes.includes(requiredScope)) {
      return c.json({ error: 'insufficient_scope' }, 403);
    }

    c.set('oauthToken', { sub: info.sub ?? '', scope: info.scope ?? '', client_id: info.client_id ?? '' });
    await next();
  };
}
