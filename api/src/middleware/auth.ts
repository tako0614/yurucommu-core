// Authentication middleware shared across routes

import { authenticateJWT, fail, releaseStore } from "@takos/platform/server";
import { authenticateSession } from "@takos/platform/server/session";
import { getCookie } from "hono/cookie";
import { makeData } from "../data";
import type { AuthenticatedUser } from "../lib/auth-context-model";
import { buildAuthContext, resolvePlanFromEnv } from "../lib/auth-context-model";
import { createJwtStoreAdapter } from "../lib/jwt-store";
import { logEvent } from "../lib/observability";
import { ErrorCodes } from "../lib/error-codes";

export const ACTIVE_USER_COOKIE_NAME = "activeUserId";
export const ACTIVE_USER_HEADER_NAME = "x-active-user-id";

const decodeBasicAuth = (header: string): { username: string; password: string } | null => {
  if (!header.toLowerCase().startsWith("basic ")) return null;
  const payload = header.slice(6).trim();
  if (!payload) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(payload, "base64").toString("utf8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx === -1) return null;
  return {
    username: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  };
};

const authenticateBasicAuth = (c: any): AuthenticatedUser | null => {
  const header = c.req.header("authorization") || c.req.header("Authorization") || "";
  const creds = decodeBasicAuth(header);
  if (!creds) return null;

  const env = c.env as any;
  const expectedUsername = (env.AUTH_USERNAME as string | undefined) ?? "";
  const expectedPassword = (env.AUTH_PASSWORD as string | undefined) ?? "";
  if (!expectedUsername || !expectedPassword) return null;

  if (creds.username !== expectedUsername || creds.password !== expectedPassword) {
    return null;
  }

  return {
    user: { id: expectedUsername, handle: expectedUsername },
    activeUserId: expectedUsername,
    sessionUser: { id: expectedUsername, handle: expectedUsername },
    sessionId: null,
    token: null,
    source: "session",
  };
};

const parseActiveUserCookie = (raw: string | null | undefined) => {
  if (!raw) {
    return { userId: null };
  }
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();
  // Format: "userId" or "userId:sessionUserId" (legacy format, we only need userId)
  const [userId] = decoded.split(":");
  return {
    userId: userId?.trim() || null,
  };
};

const extractActiveUserId = (
  c: any,
): { requestedUserId: string | null; source: "header" | "cookie" | null } => {
  const headerUserId = (c.req.header(ACTIVE_USER_HEADER_NAME) || "").trim();
  if (headerUserId) {
    return { requestedUserId: headerUserId, source: "header" };
  }
  const { userId } = parseActiveUserCookie(getCookie(c, ACTIVE_USER_COOKIE_NAME));
  return userId
    ? {
        requestedUserId: userId,
        source: "cookie",
      }
    : { requestedUserId: null, source: null };
};

/**
 * Resolve active user - authenticated users can switch to any local user they've created.
 * Since authentication is done via single password, any authenticated session can access all users.
 */
const resolveActiveUser = async (
  c: any,
  store: any,
  baseUser: any,
): Promise<{ user: any; activeUserId: string | null }> => {
  const { requestedUserId } = extractActiveUserId(c);

  // If no specific user requested, use the session user
  if (!requestedUserId) {
    return { user: baseUser, activeUserId: baseUser?.id ?? null };
  }

  // If requesting the same user as session, just return it
  if (requestedUserId === baseUser?.id) {
    return { user: baseUser, activeUserId: baseUser?.id ?? null };
  }

  // Authenticated users can switch to any existing user
  const requestedUser = await store.getUser(requestedUserId).catch(() => null);
  if (requestedUser) {
    return { user: requestedUser, activeUserId: requestedUser.id };
  }

  // Fallback to session user if requested user doesn't exist
  return { user: baseUser, activeUserId: baseUser?.id ?? null };
};

const buildAuthResult = (
  baseUser: any,
  active: { user: any; activeUserId: string | null },
  source: "session" | "jwt",
  sessionId: string | null,
  token: string | null,
): AuthenticatedUser => ({
  user: active.user,
  activeUserId: active.activeUserId,
  sessionUser: baseUser,
  sessionId: source === "session" ? sessionId : null,
  token: source === "jwt" ? token : null,
  source,
});

const logAuthEvent = (
  c: any,
  level: "debug" | "info" | "warn" | "error",
  event: string,
  payload: Record<string, unknown>,
) => {
  logEvent(c, level, `auth.${event}`, payload);
};

const elapsedMs = (started: number) => Number((performance.now() - started).toFixed(2));

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const encoded = parts[1] || "";
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  try {
    const json =
      typeof atob === "function"
        ? atob(padded)
        : typeof Buffer !== "undefined"
          ? Buffer.from(padded, "base64").toString("utf-8")
          : "";
    if (!json) return null;
    const payload = JSON.parse(json) as Record<string, unknown>;
    return payload && typeof payload === "object" ? payload : null;
  } catch {
    return null;
  }
};

