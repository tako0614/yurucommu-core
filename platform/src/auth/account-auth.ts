import type { Context } from "hono";
import { makeData } from "../server/data-factory";

export const TOKEN_PREFIX = "acc_";
const TOKEN_LENGTH = 48;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  return (
    TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")
  ).slice(0, TOKEN_PREFIX.length + TOKEN_LENGTH);
}

export async function hashToken(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyAccessToken(
  c: Context,
  headerValue: string | null,
): Promise<{ userId: string; tokenId: string } | null> {
  if (!headerValue) return null;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;
  const tokenHash = await hashToken(token);
  const store = makeData(c.env as any);
  try {
    const row = await store.getAccessTokenByHash(tokenHash);
    if (!row) return null;
    if (row.expires_at) {
      const exp = new Date(row.expires_at);
      if (exp.getTime() <= Date.now()) {
        await store.deleteAccessToken(tokenHash);
        return null;
      }
    }
    await store.touchAccessToken(tokenHash, { last_used_at: new Date() });
    return {
      userId: row.user_id,
      tokenId: row.id,
    };
  } finally {
    await store.disconnect();
  }
}

