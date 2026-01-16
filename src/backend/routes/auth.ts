import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Variables, Actor } from '../types';
import { generateId, actorApId, formatUsername, generateKeyPair } from '../utils';
import {
  getAuthConfig,
  getProvider,
  getClientId,
  getClientSecret,
  fetchUserInfo,
} from '../lib/oauth-providers';
import {
  generateId as generateOAuthId,
  generateCodeVerifier,
  generateCodeChallenge,
  saveOAuthState,
  getOAuthState,
  deleteOAuthState,
} from '../lib/oauth-utils';

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

// ============================================
// 認証設定取得
// ============================================

auth.get('/providers', async (c) => {
  const config = getAuthConfig(c.env);
  return c.json({
    providers: config.providers.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
    })),
    password_enabled: config.passwordEnabled,
  });
});

// ============================================
// 現在のユーザー情報
// ============================================

auth.get('/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  // セッションからプロバイダー情報を取得
  const sessionId = getCookie(c, 'session');
  let provider: string | null = null;
  let hasTakosAccess = false;

  if (sessionId) {
    const session = await c.env.DB.prepare(
      'SELECT provider, access_token FROM sessions WHERE id = ?'
    ).bind(sessionId).first<{ provider: string | null; access_token: string | null }>();

    if (session) {
      provider = session.provider;
      hasTakosAccess = session.provider === 'takos' && !!session.access_token;
    }
  }

  return c.json({
    actor: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      summary: actor.summary,
      icon_url: actor.icon_url,
      header_url: actor.header_url,
      follower_count: actor.follower_count,
      following_count: actor.following_count,
      post_count: actor.post_count,
      role: actor.role,
    },
    provider,
    has_takos_access: hasTakosAccess,
  });
});

// ============================================
// パスワード認証
// ============================================

auth.post('/login', async (c) => {
  const config = getAuthConfig(c.env);
  if (!config.passwordEnabled) {
    return c.json({ error: 'Password auth not enabled' }, 400);
  }

  const body = await c.req.json<{ password: string }>();
  if (body.password !== c.env.AUTH_PASSWORD) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  // Single-user instance: find existing owner or create default
  let actor = await c.env.DB.prepare("SELECT * FROM actors WHERE role = 'owner' LIMIT 1").first<Actor>();

  if (!actor) {
    actor = await createDefaultOwner(c.env, 'password:owner');
  }

  const sessionId = await createSession(c.env, actor.ap_id, null, null);
  setSessionCookie(c, sessionId);

  return c.json({ success: true });
});

// ============================================
// OAuth: 認証開始
// ============================================

auth.get('/login/:provider', async (c) => {
  const providerId = c.req.param('provider');
  const provider = getProvider(c.env, providerId);

  if (!provider) {
    return c.json({ error: 'Unknown or unconfigured provider' }, 400);
  }

  const state = generateOAuthId();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  // state保存
  await saveOAuthState(c.env.KV, state, {
    provider: providerId,
    codeVerifier,
    createdAt: Date.now(),
  });

  const clientId = getClientId(c.env, providerId);
  const redirectUri = `${c.env.APP_URL}/api/auth/callback/${providerId}`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: provider.scopes.join(' '),
    state,
  });

  // PKCE対応
  if (provider.supportsPkce) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return c.redirect(`${provider.authorizeUrl}?${params.toString()}`);
});

// ============================================
// OAuth: コールバック
// ============================================

