import type { Context } from "hono";
import type { PublicAccountBindings } from "../types";

export interface JWTStore {
  getUser(id: string): Promise<any>;
  getUserJwtSecret(userId: string): Promise<string | null>;
  setUserJwtSecret(userId: string, secret: string): Promise<void>;
}

type JWTContext<TEnv extends { Bindings: PublicAccountBindings }> = Context<TEnv>;

export const DEFAULT_JWT_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 year

// JWT payload structure
export interface JWTPayload {
  sub: string; // user_id
  iat: number; // issued at (seconds)
  exp: number; // expiration (seconds)
}

function getJwtTtlSeconds(env: PublicAccountBindings): number {
  const fromEnv = Number(env.SESSION_TTL_HOURS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return Math.round(fromEnv * 3600);
  }
  return DEFAULT_JWT_TTL_SECONDS;
}

// Generate a random JWT secret for a user
export async function generateJwtSecret(): Promise<string> {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Base64URL encoding
function base64urlEncode(data: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Base64URL decoding
function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '==='.slice((base64.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Create JWT
export async function createJWT(
  userId: string,
  secret: string,
  ttlSeconds: number = DEFAULT_JWT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JWTPayload = {
    sub: userId,
    iat: now,
    exp: now + ttlSeconds,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(header))
  );
  const encodedPayload = base64urlEncode(
    new TextEncoder().encode(JSON.stringify(payload))
  );

  const data = `${encodedHeader}.${encodedPayload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(data)
  );

  const encodedSignature = base64urlEncode(new Uint8Array(signature));
  return `${data}.${encodedSignature}`;
}

// Verify and decode JWT
export async function verifyJWT(
  token: string,
  secret: string,
): Promise<JWTPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const data = `${encodedHeader}.${encodedPayload}`;

    // Verify signature
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signature = base64urlDecode(encodedSignature);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signature,
      new TextEncoder().encode(data)
    );

    if (!valid) return null;

    // Decode payload
    const payloadBytes = base64urlDecode(encodedPayload);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as JWTPayload;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch (error) {
    console.error('JWT verification failed:', error);
    return null;
  }
}

// Extract JWT from Authorization header
export function extractJWT<TEnv extends { Bindings: PublicAccountBindings }>(
  c: JWTContext<TEnv>,
): { token: string | null } {
  const header = c.req.header("Authorization") || "";
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return { token: match[1].trim() };
    }
  }

  return { token: null };
}

// Authenticate using JWT
export async function authenticateJWT<TEnv extends { Bindings: PublicAccountBindings }>(
  c: JWTContext<TEnv>,
  store: JWTStore,
): Promise<{ token: string; payload: JWTPayload; user: any } | null> {
  const { token } = extractJWT(c);
  if (!token) return null;

  // Parse token to get user ID (without verification yet)
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payloadBytes = base64urlDecode(parts[1]);
    const payloadStr = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadStr) as JWTPayload;
    const rawSubject =
      typeof payload?.sub === "string" ? payload.sub.trim() : "";
    const userId = rawSubject;

    if (!userId) {
      console.error("JWT authentication failed: missing subject");
      return null;
    }

    // Get user and their JWT secret
    const user = await store.getUser(userId);
    if (!user) return null;

    const secret = await store.getUserJwtSecret(userId);
    if (!secret) {
      console.error("User has no JWT secret:", userId);
      return null;
    }

    // Verify JWT with user's secret
    const verified = await verifyJWT(token, secret);
    if (!verified) return null;

    return { token, payload: verified, user };
  } catch (error) {
    console.error('JWT authentication failed:', error);
    return null;
  }
}

// Create user JWT (returns token without setting cookie)
export async function createUserJWT<
  TEnv extends { Bindings: PublicAccountBindings } = { Bindings: PublicAccountBindings },
>(
  c: Context<TEnv>,
  store: JWTStore,
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  // Get or create JWT secret for user
  let secret = await store.getUserJwtSecret(userId);
  if (!secret) {
    secret = await generateJwtSecret();
    await store.setUserJwtSecret(userId, secret);
  }

  const ttlSeconds = getJwtTtlSeconds(c.env);
  const token = await createJWT(userId, secret, ttlSeconds);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

  return { token, expiresAt };
}
