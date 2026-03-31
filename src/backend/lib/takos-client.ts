/**
 * Takos API Client
 *
 * takosでログインした場合、保存されたアクセストークンでtakos APIにアクセス可能
 */

import type { Env } from '../types.ts';
import type { Database } from '../../db/index.ts';
import { eq } from 'drizzle-orm';
import { sessions } from '../../db/index.ts';
import { decrypt, encrypt } from './crypto.ts';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// Token refresh lock to prevent concurrent refresh for the same session
const refreshLocks = new Map<string, Promise<TokenResponse | null>>();

export interface TakosSession {
  id: string;
  provider: string | null;
  providerAccessToken: string | null;
  providerRefreshToken: string | null;
  providerTokenExpiresAt: string | null;
}

export interface TakosClient {
  fetch(path: string, options?: RequestInit): Promise<Response>;
  getWorkspaces(): Promise<{ workspaces: TakosWorkspace[] }>;
  getRepos(): Promise<{ repos: TakosRepo[] }>;
  getUser(): Promise<{ user: TakosUser }>;
}

export interface TakosWorkspace {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface TakosRepo {
  id: string;
  name: string;
  description: string | null;
  visibility: string;
  created_at: string;
}

export interface TakosUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

/**
 * セッションからTakosクライアントを取得
 */
export async function getTakosClient(
  env: Env,
  db: Database,
  session: TakosSession
): Promise<TakosClient | null> {
  if (session.provider !== 'takos' || !session.providerAccessToken) return null;
  if (!env.TAKOS_URL) return null;

  let accessToken = await decrypt(session.providerAccessToken, env.ENCRYPTION_KEY);
  const refreshToken = session.providerRefreshToken
    ? await decrypt(session.providerRefreshToken, env.ENCRYPTION_KEY)
    : null;

  // トークン有効期限チェック（5分前にリフレッシュ）
  const tokenExpired = session.providerTokenExpiresAt &&
    new Date(session.providerTokenExpiresAt).getTime() - Date.now() < 5 * 60 * 1000;

  if (tokenExpired) {
    if (!refreshToken) return null;

    const newTokens = await refreshWithLock(session.id, env, refreshToken);
    if (!newTokens) return null;

    await updateSessionTokens(db, session.id, newTokens, env.ENCRYPTION_KEY);
    accessToken = newTokens.access_token;
  }

  const baseUrl = env.TAKOS_URL;

  async function takosFetch(path: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  async function fetchOrThrow<T>(path: string, label: string): Promise<T> {
    const res = await takosFetch(path);
    if (!res.ok) throw new Error(`Failed to get ${label}: ${res.status}`);
    return res.json();
  }

  return {
    fetch: takosFetch,
    getWorkspaces: () => fetchOrThrow('/workspaces', 'workspaces'),
    getRepos: () => fetchOrThrow('/repos', 'repos'),
    getUser: () => fetchOrThrow('/me', 'user'),
  };
}

/**
 * Refresh with deduplication lock to prevent concurrent refresh requests for the same session.
 */
async function refreshWithLock(
  sessionId: string,
  env: Env,
  refreshToken: string
): Promise<TokenResponse | null> {
  const existing = refreshLocks.get(sessionId);
  if (existing) return existing;

  const promise = refreshTakosToken(env, refreshToken);
  refreshLocks.set(sessionId, promise);
  try {
    return await promise;
  } finally {
    refreshLocks.delete(sessionId);
  }
}

async function refreshTakosToken(
  env: Env,
  refreshToken: string
): Promise<TokenResponse | null> {
  const clientId = env.TAKOS_CLIENT_ID || env.CLIENT_ID;
  const clientSecret = env.TAKOS_CLIENT_SECRET || env.CLIENT_SECRET;

  if (!env.TAKOS_URL || !clientId || !clientSecret) {
    return null;
  }

  try {
    const url = `${env.TAKOS_URL}/oauth/token`;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    };

    const res = await fetch(url, init);

    if (!res.ok) {
      console.error('Failed to refresh takos token:', await res.text());
      return null;
    }

    return res.json();
  } catch (err) {
    console.error('Error refreshing takos token:', err);
    return null;
  }
}

/**
 * セッションのトークンを更新
 */
async function updateSessionTokens(
  db: Database,
  sessionId: string,
  tokens: TokenResponse,
  encryptionKey?: string
): Promise<void> {
  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : undefined;

  // Encrypt tokens before storing
  const encryptedAccessToken = await encrypt(tokens.access_token, encryptionKey);
  const encryptedRefreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token, encryptionKey)
    : undefined;

  await db.update(sessions)
    .set({
      providerAccessToken: encryptedAccessToken,
      ...(encryptedRefreshToken && { providerRefreshToken: encryptedRefreshToken }),
      ...(tokenExpiresAt && { providerTokenExpiresAt: tokenExpiresAt }),
    })
    .where(eq(sessions.id, sessionId));
}
