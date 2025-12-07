// Authentication middleware shared across routes

import { authenticateJWT, fail, releaseStore } from "@takos/platform/server";
import { authenticateSession } from "@takos/platform/server/session";
import { getCookie } from "hono/cookie";
import { makeData } from "../data";
import type { AuthenticatedUser } from "../lib/auth-context-model";
import { buildAuthContext, resolvePlanFromEnv, resolveRateLimits } from "../lib/auth-context-model";
import { createJwtStoreAdapter } from "../lib/jwt-store";

export const ACTIVE_USER_COOKIE_NAME = "activeUserId";
export const ACTIVE_USER_HEADER_NAME = "x-active-user-id";

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
});

// Unified auth: prefer session (owner password) then fall back to JWT bearer tokens.
export const authenticateUser = async (c: any, store: any): Promise<AuthenticatedUser | null> => {
  const path = new URL(c.req.url).pathname;
  const sessionResult = await authenticateSession(c, store, { renewCookie: true }).catch(
    () => null,
  );
  console.log("[backend] auth session", { path, ok: !!sessionResult });
  if (sessionResult?.user) {
    const active = await resolveActiveUser(c, store, sessionResult.user);
    return buildAuthResult(sessionResult.user, active, "session", sessionResult.sessionId ?? null, null);
  }

  const jwtStore = createJwtStoreAdapter(store);
  const jwtResult = await authenticateJWT(c, jwtStore).catch(() => null);
  console.log("[backend] auth jwt", { path, ok: !!jwtResult });
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
  const store = makeData(c.env as any, c);
  const plan = resolvePlanFromEnv(c.env as any);
  const rateLimits = resolveRateLimits(plan);
  const storeMs = Number((performance.now() - started).toFixed(2));
  try {
    console.log("[backend] auth start", {
      path,
      method,
      ms_makeData: storeMs,
    });
    const authStarted = performance.now();
    const authResult = await authenticateUser(c, store);
    const authMs = Number((performance.now() - authStarted).toFixed(2));
    console.log("[backend] auth authenticateUser", {
      path,
      ok: !!authResult,
      ms: authMs,
    });
    if (!authResult) {
      const anonymous = buildAuthContext(null, plan, rateLimits);
      c.set("authContext", anonymous);
      return fail(c, "Authentication required", 401, { code: "UNAUTHORIZED" });
    }
    const authContext = buildAuthContext(authResult, plan, rateLimits);
    c.set("user", authResult.user);
    c.set("sessionUser", authResult.sessionUser);
    c.set("activeUserId", authContext.userId);
    c.set("authContext", authContext);
    await next();
  } finally {
    const releaseStarted = performance.now();
    await releaseStore(store);
    const releaseMs = Number((performance.now() - releaseStarted).toFixed(2));
    const totalMs = Number((performance.now() - started).toFixed(2));
    console.log("[backend] auth end", {
      path,
      ms_release: releaseMs,
      ms_total: totalMs,
    });
  }
};

export const optionalAuth = async (c: any, next: () => Promise<void>) => {
  const path = new URL(c.req.url).pathname;
  const started = performance.now();
  const store = makeData(c.env as any, c);
  const plan = resolvePlanFromEnv(c.env as any);
  const rateLimits = resolveRateLimits(plan);
  try {
    const authStarted = performance.now();
    const authResult = await authenticateUser(c, store);
    const authMs = Number((performance.now() - authStarted).toFixed(2));
    console.log("[backend] optionalAuth authenticateUser", {
      path,
      ok: !!authResult,
      ms: authMs,
    });
    if (authResult) {
      const authContext = buildAuthContext(authResult, plan, rateLimits);
      c.set("user", authResult.user);
      c.set("sessionUser", authResult.sessionUser);
      c.set("activeUserId", authContext.userId);
      c.set("authContext", authContext);
    } else {
      c.set("activeUserId", null);
      c.set("sessionUser", null);
      c.set("authContext", buildAuthContext(null, plan, rateLimits));
    }
  } catch {
    // ignore authentication failures and continue as guest
    c.set("activeUserId", null);
    c.set("sessionUser", null);
    c.set("authContext", buildAuthContext(null, plan, rateLimits));
  } finally {
    const releaseStarted = performance.now();
    await releaseStore(store);
    const releaseMs = Number((performance.now() - releaseStarted).toFixed(2));
    const totalMs = Number((performance.now() - started).toFixed(2));
    console.log("[backend] optionalAuth end", {
      path,
      ms_release: releaseMs,
      ms_total: totalMs,
    });
  }
  await next();
};
