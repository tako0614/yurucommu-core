import type { Context } from "hono";
import { hashToken } from "@takos/platform/auth/account-auth";
import { makeData } from "@takos/platform/server";

const TOKEN_PREFIX = "acc_";
const TOKEN_LENGTH = 48;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(36));
  return (
    TOKEN_PREFIX + btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "")
  ).slice(0, TOKEN_PREFIX.length + TOKEN_LENGTH);
}

export async function mintAccessToken(
  c: Context,
  userId: string,
  label = "default",
  expiresAt?: Date | null,
): Promise<string> {
  const store = makeData(c.env as any);
  try {
    const rawToken = randomToken();
    const tokenHash = await hashToken(rawToken);
    await store.createAccessToken({
      user_id: userId,
      token_hash: tokenHash,
      label,
      expires_at: expiresAt ?? null,
    });
    return rawToken;
  } finally {
    await store.disconnect?.();
  }
}

export async function revokeAccessTokenByHash(c: Context, tokenHash: string) {
  const store = makeData(c.env as any);
  try {
    await store.deleteAccessToken(tokenHash);
  } finally {
    await store.disconnect?.();
  }
}

export async function getAccessTokenByHash(c: Context, tokenHash: string) {
  const store = makeData(c.env as any);
  try {
    return store.getAccessTokenByHash(tokenHash);
  } finally {
    await store.disconnect?.();
  }
}
