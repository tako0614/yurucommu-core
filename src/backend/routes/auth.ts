import { Hono } from 'hono';
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { generateId, actorApId, formatUsername, generateKeyPair } from '../utils';
import { encrypt, verifyPassword } from '../lib/crypto';
import {
  getAuthConfig,
  getProvider,
  getClientCredentials,
  fetchUserInfo,
} from '../lib/oauth-providers';
import {
  generateId as generateOAuthId,
  generateCodeVerifier,
  generateCodeChallenge,
  generateNonce,
  saveOAuthState,
  getOAuthState,
  deleteOAuthState,
} from '../lib/oauth-utils';
import {
  clearLoginLockout,
  getLoginLockoutStatus,
  recordFailedLoginAttempt,
} from '../lib/auth-lockout';
import { getClientIP } from '../lib/client-ip';
import type { Database } from '../../db';
import { eq, and, or, count, desc, asc, sql, inArray, isNull } from 'drizzle-orm';
import { actors, sessions } from '../../db';

/** Session lifetime: 30 days in seconds. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type OAuthTokens = { access_token: string; refresh_token?: string; expires_in?: number };

type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Constant-time string comparison to prevent timing attacks.
 * Always compares the full length to avoid leaking information about the password.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  const maxLen = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length === bBytes.length ? 0 : 1;

  for (let i = 0; i < maxLen; i++) {
    const aByte = i < aBytes.length ? aBytes[i] : 0;
    const bByte = i < bBytes.length ? bBytes[i] : 0;
    result |= aByte ^ bByte;
  }

  return result === 0;
}

async function parseJsonObject(
  c: { req: { json(): Promise<unknown> } }
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatAccountResponse(a: { apId: string; preferredUsername: string; name: string | null; iconUrl: string | null }): {
  ap_id: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
} {
  return {
    ap_id: a.apId,
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
  };
}

async function deleteSessionSafely(db: Database, sessionId: string, context: string): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch (err) {
    console.warn(`[Auth] Failed to delete session during ${context}`, err);
  }
}

/**
 * Invalidates any existing session, creates a fresh one, and sets the cookie.
 * Centralises session-rotation logic used by both password and OAuth login.
 */
async function rotateSession(
  c: HonoContext,
  memberApId: string,
  provider: string | null,
  tokens: OAuthTokens | null,
  encryptionKey: string | undefined,
  rotationContext: string,
): Promise<string> {
  const db = c.get('prisma');

  // Invalidate existing session
  const existingSessionId = getCookie(c, 'session');
  if (existingSessionId) {
    await deleteSessionSafely(db, existingSessionId, rotationContext);
    deleteCookie(c, 'session');
  }

  // Create new session with encrypted tokens
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString();

  await db.insert(sessions).values({
    id: sessionId,
    memberId: memberApId,
    accessToken: sessionId,
    expiresAt,
    provider,
    providerAccessToken: tokens?.access_token
      ? await encrypt(tokens.access_token, encryptionKey)
      : null,
    providerRefreshToken: tokens?.refresh_token
      ? await encrypt(tokens.refresh_token, encryptionKey)
      : null,
    providerTokenExpiresAt: tokens?.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
  });

  // Set cookie
  setCookie(c, 'session', sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return sessionId;
}

function actorEndpoints(apId: string) {
  return {
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
  };
}

/** Resolves a unique username by appending a counter on collision. */
async function resolveUniqueUsername(
  db: Database,
  baseUrl: string,
  baseUsername: string,
): Promise<string> {
  let username = baseUsername;
  let counter = 1;
  while (await db.select({ apId: actors.apId }).from(actors).where(eq(actors.apId, actorApId(baseUrl, username))).get()) {
    username = `${baseUsername}${counter}`;
    counter++;
  }
  return username;
}

async function createActor(
  db: Database,
  env: Env,
  opts: {
    username: string;
    name: string;
    iconUrl?: string | null;
    takosUserId: string;
    role: string;
    ownerActorApId?: string | null;
  },
) {
  const apId = actorApId(env.APP_URL, opts.username);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  return await db.insert(actors).values({
    apId,
    type: 'Person',
    preferredUsername: opts.username,
    name: opts.name,
    iconUrl: opts.iconUrl ?? null,
    ...actorEndpoints(apId),
    publicKeyPem,
    privateKeyPem,
    takosUserId: opts.takosUserId,
    role: opts.role,
    ownerActorApId: opts.ownerActorApId ?? null,
  }).returning().get();
}

async function createActorFromOAuth(
  db: Database,
  env: Env,
  userInfo: { id: string; name: string; email?: string; picture?: string; username?: string },
  providerUserId: string,
) {
  const baseUsername = userInfo.username || userInfo.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  const username = await resolveUniqueUsername(db, env.APP_URL, baseUsername);
  const result = await db.select({ count: count() }).from(actors).get();
  const actorCount = result?.count ?? 0;

  return await createActor(db, env, {
    username,
    name: userInfo.name,
    iconUrl: userInfo.picture,
    takosUserId: providerUserId,
    role: actorCount === 0 ? 'owner' : 'member',
  });
}

/** Fetches user info from the Takos OAuth exchange service binding. */
async function fetchTakosUserInfo(
  binding: { fetch(input: RequestInfo, init?: RequestInit): Promise<Response> },
  accessToken: string,
  clientIp: string | undefined,
): Promise<{ id: string; name: string; email?: string; picture?: string }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
  if (clientIp) headers['X-Forwarded-For'] = clientIp;

  const res = await binding.fetch('https://internal/oauth/userinfo', { headers });
  if (!res.ok) throw new Error(`Failed to fetch takos user info: ${res.status}`);

  const data = await res.json() as { user?: { id: string; name: string; email?: string; picture?: string } };
  if (!data.user?.id || !data.user?.name) throw new Error('Invalid takos user info payload');

  return { id: data.user.id, name: data.user.name, email: data.user.email, picture: data.user.picture };
}

