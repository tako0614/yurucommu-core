/**
 * Takos API Client
 *
 * takosでログインした場合、保存されたアクセストークンでtakos APIにアクセス可能
 */

import type { Env } from "../types.ts";
import type { Database } from "../../db/index.ts";
import { eq } from "drizzle-orm";
import { sessions } from "../../db/index.ts";
import {
  decrypt,
  DecryptionError,
  encrypt,
  EncryptionKeyError,
} from "./crypto.ts";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// Token refresh lock to prevent concurrent refresh for the same session
const refreshLocks = new Map<string, Promise<TokenResponse | null>>();

export interface TakosSession {
  id: string;
  provider: string | null;
  providerAccessToken: string | null;
  providerRefreshToken: string | null;
  providerTokenExpiresAt: string | null;
}

export interface TakosClient {
  fetch(path: string, options?: RequestInit): Promise<Response>;
  getSpaces(): Promise<{ spaces: TakosSpace[] }>;
  getRepos(spaceId: string): Promise<{ repos: TakosRepo[] }>;
  getUser(): Promise<{ user: TakosUser }>;
}

export interface TakosSpace {
  id: string;
  name: string;
  slug?: string | null;
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

async function clearTakosAuth(
  db: Database,
  sessionId: string,
  reason: string,
): Promise<void> {
  console.warn(
    `[TakosClient] Clearing Takos auth for session ${sessionId}: ${reason}`,
  );
  await db.update(sessions)
    .set({
      provider: null,
      providerAccessToken: null,
      providerRefreshToken: null,
      providerTokenExpiresAt: null,
    })
    .where(eq(sessions.id, sessionId));
}

async function decryptTakosToken(
  db: Database,
  sessionId: string,
  encrypted: string,
  encryptionKey: string | undefined,
  tokenName: string,
): Promise<string | null> {
  try {
    return await decrypt(encrypted, encryptionKey);
  } catch (error) {
    if (error instanceof DecryptionError) {
      await clearTakosAuth(db, sessionId, `invalid ${tokenName}`);
      return null;
    }

    if (error instanceof EncryptionKeyError) {
      console.error(
        `[TakosClient] Cannot decrypt ${tokenName}:`,
        error.message,
      );
      return null;
    }

    console.error(
      `[TakosClient] Unexpected ${tokenName} decrypt error:`,
      error,
    );
    return null;
  }
}

/**
 * セッションからTakosクライアントを取得
 */
export async function getTakosClient(
  env: Env,
  db: Database,
  session: TakosSession,
): Promise<TakosClient | null> {
  if (session.provider !== "takos" || !session.providerAccessToken) return null;
  if (!env.TAKOS_URL) return null;

  let accessToken = await decryptTakosToken(
    db,
    session.id,
    session.providerAccessToken,
    env.ENCRYPTION_KEY,
    "access token",
  );
  if (!accessToken) return null;

  const refreshToken = session.providerRefreshToken
    ? await decryptTakosToken(
      db,
      session.id,
      session.providerRefreshToken,
      env.ENCRYPTION_KEY,
      "refresh token",
    )
    : null;
  if (session.providerRefreshToken && !refreshToken) return null;

  // トークン有効期限チェック（5分前にリフレッシュ）
  const tokenExpired = session.providerTokenExpiresAt &&
    new Date(session.providerTokenExpiresAt).getTime() - Date.now() <
      5 * 60 * 1000;

  if (tokenExpired) {
    if (!refreshToken) return null;

    const newTokens = await refreshWithLock(session.id, env, refreshToken);
    if (!newTokens) return null;

    await updateSessionTokens(db, session.id, newTokens, env.ENCRYPTION_KEY);
    accessToken = newTokens.access_token;
  }

  const baseUrl = env.TAKOS_URL.replace(/\/$/, "");

  async function takosFetch(
    path: string,
    options: RequestInit = {},
  ): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  }

  async function fetchOrThrow<T>(path: string, label: string): Promise<T> {
    const res = await takosFetch(path);
    if (!res.ok) throw new Error(`Failed to get ${label}: ${res.status}`);
    return res.json();
  }

  return {
    fetch: takosFetch,
    getSpaces: () => fetchOrThrow("/api/spaces", "spaces"),
    getRepos: (spaceId: string) =>
      fetchOrThrow(`/api/spaces/${encodeURIComponent(spaceId)}/repos`, "repos"),
    getUser: () => fetchOrThrow("/api/me", "user"),
  };
}

/**
 * Refresh with deduplication lock to prevent concurrent refresh requests for the same session.
 */
async function refreshWithLock(
  sessionId: string,
  env: Env,
  refreshToken: string,
): Promise<TokenResponse | null> {
  const existing = refreshLocks.get(sessionId);
  if (existing) return existing;

  const promise = refreshTakosToken(env, refreshToken);
  refreshLocks.set(sessionId, promise);
  try {
    return await promise;
  } finally {
    refreshLocks.delete(sessionId);
  }
}

async function refreshTakosToken(
  env: Env,
  refreshToken: string,
): Promise<TokenResponse | null> {
  const clientId = env.TAKOS_CLIENT_ID || env.CLIENT_ID;
  const clientSecret = env.TAKOS_CLIENT_SECRET || env.CLIENT_SECRET;

  if (!env.TAKOS_URL || !clientId || !clientSecret) {
    return null;
  }

  try {
    const url = `${env.TAKOS_URL}/oauth/token`;
    const init: RequestInit = {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    };

    const res = await fetch(url, init);

    if (!res.ok) {
      console.error("Failed to refresh takos token:", await res.text());
      return null;
    }

    return res.json();
  } catch (err) {
    console.error("Error refreshing takos token:", err);
    return null;
  }
}

/**
 * セッションのトークンを更新
 */
async function updateSessionTokens(
  db: Database,
  sessionId: string,
  tokens: TokenResponse,
  encryptionKey?: string,
): Promise<void> {
  const tokenExpiresAt = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
    : undefined;

  // Encrypt tokens before storing
  const encryptedAccessToken = await encrypt(
    tokens.access_token,
    encryptionKey,
  );
  const encryptedRefreshToken = tokens.refresh_token
    ? await encrypt(tokens.refresh_token, encryptionKey)
    : undefined;

  await db.update(sessions)
    .set({
      providerAccessToken: encryptedAccessToken,
      ...(encryptedRefreshToken &&
        { providerRefreshToken: encryptedRefreshToken }),
      ...(tokenExpiresAt && { providerTokenExpiresAt: tokenExpiresAt }),
    })
    .where(eq(sessions.id, sessionId));
}
