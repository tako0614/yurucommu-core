/**
 * OAuth Provider Configuration
 *
 * 環境変数に設定されたプロバイダーのみ有効になる
 * 複数のプロバイダーを自由に組み合わせ可能
 */

import type { Env } from '../types';

export interface OAuthProvider {
  id: string;
  name: string;
  icon: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  // PKCE対応
  supportsPkce: boolean;
  // takos固有: APIアクセス用
  apiBaseUrl?: string;
}

export interface AuthConfig {
  passwordEnabled: boolean;
  providers: OAuthProvider[];
}

/**
 * 環境変数から有効な認証方法を取得
 */
export function getAuthConfig(env: Env): AuthConfig {
  const providers: OAuthProvider[] = [];

  // Google OAuth
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({
      id: 'google',
      name: 'Google',
      icon: '/icons/google.svg',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      scopes: ['openid', 'profile', 'email'],
      supportsPkce: true,
    });
  }

  // X (Twitter) OAuth 2.0
  if (env.X_CLIENT_ID && env.X_CLIENT_SECRET) {
    providers.push({
      id: 'x',
      name: 'X',
      icon: '/icons/x.svg',
      authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
      tokenUrl: 'https://api.twitter.com/2/oauth2/token',
      userInfoUrl: 'https://api.twitter.com/2/users/me',
      scopes: ['tweet.read', 'users.read', 'offline.access'],
      supportsPkce: true,
    });
  }

  // Takos OAuth
  if (env.TAKOS_URL && env.TAKOS_CLIENT_ID && env.TAKOS_CLIENT_SECRET) {
    providers.push({
      id: 'takos',
      name: 'Takos',
      icon: '/icons/takos.svg',
      authorizeUrl: `${env.TAKOS_URL}/oauth/authorize`,
      tokenUrl: `${env.TAKOS_URL}/oauth/token`,
      userInfoUrl: `${env.TAKOS_URL}/oauth/userinfo`,
      scopes: ['openid', 'profile', 'email', 'workspaces:read', 'repos:read'],
      supportsPkce: true,
      apiBaseUrl: env.TAKOS_URL,
    });
  }

  return {
    // AUTH_PASSWORD_HASH (secure) or AUTH_PASSWORD (legacy)
    passwordEnabled: !!(env.AUTH_PASSWORD_HASH || env.AUTH_PASSWORD),
    providers,
  };
}

/**
 * プロバイダーIDからプロバイダー設定を取得
 */
export function getProvider(env: Env, providerId: string): OAuthProvider | null {
  const config = getAuthConfig(env);
  return config.providers.find(p => p.id === providerId) || null;
}

/**
 * プロバイダーIDからクライアントIDを取得
 */
export function getClientId(env: Env, providerId: string): string {
  switch (providerId) {
    case 'google':
      return env.GOOGLE_CLIENT_ID || '';
    case 'x':
      return env.X_CLIENT_ID || '';
    case 'takos':
      return env.TAKOS_CLIENT_ID || '';
    default:
      return '';
  }
}

/**
 * プロバイダーIDからクライアントシークレットを取得
 */
export function getClientSecret(env: Env, providerId: string): string {
  switch (providerId) {
    case 'google':
      return env.GOOGLE_CLIENT_SECRET || '';
    case 'x':
      return env.X_CLIENT_SECRET || '';
    case 'takos':
      return env.TAKOS_CLIENT_SECRET || '';
    default:
      return '';
  }
}

/**
 * ユーザー情報を正規化
 */
export interface NormalizedUserInfo {
  id: string;
  name: string;
  email?: string;
  picture?: string;
  username?: string;
}

export async function fetchUserInfo(
  provider: OAuthProvider,
  accessToken: string
): Promise<NormalizedUserInfo> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  // X requires specific fields
  let url = provider.userInfoUrl;
  if (provider.id === 'x') {
    url += '?user.fields=profile_image_url';
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;

  // 正規化
  switch (provider.id) {
    case 'google': {
      const g = data as { id: string; name: string; email: string; picture: string };
      return {
        id: g.id,
        name: g.name,
        email: g.email,
        picture: g.picture,
      };
    }
    case 'x': {
      const x = data as { data: { id: string; name: string; username: string; profile_image_url?: string } };
      return {
        id: x.data.id,
        name: x.data.name,
        username: x.data.username,
        picture: x.data.profile_image_url,
      };
    }
    case 'takos': {
      const t = data as { user: { id: string; name: string; email: string; picture?: string } };
      return {
        id: t.user.id,
        name: t.user.name,
        email: t.user.email,
        picture: t.user.picture,
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider.id}`);
  }
}