const classifyBearerTokenFailure = (c: any): { code: string; details?: Record<string, unknown> } | null => {
  const header = c.req.header("authorization") || c.req.header("Authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : typeof payload?.exp === "string" ? Number(payload.exp) : null;
  if (typeof exp === "number" && Number.isFinite(exp)) {
    const now = Math.floor(Date.now() / 1000);
    if (exp < now) {
      return { code: ErrorCodes.TOKEN_EXPIRED, details: { exp, now } };
    }
  }
  return { code: ErrorCodes.INVALID_TOKEN };
};

// Unified auth: prefer session (owner password) then fall back to JWT bearer tokens.
export const authenticateUser = async (c: any, store: any): Promise<AuthenticatedUser | null> => {
  const path = new URL(c.req.url).pathname;
  const sessionResult = await authenticateSession(c, store, { renewCookie: true }).catch((error) => {
    logAuthEvent(c, "warn", "session.error", { path, message: (error as Error)?.message });
    return null;
  });
  logAuthEvent(c, "debug", "session.check", { path, ok: !!sessionResult });
  if (sessionResult?.user) {
    const active = await resolveActiveUser(c, store, sessionResult.user);
    return buildAuthResult(sessionResult.user, active, "session", sessionResult.sessionId ?? null, null);
  }

  const jwtStore = createJwtStoreAdapter(store);
  const jwtResult = await authenticateJWT(c, jwtStore).catch((error) => {
    logAuthEvent(c, "warn", "jwt.error", { path, message: (error as Error)?.message });
    return null;
  });
  logAuthEvent(c, "debug", "jwt.check", { path, ok: !!jwtResult });
  if (jwtResult?.user) {
    const active = await resolveActiveUser(c, store, jwtResult.user);
    return buildAuthResult(jwtResult.user, active, "jwt", null, jwtResult.token ?? null);
  }

  return null;
};

export const auth = async (c: any, next: () => Promise<void>) => {
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const started = performance.now();
  const plan = resolvePlanFromEnv(c.env as any);
  const basicResult = authenticateBasicAuth(c);
  if (basicResult) {
    c.set("authSource", "basic");
    const authContext = buildAuthContext(basicResult, plan);
    c.set("user", basicResult.user);
    c.set("sessionUser", basicResult.sessionUser);
    c.set("activeUserId", authContext.userId);
    c.set("authContext", authContext);
    await next();
    return;
  }

  const store = makeData(c.env as any, c);
  const storeMs = elapsedMs(started);
  try {
    logAuthEvent(c, "info", "start", {
      path,
      method,
      plan: plan.name,
      ms_makeData: storeMs,
    });
    const authStarted = performance.now();
    const authResult = await authenticateUser(c, store);
    const authMs = elapsedMs(authStarted);
    logAuthEvent(c, "info", "resolved", {
      path,
      method,
      plan: plan.name,
      ok: !!authResult,
      ms_authenticate: authMs,
    });
    if (!authResult) {
      const anonymous = buildAuthContext(null, plan);
      c.set("authContext", anonymous);
      logAuthEvent(c, "warn", "unauthorized", {
        path,
        method,
        plan: plan.name,
      });
      const bearerFailure = classifyBearerTokenFailure(c);
      return fail(c, "Authentication required", 401, {
        code: bearerFailure?.code ?? ErrorCodes.UNAUTHORIZED,
        details: { path, method, plan: plan.name, ...(bearerFailure?.details ?? {}) },
      });
    }
    const authContext = buildAuthContext(authResult, plan);
    c.set("user", authResult.user);
    c.set("sessionUser", authResult.sessionUser);
    c.set("activeUserId", authContext.userId);
    c.set("authContext", authContext);
    c.set("authSource", authResult.source ?? null);
    logAuthEvent(c, "info", "granted", {
      path,
      method,
      plan: plan.name,
      userId: authContext.userId,
      sessionPresent: !!authContext.sessionId,
      source: authResult.source ?? "session",
      ms_makeData: storeMs,
      ms_authenticate: authMs,
    });
    await next();
  } finally {
    const releaseStarted = performance.now();
    try {
      await releaseStore(store);
    } finally {
      const releaseMs = elapsedMs(releaseStarted);
      const totalMs = elapsedMs(started);
      logAuthEvent(c, "debug", "end", {
        path,
        method,
        ms_release: releaseMs,
        ms_total: totalMs,
      });
    }
  }
};

export const optionalAuth = async (c: any, next: () => Promise<void>) => {
  const path = new URL(c.req.url).pathname;
  const started = performance.now();
  const plan = resolvePlanFromEnv(c.env as any);

  const basicResult = authenticateBasicAuth(c);
  if (basicResult) {
    const authContext = buildAuthContext(basicResult, plan);
    c.set("user", basicResult.user);
    c.set("sessionUser", basicResult.sessionUser);
    c.set("activeUserId", authContext.userId);
    c.set("authContext", authContext);
    await next();
    return;
  }

  const store = makeData(c.env as any, c);
  try {
    const authStarted = performance.now();
    const authResult = await authenticateUser(c, store);
    const authMs = elapsedMs(authStarted);
    logAuthEvent(c, "debug", "optional.resolve", {
      path,
      plan: plan.name,
      ok: !!authResult,
      ms_authenticate: authMs,
    });
    if (authResult) {
      const authContext = buildAuthContext(authResult, plan);
      c.set("user", authResult.user);
      c.set("sessionUser", authResult.sessionUser);
      c.set("activeUserId", authContext.userId);
      c.set("authContext", authContext);
    } else {
      c.set("activeUserId", null);
      c.set("sessionUser", null);
      c.set("authContext", buildAuthContext(null, plan));
    }
  } catch {
    // ignore authentication failures and continue as guest
    c.set("activeUserId", null);
    c.set("sessionUser", null);
    c.set("authContext", buildAuthContext(null, plan));
  } finally {
    const releaseStarted = performance.now();
    try {
      await releaseStore(store);
    } finally {
      const releaseMs = elapsedMs(releaseStarted);
      const totalMs = elapsedMs(started);
      logAuthEvent(c, "debug", "optional.end", {
        path,
        plan: plan.name,
        ms_release: releaseMs,
        ms_total: totalMs,
      });
    }
  }
  await next();
};
