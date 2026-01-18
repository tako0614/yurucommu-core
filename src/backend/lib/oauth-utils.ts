/**
 * OAuth Utilities
 * PKCE, state generation, etc.
 *
 * OAuth State Expiration Strategy:
 * ================================
 * This module uses a dual-layer expiration approach for OAuth state tokens:
 *
 * 1. PRIMARY: KV TTL (expirationTtl: 600 seconds = 10 minutes)
 *    - Cloudflare KV automatically deletes the key after 10 minutes
 *    - This is the authoritative expiration mechanism
 *    - Handles cleanup automatically, no background jobs needed
 *
 * 2. SECONDARY: Manual timestamp check in getOAuthState()
 *    - Validates createdAt + 600000ms (10 minutes) hasn't passed
 *    - Acts as a defense-in-depth measure
 *    - Catches edge cases where KV TTL hasn't propagated yet
 *    - Ensures consistent behavior even if KV caching delays TTL
 *
 * Why both?
 * - KV TTL is eventually consistent and may have slight delays
 * - Manual check provides immediate, deterministic expiration
 * - Together they ensure state tokens cannot be reused after 10 minutes
 *
 * Security: The 10-minute window balances:
 * - User experience (enough time to complete OAuth flow)
 * - Security (limits replay attack window)
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
 * S28: Added input validation and proper error handling
 */
export function base64UrlEncode(buffer: ArrayBuffer | null | undefined): string {
  // S28: Input validation
  if (buffer == null) {
    throw new Error('base64UrlEncode: buffer cannot be null or undefined');
  }

  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error('base64UrlEncode: buffer must be an ArrayBuffer');
  }

  // S28: Handle empty buffer edge case
  if (buffer.byteLength === 0) {
    return '';
  }

  try {
    const bytes = new Uint8Array(buffer);

    // S28: Use chunked approach for large buffers to avoid stack overflow
    const CHUNK_SIZE = 8192;
    let binary = '';

    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  } catch (error) {
    throw new Error(`base64UrlEncode: encoding failed - ${error instanceof Error ? error.message : String(error)}`);
  }
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
    // PRIMARY expiration: KV TTL auto-deletes after 10 minutes
    // This is the authoritative expiration mechanism
    expirationTtl: 600, // 10 minutes in seconds
  });
}

export async function getOAuthState(
  kv: KVNamespace,
  state: string
): Promise<OAuthState | null> {
  const stored = await kv.get(`oauth:${state}`);
  if (!stored) return null;

  const data = JSON.parse(stored) as OAuthState;

  // SECONDARY expiration: Manual timestamp check (defense-in-depth)
  // KV TTL is eventually consistent, so this ensures immediate rejection
  // of expired states even if the KV deletion hasn't propagated yet
  const STATE_TTL_MS = 600000; // 10 minutes in milliseconds (matches KV TTL)
  if (Date.now() - data.createdAt > STATE_TTL_MS) {
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
