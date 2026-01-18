/**
 * Takos API Proxy Routes
 *
 * takosでログインした場合、フロントエンドからtakos APIにアクセスするためのプロキシ
 * セキュリティのため、トークンはサーバーサイドで管理
 */

import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { getTakosClient, type TakosSession } from '../lib/takos-client';

const takosProxy = new Hono<{ Bindings: Env; Variables: Variables }>();

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

  const session = await c.env.DB.prepare(`
    SELECT id, provider, provider_access_token, provider_refresh_token, provider_token_expires_at
    FROM sessions WHERE id = ?
  `).bind(sessionId).first<TakosSession>();

  if (!session) {
    return c.json({ error: 'Session not found' }, 401);
  }

  if (session.provider !== 'takos') {
    return c.json({ error: 'Not logged in with Takos' }, 400);
  }

  const client = await getTakosClient(c.env, session);
  if (!client) {
    return c.json({ error: 'Failed to create Takos client' }, 500);
  }

  c.set('takosClient', client);
  await next();
});

// ワークスペース一覧
takosProxy.get('/workspaces', async (c) => {
  const client = c.get('takosClient');
  if (!client) {
    return c.json({ error: 'Takos client not available' }, 500);
  }

  try {
    const data = await client.getWorkspaces();
    return c.json(data);
  } catch (err) {
    console.error('Failed to get workspaces:', err);
    return c.json({ error: 'Failed to get workspaces' }, 500);
  }
});

// リポジトリ一覧
takosProxy.get('/repos', async (c) => {
  const client = c.get('takosClient');
  if (!client) {
    return c.json({ error: 'Takos client not available' }, 500);
  }

  try {
    const data = await client.getRepos();
    return c.json(data);
  } catch (err) {
    console.error('Failed to get repos:', err);
    return c.json({ error: 'Failed to get repos' }, 500);
  }
});

// ユーザー情報
takosProxy.get('/user', async (c) => {
  const client = c.get('takosClient');
  if (!client) {
    return c.json({ error: 'Takos client not available' }, 500);
  }

  try {
    const data = await client.getUser();
    return c.json(data);
  } catch (err) {
    console.error('Failed to get user:', err);
    return c.json({ error: 'Failed to get user' }, 500);
  }
});

export default takosProxy;
