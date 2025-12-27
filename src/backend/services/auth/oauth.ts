/**
 * OAuth2 Client Service
 * Handles OAuth2 Authorization Code flow with PKCE
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Env, LocalUser, OAuthState, OAuthToken } from '../../types';

const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Generate a random string for state/verifier
 */
function generateRandomString(length: number): string {
  const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues)
    .map((v) => charset[v % charset.length])
    .join('');
}

/**
 * Generate code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return generateRandomString(64);
}

/**
 * Generate code challenge from verifier (S256)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);

  // Base64URL encode
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate state parameter
 */
export function generateState(): string {
  return generateRandomString(32);
}

/**
 * Store OAuth state in database
 */
export async function storeOAuthState(
  db: D1Database,
  state: string,
  codeVerifier: string,
  redirectUri?: string
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + STATE_EXPIRY_MS);

  await db
    .prepare(
      `INSERT INTO oauth_states (id, state, code_verifier, redirect_uri, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      state,
      codeVerifier,
      redirectUri ?? null,
      now.toISOString(),
      expiresAt.toISOString()
    )
    .run();
}

/**
 * Retrieve and consume OAuth state
 */
export async function consumeOAuthState(
  db: D1Database,
  state: string
): Promise<OAuthState | null> {
  const oauthState = await db
    .prepare('SELECT * FROM oauth_states WHERE state = ?')
    .bind(state)
    .first<OAuthState>();

  if (!oauthState) {
    return null;
  }

  // Check expiration
  if (new Date(oauthState.expires_at) < new Date()) {
    await db
      .prepare('DELETE FROM oauth_states WHERE id = ?')
      .bind(oauthState.id)
      .run();
    return null;
  }

  // Delete the state (one-time use)
  await db
    .prepare('DELETE FROM oauth_states WHERE id = ?')
    .bind(oauthState.id)
    .run();

  return oauthState;
}

/**
 * Clean up expired OAuth states
 */
export async function cleanupExpiredStates(db: D1Database): Promise<void> {
  await db
    .prepare('DELETE FROM oauth_states WHERE expires_at < ?')
    .bind(new Date().toISOString())
    .run();
}

/**
 * Build authorization URL
 */
export function buildAuthorizationUrl(
  env: Env,
  state: string,
  codeChallenge: string,
  redirectUri: string
): string {
  if (!env.OAUTH_ISSUER || !env.OAUTH_CLIENT_ID) {
    throw new Error('OAuth2 is not configured');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.OAUTH_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${env.OAUTH_ISSUER}/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  env: Env,
  code: string,
  codeVerifier: string,
  redirectUri: string
): Promise<{
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}> {
  if (!env.OAUTH_ISSUER || !env.OAUTH_CLIENT_ID) {
    throw new Error('OAuth2 is not configured');
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: env.OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  // Add client secret if configured (confidential client)
  if (env.OAUTH_CLIENT_SECRET) {
    body.set('client_secret', env.OAUTH_CLIENT_SECRET);
  }

  const response = await fetch(`${env.OAUTH_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Get user info from IdP
 */
export async function getUserInfo(
  env: Env,
  accessToken: string
): Promise<{
  sub: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  email?: string;
}> {
  if (!env.OAUTH_ISSUER) {
    throw new Error('OAuth2 is not configured');
  }

  // Try userinfo endpoint first
  const response = await fetch(`${env.OAUTH_ISSUER}/oauth/userinfo`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    // Fallback to introspection or decode JWT
    throw new Error('Failed to get user info');
  }

  return response.json();
}

/**
 * Find or create user from OAuth2 profile
 */
export async function findOrCreateOAuthUser(
  db: D1Database,
  profile: {
    sub: string;
    name?: string;
    preferred_username?: string;
    picture?: string;
    email?: string;
  },
  keys: { publicKey: string; privateKey: string }
): Promise<LocalUser> {
  // Check if user exists by external_user_id
  let user = await db
    .prepare('SELECT * FROM local_users WHERE external_user_id = ?')
    .bind(profile.sub)
    .first<LocalUser>();

  if (user) {
    return user;
  }

  // Create new user
  const id = crypto.randomUUID();
  const username =
    profile.preferred_username ?? profile.name ?? `user_${profile.sub.slice(0, 8)}`;
  const displayName = profile.name ?? username;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO local_users (
        id, username, display_name, summary, avatar_url, public_key, private_key,
        email, auth_provider, external_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, '', ?, ?, ?, ?, 'oauth2', ?, ?, ?)`
    )
    .bind(
      id,
      username,
      displayName,
      profile.picture ?? null,
      keys.publicKey,
      keys.privateKey,
      profile.email ?? null,
      profile.sub,
      now,
      now
    )
    .run();

  user = await db
    .prepare('SELECT * FROM local_users WHERE id = ?')
    .bind(id)
    .first<LocalUser>();

  if (!user) {
    throw new Error('Failed to create OAuth user');
  }

  return user;
}

/**
 * Store OAuth tokens for a user
 */
export async function storeOAuthTokens(
  db: D1Database,
  userId: string,
  tokens: {
    access_token: string;
    refresh_token?: string;
    token_type: string;
    scope?: string;
    expires_in?: number;
  }
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = tokens.expires_in
    ? new Date(now.getTime() + tokens.expires_in * 1000)
    : null;

  // Delete existing tokens for this user
  await db
    .prepare('DELETE FROM oauth_tokens WHERE user_id = ?')
    .bind(userId)
    .run();

  await db
    .prepare(
      `INSERT INTO oauth_tokens (
        id, user_id, access_token, refresh_token, token_type, scope, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      userId,
      tokens.access_token,
      tokens.refresh_token ?? null,
      tokens.token_type,
      tokens.scope ?? null,
      expiresAt?.toISOString() ?? null,
      now.toISOString(),
      now.toISOString()
    )
    .run();
}

/**
 * Get stored OAuth tokens for a user
 */
export async function getOAuthTokens(
  db: D1Database,
  userId: string
): Promise<OAuthToken | null> {
  return db
    .prepare('SELECT * FROM oauth_tokens WHERE user_id = ?')
    .bind(userId)
    .first<OAuthToken>();
}

/**
 * Revoke OAuth tokens (at IdP and locally)
 */
export async function revokeOAuthTokens(
  env: Env,
  db: D1Database,
  userId: string
): Promise<void> {
  const tokens = await getOAuthTokens(db, userId);

  if (tokens && env.OAUTH_ISSUER) {
    // Try to revoke at IdP
    try {
      await fetch(`${env.OAUTH_ISSUER}/oauth/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: tokens.access_token,
          client_id: env.OAUTH_CLIENT_ID ?? '',
        }).toString(),
      });
    } catch {
      // Ignore revocation errors
    }
  }

  // Delete local tokens
  await db
    .prepare('DELETE FROM oauth_tokens WHERE user_id = ?')
    .bind(userId)
    .run();
}

/**
 * Check if OAuth2 is configured
 */
export function isOAuthConfigured(env: Env): boolean {
  return !!(env.OAUTH_ISSUER && env.OAUTH_CLIENT_ID);
}