function lockoutErrorResponse(retryAfterSeconds: number): { error: string; retry_after: number } {
  return {
    error: 'Too many failed login attempts. Please try again later.',
    retry_after: retryAfterSeconds,
  };
}

/** Exchange an OAuth authorization code for tokens. Returns null on failure. */
async function exchangeOAuthToken(
  providerId: string,
  code: string,
  codeVerifier: string | undefined,
  env: Env,
  provider: { tokenUrl: string; supportsPkce: boolean },
  clientIp: string | undefined,
): Promise<OAuthTokens | null> {
  const { clientId, clientSecret } = getClientCredentials(env, providerId);
  const redirectUri = `${env.APP_URL}/api/auth/callback/${providerId}`;

  const tokenBody: Record<string, string> = {
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  };

  if (provider.supportsPkce && codeVerifier) {
    tokenBody.code_verifier = codeVerifier;
  }

  const tokenHeaders: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const usingBinding = providerId === 'takos' && !!env.TAKOS_OAUTH_EXCHANGE;
  if (usingBinding && clientIp) {
    tokenHeaders['X-Forwarded-For'] = clientIp;
  }

  if (providerId === 'x') {
    tokenHeaders['Authorization'] = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
    delete tokenBody.client_secret;
  }

  const tokenUrl = usingBinding ? 'https://internal/oauth/token' : provider.tokenUrl;
  const requestInit: RequestInit = {
    method: 'POST',
    headers: tokenHeaders,
    body: new URLSearchParams(tokenBody),
  };

  console.log('Token exchange request:', {
    url: tokenUrl,
    via: usingBinding ? 'service_binding' : 'fetch',
    clientId,
    redirectUri,
    hasCodeVerifier: !!tokenBody.code_verifier,
  });

  const res = usingBinding
    ? await env.TAKOS_OAUTH_EXCHANGE!.fetch(tokenUrl, requestInit)
    : await fetch(tokenUrl, requestInit);

  if (!res.ok) {
    console.error('Token exchange failed:', {
      status: res.status,
      statusText: res.statusText,
      body: await res.text(),
      url: provider.tokenUrl,
    });
    return null;
  }

  return await res.json() as OAuthTokens;
}

