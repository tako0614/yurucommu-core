/**
 * Takos API Proxy Routes
 *
 * takosでログインした場合、フロントエンドからtakos APIにアクセスするためのプロキシ
 * セキュリティのため、トークンはサーバーサイドで管理
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { sessions } from '../../db';
import { getTakosClient, type TakosSession } from '../lib/takos-client';

const takosProxy = new Hono<{ Bindings: Env; Variables: Variables }>();

function isExpired(expiresAt: string): boolean {
  const expiresMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= Date.now();
}

// Feature flag gate (fail-close).
takosProxy.use('*', async (c, next) => {
  if (c.env.ENABLE_TAKOS_PROXY !== 'true') {
    return c.notFound();
  }
  await next();
});

// 認証ミドルウェア
takosProxy.use('*', async (c, next) => {
  const actor = c.get('actor');
  if (!actor) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const sessionId = getCookie(c, 'session');
  if (!sessionId) {
    return c.json({ error: 'No session' }, 401);
  }

  const prisma = c.get('db');
  const session = await prisma.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
    columns: {
      id: true,
      memberId: true,
      expiresAt: true,
      provider: true,
      providerAccessToken: true,
      providerRefreshToken: true,
      providerTokenExpiresAt: true,
    },
  });

  if (!session) {
    return c.json({ error: 'Session not found' }, 401);
  }

  // Session must belong to the current actor and be unexpired.
  if (session.memberId !== actor.ap_id) {
    return c.json({ error: 'Session mismatch' }, 401);
  }
  if (isExpired(session.expiresAt)) {
    return c.json({ error: 'Session expired' }, 401);
  }

  if (session.provider !== 'takos') {
    return c.json({ error: 'Not logged in with Takos' }, 400);
  }

  const client = await getTakosClient(c.env, prisma, session);
  if (!client) {
    return c.json({ error: 'Failed to create Takos client' }, 500);
  }

  c.set('takosClient', client);
  await next();
});

/** Proxy a TakosClient method, returning 500 on failure. */
function proxyRoute<K extends 'getWorkspaces' | 'getRepos' | 'getUser'>(method: K) {
  return async (c: Context<{ Bindings: Env; Variables: Variables }>) => {
    const client = c.get('takosClient');
    if (!client) {
      return c.json({ error: 'Takos client not available' }, 500);
    }

    try {
      const data = await client[method]();
      return c.json(data);
    } catch (err) {
      console.error(`Failed to ${method}:`, err);
      return c.json({ error: `Failed to ${method}` }, 500);
    }
  };
}

takosProxy.get('/workspaces', proxyRoute('getWorkspaces'));
takosProxy.get('/repos', proxyRoute('getRepos'));
takosProxy.get('/user', proxyRoute('getUser'));

export default takosProxy;