auth.get('/callback/:provider', async (c) => {
  const providerId = c.req.param('provider');
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');
  const errorDescription = c.req.query('error_description');

  if (error) {
    console.error('OAuth error:', error, errorDescription);
    return c.redirect(`/?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return c.redirect('/?error=missing_params');
  }

  // state検証
  const storedState = await getOAuthState(c.env.KV, state);
  if (!storedState) {
    return c.redirect('/?error=invalid_state');
  }

  if (storedState.provider !== providerId) {
    return c.redirect('/?error=provider_mismatch');
  }

  await deleteOAuthState(c.env.KV, state);

  const provider = getProvider(c.env, providerId);
  if (!provider) {
    return c.redirect('/?error=unknown_provider');
  }

  const clientId = getClientId(c.env, providerId);
  const clientSecret = getClientSecret(c.env, providerId);
  const redirectUri = `${c.env.APP_URL}/api/auth/callback/${providerId}`;

  // トークン交換
  const tokenBody: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  };

  if (provider.supportsPkce) {
    tokenBody.code_verifier = storedState.codeVerifier;
  }

  // X requires Basic auth
  const tokenHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  if (providerId === 'x') {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    tokenHeaders['Authorization'] = `Basic ${credentials}`;
    delete tokenBody.client_secret;
  }

  const tokenRes = await fetch(provider.tokenUrl, {
    method: 'POST',
    headers: tokenHeaders,
    body: new URLSearchParams(tokenBody),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error('Token exchange failed:', errText);
    return c.redirect('/?error=token_exchange_failed');
  }

  const tokens = await tokenRes.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  // ユーザー情報取得
  let userInfo;
  try {
    userInfo = await fetchUserInfo(provider, tokens.access_token);
  } catch (err) {
    console.error('Failed to fetch user info:', err);
    return c.redirect('/?error=user_info_failed');
  }

  const providerUserId = `${providerId}:${userInfo.id}`;

  // Actor作成/更新
  let actor = await c.env.DB.prepare(
    'SELECT * FROM actors WHERE takos_user_id = ?'
  ).bind(providerUserId).first<Actor>();

  if (!actor) {
    actor = await createActorFromOAuth(c.env, userInfo, providerUserId);
  } else {
    // プロフィール更新
    await updateActorFromOAuth(c.env, actor, userInfo);
  }

  // セッション作成
  const sessionId = await createSession(
    c.env,
    actor.ap_id,
    providerId,
    providerId === 'takos' ? tokens : null
  );

  setSessionCookie(c, sessionId);

  return c.redirect('/');
});

// ============================================
// ログアウト
// ============================================

auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run();
    deleteCookie(c, 'session');
  }
  return c.json({ success: true });
});

// ============================================
// アカウント管理（既存機能維持）
// ============================================

auth.get('/accounts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  const accounts = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url
    FROM actors ORDER BY created_at ASC
  `).all();

  return c.json({
    accounts: (accounts.results || []).map((a: unknown) => {
      const account = a as { ap_id: string; preferred_username: string; name: string; icon_url: string };
      return {
        ap_id: account.ap_id,
        preferred_username: account.preferred_username,
        name: account.name,
        icon_url: account.icon_url,
      };
    }),
    current_ap_id: actor.ap_id,
  });
});

auth.post('/switch', async (c) => {
  const currentActor = c.get('actor');
  if (!currentActor) return c.json({ error: 'Not authenticated' }, 401);

  const sessionId = getCookie(c, 'session');
  if (!sessionId) return c.json({ error: 'No session' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  const targetActor = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?')
    .bind(body.ap_id).first();

  if (!targetActor) return c.json({ error: 'Account not found' }, 404);

  await c.env.DB.prepare('UPDATE sessions SET member_id = ? WHERE id = ?')
    .bind(body.ap_id, sessionId).run();

  return c.json({ success: true });
});

auth.post('/accounts', async (c) => {
  const currentActor = c.get('actor');
  if (!currentActor) return c.json({ error: 'Not authenticated' }, 401);

  const body = await c.req.json<{ username: string; name?: string }>();
  if (!body.username) return c.json({ error: 'username required' }, 400);

  if (!/^[a-zA-Z0-9_]+$/.test(body.username)) {
    return c.json({ error: 'Invalid username. Use only letters, numbers, and underscores.' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, body.username);

  const existing = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?')
    .bind(apId).first();

  if (existing) return c.json({ error: 'Username already taken' }, 400);

  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  await c.env.DB.prepare(`
    INSERT INTO actors (ap_id, type, preferred_username, name, inbox, outbox, followers_url, following_url, public_key_pem, private_key_pem, takos_user_id, role)
    VALUES (?, 'Person', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'member')
  `).bind(
    apId,
    body.username,
    body.name || body.username,
    `${apId}/inbox`,
    `${apId}/outbox`,
    `${apId}/followers`,
    `${apId}/following`,
    publicKeyPem,
    privateKeyPem,
    `local:${body.username}`
  ).run();

  const newActor = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url FROM actors WHERE ap_id = ?
  `).bind(apId).first();

  return c.json({ success: true, account: newActor });
});

// ============================================
// ヘルパー関数
// ============================================

async function createDefaultOwner(env: Env, takosUserId: string): Promise<Actor> {
  const baseUrl = env.APP_URL;
  const username = 'tako';
  const apId = actorApId(baseUrl, username);

  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  await env.DB.prepare(`
    INSERT INTO actors (ap_id, type, preferred_username, name, inbox, outbox, followers_url, following_url, public_key_pem, private_key_pem, takos_user_id, role)
    VALUES (?, 'Person', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner')
  `).bind(
    apId,
    username,
    username,
    `${apId}/inbox`,
    `${apId}/outbox`,
    `${apId}/followers`,
    `${apId}/following`,
    publicKeyPem,
    privateKeyPem,
    takosUserId
  ).run();

  return await env.DB.prepare('SELECT * FROM actors WHERE ap_id = ?').bind(apId).first<Actor>() as Actor;
}

async function createActorFromOAuth(
  env: Env,
  userInfo: { id: string; name: string; email?: string; picture?: string; username?: string },
  providerUserId: string
): Promise<Actor> {
  const baseUrl = env.APP_URL;

  // ユーザー名を生成（重複回避）
  let baseUsername = userInfo.username || userInfo.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let username = baseUsername;
  let counter = 1;

  while (true) {
    const apId = actorApId(baseUrl, username);
    const existing = await env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?').bind(apId).first();
    if (!existing) break;
    username = `${baseUsername}${counter}`;
    counter++;
  }

  const apId = actorApId(baseUrl, username);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // 最初のユーザーはownerに
  const actorCount = await env.DB.prepare('SELECT COUNT(*) as count FROM actors').first<{ count: number }>();
  const role = (actorCount?.count || 0) === 0 ? 'owner' : 'member';

  await env.DB.prepare(`
    INSERT INTO actors (ap_id, type, preferred_username, name, icon_url, inbox, outbox, followers_url, following_url, public_key_pem, private_key_pem, takos_user_id, role)
    VALUES (?, 'Person', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    apId,
    username,
    userInfo.name,
    userInfo.picture || null,
    `${apId}/inbox`,
    `${apId}/outbox`,
    `${apId}/followers`,
    `${apId}/following`,
    publicKeyPem,
    privateKeyPem,
    providerUserId,
    role
  ).run();

  return await env.DB.prepare('SELECT * FROM actors WHERE ap_id = ?').bind(apId).first<Actor>() as Actor;
}

async function updateActorFromOAuth(
  env: Env,
  actor: Actor,
  userInfo: { name: string; picture?: string }
): Promise<void> {
  await env.DB.prepare(`
    UPDATE actors SET name = ?, icon_url = COALESCE(?, icon_url) WHERE ap_id = ?
  `).bind(userInfo.name, userInfo.picture || null, actor.ap_id).run();
}

async function createSession(
  env: Env,
  actorApId: string,
  provider: string | null,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number } | null
): Promise<string> {
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const tokenExpiresAt = tokens?.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await env.DB.prepare(`
    INSERT INTO sessions (id, member_id, access_token, expires_at, provider, provider_access_token, provider_refresh_token, provider_token_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    sessionId,
    actorApId,
    sessionId, // legacy: access_token = sessionId
    expiresAt,
    provider,
    tokens?.access_token || null,
    tokens?.refresh_token || null,
    tokenExpiresAt
  ).run();

  return sessionId;
}

function setSessionCookie(c: { header: (name: string, value: string) => void }, sessionId: string): void {
  setCookie(c as Parameters<typeof setCookie>[0], 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 30 * 24 * 60 * 60,
  });
}

export default auth;