/** Look up an existing actor by provider user ID (with legacy migration), or create a new one. */
async function findOrCreateOAuthActor(
  db: Database,
  env: Env,
  providerId: string,
  userInfo: { id: string; name: string; email?: string; picture?: string; username?: string },
) {
  const providerUserId = providerId === 'takos' ? userInfo.id : `${providerId}:${userInfo.id}`;

  let actorData = await db.select().from(actors).where(eq(actors.takosUserId, providerUserId)).get();

  // Migrate legacy takos: prefixed IDs
  if (!actorData && providerId === 'takos') {
    const legacyActor = await db.select().from(actors).where(eq(actors.takosUserId, `takos:${userInfo.id}`)).get();
    if (legacyActor) {
      actorData = await db.update(actors)
        .set({ takosUserId: providerUserId })
        .where(eq(actors.apId, legacyActor.apId))
        .returning().get();
    }
  }

  if (!actorData) {
    actorData = await createActorFromOAuth(db, env, userInfo, providerUserId);
  } else {
    await db.update(actors)
      .set({
        name: userInfo.name,
        ...(userInfo.picture ? { iconUrl: userInfo.picture } : {}),
      })
      .where(eq(actors.apId, actorData.apId))
      .run();
  }

  return actorData;
}

const KNOWN_OAUTH_ERRORS = new Set([
  'access_denied', 'invalid_request', 'unauthorized_client',
  'unsupported_response_type', 'invalid_scope', 'server_error',
  'temporarily_unavailable', 'interaction_required', 'login_required',
  'consent_required',
]);

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

// 認証設定取得
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

// 現在のユーザー情報
auth.get('/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  const sessionId = getCookie(c, 'session');
  let provider: string | null = null;
  let hasTakosAccess = false;

  if (sessionId) {
    const db = c.get('prisma');
    const session = await db.select({
      provider: sessions.provider,
      providerAccessToken: sessions.providerAccessToken,
    }).from(sessions).where(eq(sessions.id, sessionId)).get();
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

// パスワード認証
auth.post('/login', async (c) => {
  const config = getAuthConfig(c.env);
  if (!config.passwordEnabled) {
    return c.json({ error: 'Password auth not enabled' }, 400);
  }

  const clientIp = getClientIP(c);
  const lockoutKey = `password:${clientIp}`;

  const lockoutStatus = await getLoginLockoutStatus(c.env.KV, lockoutKey);
  if (lockoutStatus.locked) {
    c.header('Retry-After', String(lockoutStatus.retryAfterSeconds));
    return c.json(lockoutErrorResponse(lockoutStatus.retryAfterSeconds), 429);
  }

  const body = await parseJsonObject(c);
  if (!body) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);
  }

  const password = nonEmptyString(body.password);
  if (!password) {
    return c.json({ error: 'password is required', code: 'BAD_REQUEST' }, 400);
  }

  // Verify password using PBKDF2 hash (AUTH_PASSWORD_HASH).
  // Legacy plaintext fallback requires explicit ALLOW_PLAINTEXT_AUTH=true.
  let isValid = false;

  if (c.env.AUTH_PASSWORD_HASH) {
    isValid = await verifyPassword(password, c.env.AUTH_PASSWORD_HASH);
  } else if (c.env.AUTH_PASSWORD && c.env.ALLOW_PLAINTEXT_AUTH === 'true') {
    console.warn(
      '[SECURITY WARNING] AUTH_PASSWORD is deprecated. ' +
      'Use AUTH_PASSWORD_HASH with PBKDF2-hashed password instead. ' +
      'See docs for migration guide.'
    );
    isValid = timingSafeEqual(password, c.env.AUTH_PASSWORD);
  }

  if (!isValid) {
    const failedStatus = await recordFailedLoginAttempt(c.env.KV, lockoutKey);
    if (failedStatus.locked) {
      c.header('Retry-After', String(failedStatus.retryAfterSeconds));
      return c.json(lockoutErrorResponse(failedStatus.retryAfterSeconds), 429);
    }
    return c.json({ error: 'Invalid password' }, 401);
  }

  const db = c.get('prisma');

  // Single-user instance: find existing owner or create default
  const actorData = await db.select().from(actors).where(eq(actors.role, 'owner')).get()
    ?? await createActor(db, c.env, {
      username: 'tako',
      name: 'tako',
      takosUserId: 'password:owner',
      role: 'owner',
    });

  await rotateSession(c, actorData.apId, null, null, c.env.ENCRYPTION_KEY, 'password login rotation');
  await clearLoginLockout(c.env.KV, lockoutKey);

  return c.json({ success: true });
});

