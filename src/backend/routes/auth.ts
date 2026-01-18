import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Variables, Actor } from '../types';
import { generateId, actorApId, formatUsername, generateKeyPair } from '../utils';
import { encrypt } from '../lib/crypto';
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
import type { PrismaClient } from '../../generated/prisma';

/**
 * Constant-time string comparison to prevent timing attacks
 * Always compares the full length to avoid leaking information about the password
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  // Always compare using the maximum length to ensure constant-time
  // regardless of input lengths (prevents length-based timing attacks)
  const maxLen = Math.max(aBytes.length, bBytes.length);

  // Start with length comparison result (1 if different, 0 if same)
  let result = aBytes.length === bBytes.length ? 0 : 1;

  for (let i = 0; i < maxLen; i++) {
    // Use 0 as fallback for shorter string to ensure constant-time comparison
    const aByte = i < aBytes.length ? aBytes[i] : 0;
    const bByte = i < bBytes.length ? bBytes[i] : 0;
    // XOR bytes and OR into result - any difference sets bits in result
    result |= aByte ^ bByte;
  }

  return result === 0;
}

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
    const prisma = c.get('prisma');
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { provider: true, providerAccessToken: true },
    });

    if (session) {
      provider = session.provider;
      hasTakosAccess = session.provider === 'takos' && !!session.providerAccessToken;
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
  // Use constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(body.password || '', c.env.AUTH_PASSWORD || '')) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  const prisma = c.get('prisma');

  // Session fixation prevention: Delete any existing session before creating new one
  const existingSessionId = getCookie(c, 'session');
  if (existingSessionId) {
    await prisma.session.delete({ where: { id: existingSessionId } }).catch(() => {});
    deleteCookie(c, 'session');
  }

  // Single-user instance: find existing owner or create default
  let actorData = await prisma.actor.findFirst({
    where: { role: 'owner' },
  });

  if (!actorData) {
    actorData = await createDefaultOwner(prisma, c.env, 'password:owner');
  }

  // Generate new session with fresh ID (session rotation)
  const sessionId = await createSession(prisma, actorData.apId, null, null, c.env.ENCRYPTION_KEY);
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
    // Validate error is a known OAuth error type to prevent injection
    const knownErrors = [
      'access_denied', 'invalid_request', 'unauthorized_client',
      'unsupported_response_type', 'invalid_scope', 'server_error',
      'temporarily_unavailable', 'interaction_required', 'login_required',
      'consent_required'
    ];
    const safeError = knownErrors.includes(error) ? error : 'oauth_error';
    return c.redirect(`/?error=${safeError}`);
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
  const prisma = c.get('prisma');

  // Actor作成/更新
  let actorData = await prisma.actor.findFirst({
    where: { takosUserId: providerUserId },
  });

  if (!actorData) {
    actorData = await createActorFromOAuth(prisma, c.env, userInfo, providerUserId);
  } else {
    // プロフィール更新
    await updateActorFromOAuth(prisma, actorData, userInfo);
  }

  // Session fixation prevention: Delete any existing session before creating new one
  const existingSessionId = getCookie(c, 'session');
  if (existingSessionId) {
    await prisma.session.delete({ where: { id: existingSessionId } }).catch(() => {});
    deleteCookie(c, 'session');
  }

  // セッション作成 (new session with fresh ID - session rotation)
  const sessionId = await createSession(
    prisma,
    actorData.apId,
    providerId,
    providerId === 'takos' ? tokens : null,
    c.env.ENCRYPTION_KEY
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
    const prisma = c.get('prisma');
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
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

  const prisma = c.get('prisma');
  const accounts = await prisma.actor.findMany({
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      iconUrl: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return c.json({
    accounts: accounts.map(a => ({
      ap_id: a.apId,
      preferred_username: a.preferredUsername,
      name: a.name,
      icon_url: a.iconUrl,
    })),
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

  const prisma = c.get('prisma');
  const targetActor = await prisma.actor.findUnique({
    where: { apId: body.ap_id },
    select: { apId: true },
  });

  if (!targetActor) return c.json({ error: 'Account not found' }, 404);

  await prisma.session.update({
    where: { id: sessionId },
    data: { memberId: body.ap_id },
  });

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
  const prisma = c.get('prisma');

  const existing = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });

  if (existing) return c.json({ error: 'Username already taken' }, 400);

  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const newActor = await prisma.actor.create({
    data: {
      apId,
      type: 'Person',
      preferredUsername: body.username,
      name: body.name || body.username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      takosUserId: `local:${body.username}`,
      role: 'member',
    },
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      iconUrl: true,
    },
  });

  return c.json({
    success: true,
    account: {
      ap_id: newActor.apId,
      preferred_username: newActor.preferredUsername,
      name: newActor.name,
      icon_url: newActor.iconUrl,
    },
  });
});

// ============================================
// ヘルパー関数
// ============================================

async function createDefaultOwner(prisma: PrismaClient, env: Env, takosUserId: string) {
  const baseUrl = env.APP_URL;
  const username = 'tako';
  const apId = actorApId(baseUrl, username);

  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  return await prisma.actor.create({
    data: {
      apId,
      type: 'Person',
      preferredUsername: username,
      name: username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      takosUserId,
      role: 'owner',
    },
  });
}

async function createActorFromOAuth(
  prisma: PrismaClient,
  env: Env,
  userInfo: { id: string; name: string; email?: string; picture?: string; username?: string },
  providerUserId: string
) {
  const baseUrl = env.APP_URL;

  // ユーザー名を生成（重複回避）
  let baseUsername = userInfo.username || userInfo.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let username = baseUsername;
  let counter = 1;

  while (true) {
    const apId = actorApId(baseUrl, username);
    const existing = await prisma.actor.findUnique({
      where: { apId },
      select: { apId: true },
    });
    if (!existing) break;
    username = `${baseUsername}${counter}`;
    counter++;
  }

  const apId = actorApId(baseUrl, username);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // 最初のユーザーはownerに
  const actorCount = await prisma.actor.count();
  const role = actorCount === 0 ? 'owner' : 'member';

  return await prisma.actor.create({
    data: {
      apId,
      type: 'Person',
      preferredUsername: username,
      name: userInfo.name,
      iconUrl: userInfo.picture || null,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      takosUserId: providerUserId,
      role,
    },
  });
}

async function updateActorFromOAuth(
  prisma: PrismaClient,
  actor: { apId: string },
  userInfo: { name: string; picture?: string }
): Promise<void> {
  await prisma.actor.update({
    where: { apId: actor.apId },
    data: {
      name: userInfo.name,
      iconUrl: userInfo.picture || undefined,
    },
  });
}

async function createSession(
  prisma: PrismaClient,
  actorApId: string,
  provider: string | null,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number } | null,
  encryptionKey?: string
): Promise<string> {
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const tokenExpiresAt = tokens?.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  // Encrypt OAuth tokens before storing
  const encryptedAccessToken = tokens?.access_token
    ? await encrypt(tokens.access_token, encryptionKey)
    : null;
  const encryptedRefreshToken = tokens?.refresh_token
    ? await encrypt(tokens.refresh_token, encryptionKey)
    : null;

  await prisma.session.create({
    data: {
      id: sessionId,
      memberId: actorApId,
      accessToken: sessionId, // legacy: access_token = sessionId
      expiresAt,
      provider,
      providerAccessToken: encryptedAccessToken,
      providerRefreshToken: encryptedRefreshToken,
      providerTokenExpiresAt: tokenExpiresAt,
    },
  });

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
