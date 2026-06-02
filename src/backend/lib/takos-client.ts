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
import { logger } from "./logger.ts";

const log = logger.child({ component: "takos.client" });
import {
  getOidcClientCredentials,
  getOidcIssuerUrl,
  issuerEndpoint,
} from "./oauth-providers.ts";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// Token refresh lock to prevent concurrent refresh for the same session
const refreshLocks = new Map<string, Promise<TokenResponse | null>>();

/** Classify HTTP status into a coarse error kind safe to log. */
function classifyTokenErrorKind(status: number): string {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_error";
  return "client_error";
}

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
  log.warn("Clearing Takos auth", {
    event: "takos.auth.cleared",
    sessionId,
    reason,
  });
  await db
    .update(sessions)
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
      log.error("Cannot decrypt token", {
        event: "takos.token.decrypt_key_error",
        tokenName,
        message: error.message,
      });
      return null;
    }

    log.error("Unexpected token decrypt error", {
      event: "takos.token.decrypt_unexpected_error",
      tokenName,
      error,
    });
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
  const tokenExpired =
    session.providerTokenExpiresAt &&
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
  const issuer = getOidcIssuerUrl(env);
  const { clientId, clientSecret } = getOidcClientCredentials(env);

  if (!issuer || !clientId || !clientSecret) {
    return null;
  }

  try {
    const url = issuerEndpoint(issuer, "/oauth/token");
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
      // Do NOT log the raw response body; OIDC token endpoints can echo
      // back the refresh_token or client_secret on misconfiguration. Log
      // structured status / statusText / a kind-tag only.
      log.error("Failed to refresh takos token", {
        event: "takos.token.refresh_failed",
        status: res.status,
        statusText: res.statusText,
        error_kind: classifyTokenErrorKind(res.status),
      });
      return null;
    }

    return res.json();
  } catch (err) {
    log.error("Error refreshing takos token", {
      event: "takos.token.refresh_error",
      error: err,
    });
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

  await db
    .update(sessions)
    .set({
      providerAccessToken: encryptedAccessToken,
      ...(encryptedRefreshToken && {
        providerRefreshToken: encryptedRefreshToken,
      }),
      ...(tokenExpiresAt && { providerTokenExpiresAt: tokenExpiresAt }),
    })
    .where(eq(sessions.id, sessionId));
}