// OAuth: 認証開始
auth.get('/login/:provider', async (c) => {
  const providerId = c.req.param('provider');
  const provider = getProvider(c.env, providerId);

  if (!provider) {
    return c.json({ error: 'Unknown or unconfigured provider' }, 400);
  }

  const state = generateOAuthId();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const nonce = generateNonce();
  await saveOAuthState(c.env.KV, state, {
    provider: providerId,
    codeVerifier,
    createdAt: Date.now(),
    nonce,
  });
  // Bind OAuth state to this browser session to prevent login CSRF (Issue 107).
  setCookie(c, "oauth_nonce", nonce, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });

  const { clientId } = getClientCredentials(c.env, providerId);
  const redirectUri = `${c.env.APP_URL}/api/auth/callback/${providerId}`;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: provider.scopes.join(' '),
    state,
  });

  if (provider.supportsPkce) {
    params.set('code_challenge', codeChallenge);
    params.set('code_challenge_method', 'S256');
  }

  return c.redirect(`${provider.authorizeUrl}?${params.toString()}`);
});

// OAuth: コールバック
auth.get('/callback/:provider', async (c) => {
  const providerId = c.req.param('provider');
  const error = c.req.query('error');

  if (error) {
    console.error('OAuth error:', error, c.req.query('error_description'));
    const safeError = KNOWN_OAUTH_ERRORS.has(error) ? error : 'oauth_error';
    return c.redirect(`/?error=${safeError}`);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.redirect('/?error=missing_params');
  }

  const storedState = await getOAuthState(c.env.KV, state);
  if (!storedState) return c.redirect('/?error=invalid_state');
  if (storedState.provider !== providerId) return c.redirect('/?error=provider_mismatch');
  // Verify browser-session binding nonce to prevent login CSRF (Issue 107).
  if (storedState.nonce) {
    const cookieNonce = getCookie(c, 'oauth_nonce');
    if (!cookieNonce || cookieNonce !== storedState.nonce) {
      await deleteOAuthState(c.env.KV, state);
      deleteCookie(c, 'oauth_nonce');
      return c.redirect('/?error=csrf_check_failed');
    }
  }
  await deleteOAuthState(c.env.KV, state);
  deleteCookie(c, 'oauth_nonce');

  const provider = getProvider(c.env, providerId);
  if (!provider) return c.redirect('/?error=unknown_provider');

  const clientIp = c.req.header('CF-Connecting-IP');
  const tokens = await exchangeOAuthToken(providerId, code, storedState.codeVerifier, c.env, provider, clientIp);
  if (!tokens) return c.redirect('/?error=token_exchange_failed');

  const usingBinding = providerId === 'takos' && !!c.env.TAKOS_OAUTH_EXCHANGE;
  let userInfo;
  try {
    userInfo = usingBinding
      ? await fetchTakosUserInfo(c.env.TAKOS_OAUTH_EXCHANGE!, tokens.access_token, clientIp)
      : await fetchUserInfo(provider, tokens.access_token);
  } catch (err) {
    console.error('Failed to fetch user info:', err);
    return c.redirect('/?error=user_info_failed');
  }

  const actorData = await findOrCreateOAuthActor(c.get('prisma'), c.env, providerId, userInfo);
  if (!actorData) return c.redirect('/?error=actor_creation_failed');

  await rotateSession(
    c,
    actorData.apId,
    providerId,
    providerId === 'takos' ? tokens : null,
    c.env.ENCRYPTION_KEY,
    'oauth login rotation',
  );

  return c.redirect('/');
});

