import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env, Variables } from "../types.ts";
import {
  actorApId,
  generateId,
  generateKeyPair,
} from "../federation-helpers.ts";
import { encrypt, hashSessionIdForEnv } from "../lib/crypto.ts";
import { getClientCredentials } from "../lib/oauth-providers.ts";
import type { Database } from "../../db/index.ts";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { actors, notDeleted, sessions } from "../../db/index.ts";
import { parseJsonObject, parseNonEmptyString } from "../lib/parse-helpers.ts";
import { cancelTombstoneDelete } from "./actors.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "auth.helpers" });

/** Classify HTTP status into a coarse error kind safe to log. */
function classifyOAuthErrorKind(status: number): string {
  if (status === 400) return "invalid_request";
  if (status === 401) return "invalid_client";
  if (status === 403) return "forbidden";
  if (status === 404) return "endpoint_not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_error";
  return "client_error";
}

/** Session lifetime: 30 days in seconds. */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export type OAuthTokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
};

export type HonoContext = Context<{ Bindings: Env; Variables: Variables }>;

export { parseJsonObject, parseNonEmptyString };

export function formatAccountResponse(a: {
  apId: string;
  preferredUsername: string;
  name: string | null;
  iconUrl: string | null;
}): {
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

/**
 * Delete a session row by its raw (cookie) id. The raw id is hashed before
 * the lookup because the stored key is `sha256:<salt:rawId>`, never the raw id.
 */
export async function deleteSessionSafely(
  db: Database,
  env: Env,
  rawSessionId: string,
  context: string,
): Promise<void> {
  try {
    const sessionKey = await hashSessionIdForEnv(env, rawSessionId);
    await db.delete(sessions).where(eq(sessions.id, sessionKey));
  } catch (err) {
    log.warn("Failed to delete session", {
      event: "auth.session.delete_failed",
      context,
      error: err,
    });
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
    await deleteSessionSafely(db, c.env, existingSessionId, rotationContext);
    deleteCookie(c, "session");
  }

  // Create new session with encrypted tokens.
  //
  // SECURITY: the raw session id is a bearer credential and only ever lives in
  // the client cookie. We persist SHA-256(salt:rawId) as the row key so a
  // read-only leak of the sessions table cannot be replayed. `accessToken`
  // mirrors the same hashed key (it was a duplicate of the lookup id).
  const sessionId = generateId();
  const sessionKey = await hashSessionIdForEnv(c.env, sessionId);
  const expiresAt = new Date(
    Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  ).toISOString();

  await db.insert(sessions).values({
    id: sessionKey,
    memberId: memberApId,
    accessToken: sessionKey,
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

  // Set cookie. The cookie carries the RAW session id (the only place it
  // exists); the DB stores only its salted hash. SameSite=Strict to reduce
  // CSRF / cross-site leakage surface. Secure unless the instance is explicitly
  // served over plain http:// — a hardcoded Secure made an http self-host
  // un-loginnable (the browser never sends a Secure cookie over http), so honour
  // the operator's APP_URL protocol while defaulting to Secure for https/unknown.
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: !(c.env.APP_URL ?? "").startsWith("http://"),
    sameSite: "Strict",
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
  // Exclude tombstoned rows from the collision probe: a deleted account's row
  // lingers (renamed handle, `deletedAt` set) only until the reaper drains it,
  // and createActor revives that row on re-registration. Treating a tombstone
  // as a live collision would needlessly force a freed handle onto a suffixed
  // alias until the reaper runs (#9).
  while (
    await db
      .select({ apId: actors.apId })
      .from(actors)
      .where(
        and(eq(actors.apId, actorApId(baseUrl, username)), notDeleted(actors)),
      )
      .get()
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

  // `apId` is deterministic from the username and is the PRIMARY KEY, so
  // re-registering a freed handle resolves to the SAME apId that a tombstone
  // row may still hold (account deletion renames `preferredUsername` to a
  // sentinel and sets `deletedAt`, but keeps `apId` for the federation Delete
  // signer). A plain insert would PK-collide while that tombstone lingers, so
  // we first REVIVE any tombstone on this apId: clear `deletedAt`, restore the
  // requested handle, and rotate to fresh signing keys + identity so no
  // scrubbed data or stale key material from the deleted account survives the
  // re-registration (#9). Only a tombstoned (deletedAt IS NOT NULL) row is ever
  // revived; a LIVE collision is impossible here because every caller probes
  // for a live collision (notDeleted) before reaching createActor.
  const tombstone = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(and(eq(actors.apId, apId), isNotNull(actors.deletedAt)))
    .get();

  if (tombstone) {
    // The tombstone preserved the OLD signing key so any still-queued
    // Delete(actor) delivery jobs could sign with it at send time. Reviving the
    // row below rotates to a FRESH key + identity, which would make those
    // in-flight Delete jobs sign with the wrong key (invalid signature) or
    // target a now-live actor. Cancel the stranded Delete FIRST — drop its
    // pending/retry_wait/failed delivery_queue rows and the preserved Delete
    // activity rows — so re-registration starts clean and no half-signed Delete
    // is sent (#revive).
    await cancelTombstoneDelete(db, apId);

    return await db
      .update(actors)
      .set({
        type: "Person",
        preferredUsername: opts.username,
        name: opts.name,
        summary: null,
        iconUrl: opts.iconUrl ?? null,
        headerUrl: null,
        ...actorEndpoints(apId),
        publicKeyPem,
        privateKeyPem,
        takosUserId: opts.takosUserId,
        followerCount: 0,
        followingCount: 0,
        postCount: 0,
        isPrivate: 0,
        role: opts.role,
        fieldsJson: "[]",
        alsoKnownAsJson: "[]",
        movedTo: null,
        ownerActorApId: opts.ownerActorApId ?? null,
        deletedAt: null,
      })
      .where(eq(actors.apId, apId))
      .returning()
      .get();
  }

  return await db
    .insert(actors)
    .values({
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
    })
    .returning()
    .get();
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
  const baseUsername =
    userInfo.username ||
    userInfo.name.toLowerCase().replace(/[^a-z0-9]/g, "") ||
    "user";
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

export function lockoutErrorResponse(retryAfterSeconds: number): {
  error: string;
  retry_after: number;
} {
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
    tokenHeaders["Authorization"] = `Basic ${btoa(
      `${clientId}:${clientSecret}`,
    )}`;
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
    // Do NOT log the raw response body. Upstream OAuth providers can
    // echo the supplied `client_secret` / `code` / refresh tokens on
    // validation failures. Log structured fields only.
    log.error("Token exchange failed", {
      event: "auth.oauth.token_exchange_failed",
      provider: providerId,
      status: res.status,
      statusText: res.statusText,
      error_kind: classifyOAuthErrorKind(res.status),
      tokenUrl: provider.tokenUrl,
    });
    return null;
  }

  return (await res.json()) as OAuthTokens;
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
  const providerUserId =
    providerId === "takos" ? userInfo.id : `${providerId}:${userInfo.id}`;

  let actorData = await db
    .select()
    .from(actors)
    .where(eq(actors.takosUserId, providerUserId))
    .get();

  if (!actorData) {
    actorData = await createActorFromOAuth(db, env, userInfo, providerUserId);
  } else {
    await db
      .update(actors)
      .set({
        name: userInfo.name,
        ...(userInfo.picture ? { iconUrl: userInfo.picture } : {}),
      })
      .where(eq(actors.apId, actorData.apId))
      .run();
  }

  return actorData;
}
