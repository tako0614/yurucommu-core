/**
 * Authentication Routes
 * Supports both Email/Password and OAuth2 authentication
 */

import { Hono } from 'hono';
import type { Env, LocalUser } from '../types';
import {
  createSession,
  setSessionCookie,
  getSessionIdFromCookie,
  getSession,
  deleteSession,
  clearSessionCookie,
} from '../services/session';
import {
  registerUser,
  loginWithPassword,
  isEmailTaken,
  isUsernameTaken,
  isValidEmail,
  isValidPassword,
} from '../services/auth/local';
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  storeOAuthState,
  consumeOAuthState,
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo,
  findOrCreateOAuthUser,
  storeOAuthTokens,
  revokeOAuthTokens,
  isOAuthConfigured,
} from '../services/auth/oauth';

type Variables = {
  user?: LocalUser;
};

const auth = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Generate RSA key pair for ActivityPub
 */
async function generateKeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );

  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);

  const privateKeyPem =
    '-----BEGIN PRIVATE KEY-----\n' +
    btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer)))
      .match(/.{1,64}/g)!
      .join('\n') +
    '\n-----END PRIVATE KEY-----';
  const publicKeyPem =
    '-----BEGIN PUBLIC KEY-----\n' +
    btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)))
      .match(/.{1,64}/g)!
      .join('\n') +
    '\n-----END PUBLIC KEY-----';

  return { publicKey: publicKeyPem, privateKey: privateKeyPem };
}

// ============================================
// Email/Password Authentication
// ============================================

/**
 * POST /auth/register
 * Register a new user with email/password
 */
auth.post('/register', async (c) => {
  const body = await c.req.json<{
    username: string;
    email: string;
    password: string;
    display_name?: string;
  }>();

  // Validate input
  if (!body.username || !body.email || !body.password) {
    return c.json({ error: 'username, email, and password are required' }, 400);
  }

  // Validate username format
  if (!/^[a-zA-Z0-9_]{1,30}$/.test(body.username)) {
    return c.json(
      { error: 'Username must be 1-30 characters, alphanumeric and underscores only' },
      400
    );
  }

  // Validate email
  if (!isValidEmail(body.email)) {
    return c.json({ error: 'Invalid email format' }, 400);
  }

  // Validate password
  const passwordValidation = isValidPassword(body.password);
  if (!passwordValidation.valid) {
    return c.json({ error: passwordValidation.message }, 400);
  }

  // Check if username is taken
  if (await isUsernameTaken(c.env.DB, body.username)) {
    return c.json({ error: 'Username is already taken' }, 409);
  }

  // Check if email is taken
  if (await isEmailTaken(c.env.DB, body.email)) {
    return c.json({ error: 'Email is already registered' }, 409);
  }

  // Generate ActivityPub keys
  const keys = await generateKeyPair();

  // Create user
  const user = await registerUser(c.env.DB, {
    username: body.username,
    email: body.email,
    password: body.password,
    displayName: body.display_name,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  });

  // Create session
  const session = await createSession(c.env, user.id);
  const maxAge = Math.floor((session.expires_at - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
      },
    }),
    {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(session.id, maxAge),
      },
    }
  );
});

/**
 * POST /auth/login
 * Login with email/password
 */
auth.post('/login', async (c) => {
  const body = await c.req.json<{
    email: string;
    password: string;
  }>();

  if (!body.email || !body.password) {
    return c.json({ error: 'email and password are required' }, 400);
  }

  const user = await loginWithPassword(c.env.DB, body.email, body.password);

  if (!user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  // Create session
  const session = await createSession(c.env, user.id);
  const maxAge = Math.floor((session.expires_at - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        email: user.email,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': setSessionCookie(session.id, maxAge),
      },
    }
  );
});

/**
 * POST /auth/logout
 * Logout and clear session
 */
auth.post('/logout', async (c) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie') ?? null);

  if (sessionId) {
    const session = await getSession(c.env, sessionId);
    if (session) {
      // Revoke OAuth tokens if any
      await revokeOAuthTokens(c.env, c.env.DB, session.user_id);
      await deleteSession(c.env, sessionId);
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearSessionCookie(),
    },
  });
});

// ============================================
// OAuth2 Authentication
// ============================================

/**
 * GET /auth/oauth/authorize
 * Start OAuth2 authorization flow
 */
auth.get('/oauth/authorize', async (c) => {
  if (!isOAuthConfigured(c.env)) {
    return c.json({ error: 'OAuth2 is not configured' }, 400);
  }

  const returnTo = c.req.query('returnTo') ?? '/';
  const hostname = c.env.HOSTNAME ?? new URL(c.req.url).host;
  const redirectUri = `https://${hostname}/auth/callback`;

  // Generate PKCE challenge
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateState();

  // Store state for later verification
  await storeOAuthState(c.env.DB, state, codeVerifier, returnTo);

  // Build authorization URL
  const authUrl = buildAuthorizationUrl(c.env, state, codeChallenge, redirectUri);

  return c.redirect(authUrl);
});

/**
 * GET /auth/callback
 * OAuth2 callback endpoint
 */
auth.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    const errorDescription = c.req.query('error_description') ?? 'Unknown error';
    return c.json({ error, error_description: errorDescription }, 400);
  }

  if (!code || !state) {
    return c.json({ error: 'Missing code or state parameter' }, 400);
  }

  // Verify and consume state
  const oauthState = await consumeOAuthState(c.env.DB, state);
  if (!oauthState) {
    return c.json({ error: 'Invalid or expired state' }, 400);
  }

  const hostname = c.env.HOSTNAME ?? new URL(c.req.url).host;
  const redirectUri = `https://${hostname}/auth/callback`;

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(
      c.env,
      code,
      oauthState.code_verifier,
      redirectUri
    );

    // Get user info from IdP
    const userInfo = await getUserInfo(c.env, tokens.access_token);

    // Generate ActivityPub keys for new users
    const keys = await generateKeyPair();

    // Find or create local user
    const user = await findOrCreateOAuthUser(c.env.DB, userInfo, keys);

    // Store tokens
    await storeOAuthTokens(c.env.DB, user.id, tokens);

    // Create session
    const session = await createSession(c.env, user.id);
    const maxAge = Math.floor((session.expires_at - Date.now()) / 1000);

    // Redirect to original destination
    const returnTo = oauthState.redirect_uri ?? '/';

    return new Response(null, {
      status: 302,
      headers: {
        Location: returnTo,
        'Set-Cookie': setSessionCookie(session.id, maxAge),
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return c.json({ error: 'Authentication failed' }, 500);
  }
});

// ============================================
// Auth Status
// ============================================

/**
 * GET /auth/status
 * Get authentication status and available methods
 */
auth.get('/status', async (c) => {
  const sessionId = getSessionIdFromCookie(c.req.header('Cookie') ?? null);
  let user: LocalUser | null = null;

  if (sessionId) {
    const session = await getSession(c.env, sessionId);
    if (session) {
      user = await c.env.DB.prepare('SELECT * FROM local_users WHERE id = ?')
        .bind(session.user_id)
        .first<LocalUser>();
    }
  }

  return c.json({
    authenticated: !!user,
    user: user
      ? {
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          email: user.email,
          auth_provider: user.auth_provider,
        }
      : null,
    methods: {
      password: true,
      oauth: isOAuthConfigured(c.env),
    },
  });
});

export default auth;
