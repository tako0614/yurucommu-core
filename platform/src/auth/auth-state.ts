export type OAuthStatePayload = {
  id: string;
  createdAt: number;
  redirectUri?: string | null;
  clientState?: string | null;
  responseMode?: "token" | null;
};

declare const Buffer: any;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function btoaUniversal(input: string): string {
  const g = globalThis as Record<string, any>;
  if (typeof g.btoa === "function") {
    return g.btoa(input);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "binary").toString("base64");
  }
  throw new Error("Base64 encoding not supported in this environment");
}

function atobUniversal(input: string): string {
  const g = globalThis as Record<string, any>;
  if (typeof g.atob === "function") {
    return g.atob(input);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(input, "base64").toString("binary");
  }
  throw new Error("Base64 decoding not supported in this environment");
}

export const MAX_STATE_AGE_MS = 5 * 60_000;

export function getOAuthStateSecret(env: {
  OAUTH_STATE_SECRET?: string;
  PUSH_WEBHOOK_SECRET?: string;
}): string | null {
  const secret =
    env.OAUTH_STATE_SECRET?.trim() ||
    env.PUSH_WEBHOOK_SECRET?.trim();
  return secret && secret.length > 0 ? secret : null;
}

function base64UrlEncode(input: string): string {
  const binary = btoaUniversal(input);
  return binary.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return base64UrlEncode(binary);
}

function base64UrlDecode(input: string): string {
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4 !== 0) {
    normalized += "=";
  }
  return atobUniversal(normalized);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(data),
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export async function encodeOAuthState(
  payload: OAuthStatePayload,
  secret: string,
): Promise<string> {
  const json = JSON.stringify(payload);
  const payloadB64 = base64UrlEncodeBytes(encoder.encode(json));
  const signature = await hmacSha256(secret, payloadB64);
  return `${payloadB64}.${signature}`;
}

export async function decodeOAuthState(
  state: string,
  secret: string,
): Promise<OAuthStatePayload | null> {
  if (!state || typeof state !== "string") return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;
  const expected = await hmacSha256(secret, payloadB64);
  if (!timingSafeEqual(signature, expected)) {
    return null;
  }
  try {
    const payloadStr = decoder.decode(
      Uint8Array.from(base64UrlDecode(payloadB64), (c) => c.charCodeAt(0)),
    );
    const payload = JSON.parse(payloadStr) as OAuthStatePayload;
    if (typeof payload.createdAt !== "number" || !payload.id) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
