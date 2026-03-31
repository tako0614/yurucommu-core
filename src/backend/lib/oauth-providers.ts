/**
 * OAuth Provider Configuration
 *
 * 環境変数に設定されたプロバイダーのみ有効になる
 * 複数のプロバイダーを自由に組み合わせ可能
 */

import type { Env } from '../types.ts';

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
  const takosUrl = env.TAKOS_URL;
  const takosClientId = env.TAKOS_CLIENT_ID || env.CLIENT_ID;
  const takosClientSecret = env.TAKOS_CLIENT_SECRET || env.CLIENT_SECRET;
  if (takosUrl && takosClientId && takosClientSecret) {
    providers.push({
      id: 'takos',
      name: 'Takos',
      icon: '/icons/takos.svg',
      authorizeUrl: `${takosUrl}/oauth/authorize`,
      tokenUrl: `${takosUrl}/oauth/token`,
      userInfoUrl: `${takosUrl}/oauth/userinfo`,
      scopes: ['openid', 'profile', 'email', 'workspaces:read', 'repos:read'],
      supportsPkce: true,
      apiBaseUrl: takosUrl,
    });
  }

  return {
    passwordEnabled: !!env.AUTH_PASSWORD_HASH,
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
 * プロバイダーIDからクライアント認証情報を取得
 */
export function getClientCredentials(env: Env, providerId: string): { clientId: string; clientSecret: string } {
  switch (providerId) {
    case 'google':
      return { clientId: env.GOOGLE_CLIENT_ID || '', clientSecret: env.GOOGLE_CLIENT_SECRET || '' };
    case 'x':
      return { clientId: env.X_CLIENT_ID || '', clientSecret: env.X_CLIENT_SECRET || '' };
    case 'takos':
      return {
        clientId: env.TAKOS_CLIENT_ID || env.CLIENT_ID || '',
        clientSecret: env.TAKOS_CLIENT_SECRET || env.CLIENT_SECRET || '',
      };
    default:
      return { clientId: '', clientSecret: '' };
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
  const url = provider.id === 'x'
    ? `${provider.userInfoUrl}?user.fields=profile_image_url`
    : provider.userInfoUrl;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${res.status}`);
  }

  const data = await res.json() as Record<string, unknown>;

  switch (provider.id) {
    case 'google': {
      const g = data as { id: string; name: string; email: string; picture: string };
      return { id: g.id, name: g.name, email: g.email, picture: g.picture };
    }
    case 'x': {
      const x = data as { data: { id: string; name: string; username: string; profile_image_url?: string } };
      return { id: x.data.id, name: x.data.name, username: x.data.username, picture: x.data.profile_image_url };
    }
    case 'takos': {
      const t = data as { user: { id: string; name: string; email: string; picture?: string } };
      return { id: t.user.id, name: t.user.name, email: t.user.email, picture: t.user.picture };
    }
    default:
      throw new Error(`Unknown provider: ${provider.id}`);
  }
}
