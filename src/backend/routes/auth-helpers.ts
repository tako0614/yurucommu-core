import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env, Variables } from "../types.ts";
import {
  actorApId,
  generateId,
  generateKeyPair,
} from "../federation-helpers.ts";
import { encrypt } from "../lib/crypto.ts";
import { getClientCredentials } from "../lib/oauth-providers.ts";
import type { Database } from "../../db/index.ts";
import { count, eq } from "drizzle-orm";
import { actors, sessions } from "../../db/index.ts";
import { parseJsonObject, parseNonEmptyString } from "../lib/parse-helpers.ts";

/** Session lifetime: 30 days in seconds. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

export { parseJsonObject, parseNonEmptyString };

export function formatAccountResponse(
  a: {
    apId: string;
    preferredUsername: string;
    name: string | null;
    iconUrl: string | null;
  },
): {
  ap_id: string;
  preferred_username: string;
  name: string | null;
  icon_url: string | null;
} {
  return {
    ap_id: a.apId,
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
  };
}

export async function deleteSessionSafely(
  db: Database,
  sessionId: string,
  context: string,
): Promise<void> {
  try {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  } catch (err) {
    console.warn(`[Auth] Failed to delete session during ${context}`, err);
  }
}

/**
 * Invalidates any existing session, creates a fresh one, and sets the cookie.
 * Centralises session-rotation logic used by both password and OAuth login.
 */
export async function rotateSession(
  c: HonoContext,
  memberApId: string,
  provider: string | null,
  tokens: OAuthTokens | null,
  encryptionKey: string | undefined,
  rotationContext: string,
): Promise<string> {
  const db = c.get("db");

  // Invalidate existing session
  const existingSessionId = getCookie(c, "session");
  if (existingSessionId) {
    await deleteSessionSafely(db, existingSessionId, rotationContext);
    deleteCookie(c, "session");
  }

  // Create new session with encrypted tokens
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000)
    .toISOString();

  await db.insert(sessions).values({
    id: sessionId,
    memberId: memberApId,
    accessToken: sessionId,
    expiresAt,
    provider,
    providerAccessToken: tokens?.access_token
      ? await encrypt(tokens.access_token, encryptionKey)
      : null,
    providerRefreshToken: tokens?.refresh_token
      ? await encrypt(tokens.refresh_token, encryptionKey)
      : null,
    providerTokenExpiresAt: tokens?.expires_in
      ? new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      : null,
  });

  // Set cookie
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  return sessionId;
}

export function actorEndpoints(apId: string) {
  return {
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
  };
}

/** Resolves a unique username by appending a counter on collision. */
export async function resolveUniqueUsername(
  db: Database,
  baseUrl: string,
  baseUsername: string,
): Promise<string> {
  let username = baseUsername;
  let counter = 1;
  while (
    await db.select({ apId: actors.apId }).from(actors).where(
      eq(actors.apId, actorApId(baseUrl, username)),
    ).get()
  ) {
    username = `${baseUsername}${counter}`;
    counter++;
  }
  return username;
}

export async function createActor(
  db: Database,
  env: Env,
  opts: {
    username: string;
    name: string;
    iconUrl?: string | null;
    takosUserId: string;
    role: string;
    ownerActorApId?: string | null;
  },
) {
  const apId = actorApId(env.APP_URL, opts.username);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  return await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: opts.username,
    name: opts.name,
    iconUrl: opts.iconUrl ?? null,
    ...actorEndpoints(apId),
    publicKeyPem,
    privateKeyPem,
    takosUserId: opts.takosUserId,
    role: opts.role,
    ownerActorApId: opts.ownerActorApId ?? null,
  }).returning().get();
}

export async function createActorFromOAuth(
  db: Database,
  env: Env,
  userInfo: {
    id: string;
    name: string;
    email?: string;
    picture?: string;
    username?: string;
  },
  providerUserId: string,
) {
  const baseUsername = userInfo.username ||
    userInfo.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  const username = await resolveUniqueUsername(db, env.APP_URL, baseUsername);
  const result = await db.select({ count: count() }).from(actors).get();
  const actorCount = result?.count ?? 0;

  return await createActor(db, env, {
    username,
    name: userInfo.name,
    iconUrl: userInfo.picture,
    takosUserId: providerUserId,
    role: actorCount === 0 ? "owner" : "member",
  });
}

export function lockoutErrorResponse(
  retryAfterSeconds: number,
): { error: string; retry_after: number } {
  return {
    error: "Too many failed login attempts. Please try again later.",
    retry_after: retryAfterSeconds,
  };
}

/** Exchange an OAuth authorization code for tokens. Returns null on failure. */
export async function exchangeOAuthToken(
  providerId: string,
  code: string,
  codeVerifier: string | undefined,
  env: Env,
  provider: { tokenUrl: string; supportsPkce: boolean },
): Promise<OAuthTokens | null> {
  const { clientId, clientSecret } = getClientCredentials(env, providerId);
  const redirectUri = `${env.APP_URL}/api/auth/callback/${providerId}`;

  const tokenBody: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  };

  if (provider.supportsPkce && codeVerifier) {
    tokenBody.code_verifier = codeVerifier;
  }

  const tokenHeaders: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (providerId === "x") {
    tokenHeaders["Authorization"] = `Basic ${
      btoa(`${clientId}:${clientSecret}`)
    }`;
    delete tokenBody.client_secret;
  }

  const tokenUrl = provider.tokenUrl;
  const requestInit: RequestInit = {
    method: "POST",
    headers: tokenHeaders,
    body: new URLSearchParams(tokenBody),
  };

  const res = await fetch(tokenUrl, requestInit);

  if (!res.ok) {
    console.error("Token exchange failed:", {
      status: res.status,
      statusText: res.statusText,
      body: await res.text(),
      url: provider.tokenUrl,
    });
    return null;
  }

  return await res.json() as OAuthTokens;
}

/** Look up an existing actor by provider user ID, or create a new one. */
export async function findOrCreateOAuthActor(
  db: Database,
  env: Env,
  providerId: string,
  userInfo: {
    id: string;
    name: string;
    email?: string;
    picture?: string;
    username?: string;
  },
) {
  const providerUserId = providerId === "takos"
    ? userInfo.id
    : `${providerId}:${userInfo.id}`;

  let actorData = await db.select().from(actors).where(
    eq(actors.takosUserId, providerUserId),
  ).get();

  if (!actorData) {
    actorData = await createActorFromOAuth(db, env, userInfo, providerUserId);
  } else {
    await db.update(actors)
      .set({
        name: userInfo.name,
        ...(userInfo.picture ? { iconUrl: userInfo.picture } : {}),
      })
      .where(eq(actors.apId, actorData.apId))
      .run();
  }

  return actorData;
}
