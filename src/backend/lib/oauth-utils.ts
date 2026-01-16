/**
 * OAuth Utilities
 * PKCE, state generation, etc.
 */

/**
 * ランダムなIDを生成
 */
export function generateId(length = 21): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * PKCE code_verifier を生成 (43-128文字)
 */
export function generateCodeVerifier(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join('');
}

/**
 * PKCE code_challenge を生成 (S256)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

/**
 * Base64 URL エンコード
 */
export function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * OAuth state を保存 (KV)
 */
export interface OAuthState {
  provider: string;
  codeVerifier: string;
  createdAt: number;
}

export async function saveOAuthState(
  kv: KVNamespace,
  state: string,
  data: OAuthState
): Promise<void> {
  await kv.put(`oauth:${state}`, JSON.stringify(data), {
    expirationTtl: 600, // 10分
  });
}

export async function getOAuthState(
  kv: KVNamespace,
  state: string
): Promise<OAuthState | null> {
  const stored = await kv.get(`oauth:${state}`);
  if (!stored) return null;

  const data = JSON.parse(stored) as OAuthState;

  // 有効期限チェック（10分）
  if (Date.now() - data.createdAt > 600000) {
    await kv.delete(`oauth:${state}`);
    return null;
  }

  return data;
}

export async function deleteOAuthState(
  kv: KVNamespace,
  state: string
): Promise<void> {
  await kv.delete(`oauth:${state}`);
}
