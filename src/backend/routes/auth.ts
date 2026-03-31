import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Variables } from '../types.ts';
import { actorApId, formatUsername } from '../federation-helpers.ts';
import { verifyPassword } from '../lib/crypto.ts';
import {
  getAuthConfig,
  getProvider,
  getClientCredentials,
  fetchUserInfo,
} from '../lib/oauth-providers.ts';
import {
  generateId as generateOAuthId,
  generateCodeVerifier,
  generateCodeChallenge,
  generateNonce,
  saveOAuthState,
  getOAuthState,
  deleteOAuthState,
} from '../lib/oauth-utils.ts';
import {
  clearLoginLockout,
  getLoginLockoutStatus,
  recordFailedLoginAttempt,
} from '../lib/auth-lockout.ts';
import { getClientIP } from '../lib/client-ip.ts';
import { eq, or, asc } from 'drizzle-orm';
import { actors, sessions } from '../../db/index.ts';
import {
  parseJsonObject,
  parseNonEmptyString,
  formatAccountResponse,
  deleteSessionSafely,
  rotateSession,
  createActor,
  fetchTakosUserInfo,
  lockoutErrorResponse,
  exchangeOAuthToken,
  findOrCreateOAuthActor,
} from './auth-helpers.ts';

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
    const db = c.get('db');
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

  const password = parseNonEmptyString(body.password);
  if (!password) {
    return c.json({ error: 'password is required', code: 'BAD_REQUEST' }, 400);
  }

  // Verify password using PBKDF2 hash (AUTH_PASSWORD_HASH).
  let isValid = false;

  if (c.env.AUTH_PASSWORD_HASH) {
    isValid = await verifyPassword(password, c.env.AUTH_PASSWORD_HASH);
  }

  if (!isValid) {
    const failedStatus = await recordFailedLoginAttempt(c.env.KV, lockoutKey);
    if (failedStatus.locked) {
      c.header('Retry-After', String(failedStatus.retryAfterSeconds));
      return c.json(lockoutErrorResponse(failedStatus.retryAfterSeconds), 429);
    }
    return c.json({ error: 'Invalid password' }, 401);
  }

  const db = c.get('db');

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

  const tokens = await exchangeOAuthToken(providerId, code, storedState.codeVerifier, c.env, provider);
  if (!tokens) return c.redirect('/?error=token_exchange_failed');

  let userInfo;
  try {
    userInfo = providerId === 'takos'
      ? await fetchTakosUserInfo(c.env.TAKOS_URL || 'https://takos.jp', tokens.access_token)
      : await fetchUserInfo(provider, tokens.access_token);
  } catch (err) {
    console.error('Failed to fetch user info:', err);
    return c.redirect('/?error=user_info_failed');
  }

  const actorData = await findOrCreateOAuthActor(c.get('db'), c.env, providerId, userInfo);
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
    await deleteSessionSafely(c.get('db'), sessionId, 'logout');
    deleteCookie(c, 'session');
  }
  return c.json({ success: true });
});

auth.get('/accounts', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Not authenticated' }, 401);

  const db = c.get('db');

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

  const targetApId = parseNonEmptyString(body.ap_id);
  if (!targetApId) return c.json({ error: 'ap_id required', code: 'BAD_REQUEST' }, 400);

  const db = c.get('db');

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

  const username = parseNonEmptyString(body.username);
  if (!username) return c.json({ error: 'username required', code: 'BAD_REQUEST' }, 400);
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return c.json({ error: 'Invalid username. Use only letters, numbers, and underscores.' }, 400);
  }

  if (body.name !== undefined && typeof body.name !== 'string') {
    return c.json({ error: 'name must be a string', code: 'BAD_REQUEST' }, 400);
  }
  const name: string | undefined = typeof body.name === 'string' ? body.name : undefined;

  const db = c.get('db');
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