// ログアウト
auth.post('/logout', async (c) => {
  const sessionId = getCookie(c, 'session');
  if (sessionId) {
    await deleteSessionSafely(c.get('prisma'), sessionId, 'logout');
    deleteCookie(c, 'session');
  }
  return c.json({ success: true });
});

auth.get('/accounts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  const db = c.get('prisma');

  // Find the root owner ap_id: current actor may be a sub-account.
  // ownerActorApId is set on actors created via POST /accounts; root actors have null.
  const currentActorRecord = await db.select({ ownerActorApId: actors.ownerActorApId })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  const rootOwnerApId = currentActorRecord?.ownerActorApId ?? actor.ap_id;

  // Return only the root actor and any sub-accounts they own (Issue 106).
  const accounts = await db.select({
    apId: actors.apId,
    preferredUsername: actors.preferredUsername,
    name: actors.name,
    iconUrl: actors.iconUrl,
  })
    .from(actors)
    .where(or(eq(actors.apId, rootOwnerApId), eq(actors.ownerActorApId, rootOwnerApId)))
    .orderBy(asc(actors.createdAt))
    .all();

  return c.json({
    accounts: accounts.map(formatAccountResponse),
    current_ap_id: actor.ap_id,
  });
});

auth.post('/switch', async (c) => {
  const currentActor = c.get('actor');
  if (!currentActor) return c.json({ error: 'Not authenticated' }, 401);

  const sessionId = getCookie(c, 'session');
  if (!sessionId) return c.json({ error: 'No session' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const targetApId = nonEmptyString(body.ap_id);
  if (!targetApId) return c.json({ error: 'ap_id required', code: 'BAD_REQUEST' }, 400);

  const db = c.get('prisma');

  // Resolve the root owner of the current session to enforce ownership (Issue 106).
  const currentActorRecord = await db.select({ ownerActorApId: actors.ownerActorApId })
    .from(actors)
    .where(eq(actors.apId, currentActor.ap_id))
    .get();
  const rootOwnerApId = currentActorRecord?.ownerActorApId ?? currentActor.ap_id;

  const targetActor = await db.select({ apId: actors.apId, ownerActorApId: actors.ownerActorApId })
    .from(actors)
    .where(eq(actors.apId, targetApId))
    .get();

  if (!targetActor) return c.json({ error: 'Account not found' }, 404);

  // Only allow switching to the root account or its own sub-accounts.
  const isAllowed = targetActor.apId === rootOwnerApId ||
    targetActor.ownerActorApId === rootOwnerApId;
  if (!isAllowed) return c.json({ error: 'Forbidden' }, 403);

  await db.update(sessions)
    .set({ memberId: targetApId })
    .where(eq(sessions.id, sessionId))
    .run();

  return c.json({ success: true });
});

auth.post('/accounts', async (c) => {
  const currentActor = c.get('actor');
  if (!currentActor) return c.json({ error: 'Not authenticated' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const username = nonEmptyString(body.username);
  if (!username) return c.json({ error: 'username required', code: 'BAD_REQUEST' }, 400);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return c.json({ error: 'Invalid username. Use only letters, numbers, and underscores.' }, 400);
  }

  if (body.name !== undefined && typeof body.name !== 'string') {
    return c.json({ error: 'name must be a string', code: 'BAD_REQUEST' }, 400);
  }
  const name: string | undefined = typeof body.name === 'string' ? body.name : undefined;

  const db = c.get('prisma');
  const apId = actorApId(c.env.APP_URL, username);

  const existing = await db.select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();

  if (existing) return c.json({ error: 'Username already taken' }, 400);

  // Resolve root owner to set ownership link on the sub-account (Issue 106).
  const creatorRecord = await db.select({ ownerActorApId: actors.ownerActorApId })
    .from(actors)
    .where(eq(actors.apId, currentActor.ap_id))
    .get();
  const rootOwnerApId = creatorRecord?.ownerActorApId ?? currentActor.ap_id;

  const newActor = await createActor(db, c.env, {
    username,
    name: name || username,
    takosUserId: `local:${username}`,
    role: 'member',
    ownerActorApId: rootOwnerApId,
  });

  return c.json({
    success: true,
    account: formatAccountResponse(newActor),
  });
});

export default auth;
