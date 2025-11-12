import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { PublicAccountBindings } from "../types";
import { addHours } from "../utils/response-helpers";

export interface SessionStore {
  createSession(session: {
    id: string;
    user_id: string;
    created_at: Date;
    last_seen: Date;
    expires_at: Date;
  }): Promise<any>;
  getSession(id: string): Promise<any>;
  updateSession(id: string, data: Record<string, unknown>): Promise<any>;
  deleteSession(id: string): Promise<void>;
  getUser(id: string): Promise<any>;
}

type SessionContext<TEnv extends { Bindings: PublicAccountBindings }> = Context<TEnv>;

export const DEFAULT_SESSION_COOKIE_NAME = "token";
export const DEFAULT_SESSION_TTL_HOURS = 24 * 365;
export const DEFAULT_SESSION_REFRESH_INTERVAL_SECONDS = 60 * 60 * 24 * 30;

export function getSessionCookieName(env: PublicAccountBindings): string {
  const fromEnv = env.SESSION_COOKIE_NAME?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_SESSION_COOKIE_NAME;
}

export function getSessionTtlHours(env: PublicAccountBindings): number {
  const fromEnv = Number(env.SESSION_TTL_HOURS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_SESSION_TTL_HOURS;
}

export function getSessionTtlSeconds(env: PublicAccountBindings): number {
  return Math.round(getSessionTtlHours(env) * 3600);
}

export function getSessionRefreshIntervalSeconds(env: PublicAccountBindings): number {
  const fromEnv = Number(env.SESSION_REFRESH_INTERVAL_SECONDS);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? Math.round(fromEnv)
    : DEFAULT_SESSION_REFRESH_INTERVAL_SECONDS;
}

export async function createUserSession(
  store: SessionStore,
  env: PublicAccountBindings,
  userId: string,
) {
  const now = new Date();
  const ttlHours = getSessionTtlHours(env);
  const sessionId = crypto.randomUUID();
  const expiresAt = addHours(now, ttlHours);
  await store.createSession({
    id: sessionId,
    user_id: userId,
    created_at: now,
    last_seen: now,
    expires_at: expiresAt,
  });
  return { id: sessionId, expiresAt };
}

export function extractSessionId<TEnv extends { Bindings: PublicAccountBindings }>(
  c: SessionContext<TEnv>,
): { sessionId: string | null; fromCookie: boolean } {
  const cookieToken = getCookie(c, getSessionCookieName(c.env));
  if (cookieToken) {
    try {
      return { sessionId: decodeURIComponent(cookieToken), fromCookie: true };
    } catch {
      return { sessionId: cookieToken, fromCookie: true };
    }
  }

  const header = c.req.header("Authorization") || "";
  if (header) {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match && match[1]) {
      return { sessionId: match[1].trim(), fromCookie: false };
    }
  }

  return { sessionId: null, fromCookie: false };
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function authenticateSession<TEnv extends { Bindings: PublicAccountBindings }>(
  c: SessionContext<TEnv>,
  store: SessionStore,
  options: { renewCookie?: boolean } = {},
) {
  const { sessionId, fromCookie } = extractSessionId(c);
  if (!sessionId) return null;

  const session = await store.getSession(sessionId);
  if (!session) return null;

  const now = new Date();
  const expiresAt = parseDate((session as any).expires_at);
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    await store.deleteSession(sessionId);
    return null;
  }

  const lastSeen = parseDate((session as any).last_seen);
  const user = await store.getUser((session as any).user_id);
  if (!user) {
    await store.deleteSession(sessionId);
    return null;
  }

  const refreshIntervalSeconds = getSessionRefreshIntervalSeconds(c.env);
  const ttlHours = getSessionTtlHours(c.env);
  const newExpiry = addHours(now, ttlHours);
  const lastSeenAgeMs = lastSeen ? now.getTime() - lastSeen.getTime() : Number.POSITIVE_INFINITY;
  const refreshIntervalMs = refreshIntervalSeconds * 1000;
  const shouldRefresh = !lastSeen || lastSeenAgeMs >= refreshIntervalMs;

  if (shouldRefresh) {
    try {
      await store.updateSession(sessionId, {
        last_seen: now,
        expires_at: newExpiry,
      });
    } catch (error) {
      console.error("session update failed", error);
    }
    if (options.renewCookie && fromCookie) {
      const requestUrl = new URL(c.req.url);
      setCookie(c, getSessionCookieName(c.env), encodeURIComponent(sessionId), {
        maxAge: getSessionTtlSeconds(c.env),
        path: "/",
        sameSite: "Lax",
        secure: requestUrl.protocol === "https:",
        httpOnly: true,
      });
    }
  }

  return { sessionId, session, user };
}
