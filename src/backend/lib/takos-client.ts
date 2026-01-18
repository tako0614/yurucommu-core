/**
 * Takos API Client
 *
 * takosでログインした場合、保存されたアクセストークンでtakos APIにアクセス可能
 */

import type { Env } from '../types';

export interface TakosSession {
  id: string;
  provider: string | null;
  provider_access_token: string | null;
  provider_refresh_token: string | null;
  provider_token_expires_at: string | null;
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
  session: TakosSession
): Promise<TakosClient | null> {
  if (session.provider !== 'takos' || !session.provider_access_token) {
    return null;
  }

  let accessToken = session.provider_access_token;

  // トークン有効期限チェック
  if (session.provider_token_expires_at) {
    const expiresAt = new Date(session.provider_token_expires_at);
    const now = new Date();

    // 5分前にリフレッシュ
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      if (session.provider_refresh_token) {
        const newTokens = await refreshTakosToken(env, session.provider_refresh_token);
        if (newTokens) {
          await updateSessionTokens(env, session.id, newTokens);
          accessToken = newTokens.access_token;
        } else {
          return null;
        }
      } else {
        return null;
      }
    }
  }

  const baseUrl = env.TAKOS_URL;
  if (!baseUrl) return null;

  const takosFetch = async (path: string, options: RequestInit = {}) => {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  };

  return {
    fetch: takosFetch,

    async getWorkspaces() {
      const res = await takosFetch('/workspaces');
      if (!res.ok) throw new Error(`Failed to get workspaces: ${res.status}`);
      return res.json();
    },

    async getRepos() {
      const res = await takosFetch('/repos');
      if (!res.ok) throw new Error(`Failed to get repos: ${res.status}`);
      return res.json();
    },

    async getUser() {
      const res = await takosFetch('/me');
      if (!res.ok) throw new Error(`Failed to get user: ${res.status}`);
      return res.json();
    },
  };
}

/**
 * Takosトークンをリフレッシュ
 */
async function refreshTakosToken(
  env: Env,
  refreshToken: string
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number } | null> {
  if (!env.TAKOS_URL || !env.TAKOS_CLIENT_ID || !env.TAKOS_CLIENT_SECRET) {
    return null;
  }

  try {
    const res = await fetch(`${env.TAKOS_URL}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: env.TAKOS_CLIENT_ID,
        client_secret: env.TAKOS_CLIENT_SECRET,
      }),
    });

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
  env: Env,
  sessionId: string,
  tokens: { access_token: string; refresh_token?: string; expires_in?: number }
): Promise<void> {
  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : null;

  await env.DB.prepare(`
    UPDATE sessions
    SET provider_access_token = ?,
        provider_refresh_token = COALESCE(?, provider_refresh_token),
        provider_token_expires_at = ?
    WHERE id = ?
  `).bind(
    tokens.access_token,
    tokens.refresh_token || null,
    tokenExpiresAt,
    sessionId
  ).run();
}
