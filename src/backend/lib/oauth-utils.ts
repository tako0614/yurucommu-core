/**
 * OAuth Utilities -- PKCE, state generation, and KV-backed state storage.
 *
 * State tokens use dual-layer expiration:
 *   1. KV TTL (600 s) -- authoritative, auto-deletes the key.
 *   2. Manual createdAt check in getOAuthState() -- defense-in-depth
 *      against KV eventual-consistency delays.
 */

const ALPHANUMERIC =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const PKCE_CHARSET = ALPHANUMERIC + "-._~";
const OAUTH_KV_PREFIX = "oauth:";
const STATE_TTL_SECONDS = 600;
const STATE_TTL_MS = STATE_TTL_SECONDS * 1000;

/**
 * Generate a cryptographically random string from the given alphabet.
 */
function randomString(length: number, alphabet: string): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function generateId(length = 21): string {
  return randomString(length, ALPHANUMERIC);
}

/**
 * Generate a PKCE code_verifier (64 characters from the unreserved charset).
 */
export function generateCodeVerifier(): string {
  return randomString(64, PKCE_CHARSET);
}

/**
 * Generate a random nonce for OAuth CSRF browser-session binding (32 chars).
 */
export function generateNonce(): string {
  return randomString(32, ALPHANUMERIC);
}

/**
 * PKCE code_challenge を生成 (S256)
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}

/**
 * Base64-URL-encode an ArrayBuffer (RFC 4648 section 5, no padding).
 * Uses chunked conversion to avoid stack overflow on large buffers.
 */
export function base64UrlEncode(
  buffer: ArrayBuffer | null | undefined,
): string {
  if (buffer == null) {
    throw new Error("base64UrlEncode: buffer cannot be null or undefined");
  }
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("base64UrlEncode: buffer must be an ArrayBuffer");
  }
  if (buffer.byteLength === 0) {
    return "";
  }

  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export interface OAuthState {
  provider: string;
  codeVerifier: string;
  createdAt: number;
  /**
   * Browser-session binding nonce for login CSRF protection (Issue 107).
   * Set as a short-lived HttpOnly cookie on the initiating browser and stored
   * here so the callback handler can verify both values match.
   */
  nonce?: string;
}

function oauthKey(state: string): string {
  return `${OAUTH_KV_PREFIX}${state}`;
}

export async function saveOAuthState(
  kv: KVNamespace,
  state: string,
  data: OAuthState,
): Promise<void> {
  await kv.put(oauthKey(state), JSON.stringify(data), {
    expirationTtl: STATE_TTL_SECONDS,
  });
}

export async function getOAuthState(
  kv: KVNamespace,
  state: string,
): Promise<OAuthState | null> {
  const stored = await kv.get(oauthKey(state));
  if (!stored) return null;

  const data = JSON.parse(stored) as OAuthState;

  // Defense-in-depth: reject expired states even if KV TTL hasn't propagated
  if (Date.now() - data.createdAt > STATE_TTL_MS) {
    await kv.delete(oauthKey(state));
    return null;
  }

  return data;
}

export async function deleteOAuthState(
  kv: KVNamespace,
  state: string,
): Promise<void> {
  await kv.delete(oauthKey(state));
}
