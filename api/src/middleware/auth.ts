// Authentication middleware shared across routes

import type { Next } from "hono";
import type {
  AppContext,
  PublicAccountBindings as Bindings,
} from "@takos/platform/server";
import {
  fail,
  releaseStore,
  authenticateJWT,
} from "@takos/platform/server";
import { authenticateSession } from "@takos/platform/server/session";
import { getCookie } from "hono/cookie";
import { makeData } from "../data";
import { createJwtStoreAdapter } from "../lib/jwt-store";

type AuthContext = AppContext<Bindings> & {
  env: Bindings;
};

export const ACTIVE_USER_COOKIE_NAME = "activeUserId";
export const ACTIVE_USER_HEADER_NAME = "x-active-user-id";

type AuthenticatedUser = {
  user: any;
  sessionUser: any;
  activeUserId: string | null;
  sessionId: string | null;
  token: string | null;
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
): { requestedUserId: string | null; source: "cookie" | null } => {
  const { userId } = parseActiveUserCookie(getCookie(c, ACTIVE_USER_COOKIE_NAME));
  if (!userId) {
    return { requestedUserId: null, source: null };
  }
  return {
    requestedUserId: userId,
    source: "cookie",
  };
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

// Unified auth: prefer JWT, fall back to session cookie for legacy paths.
export const authenticateUser = async (
  c: any,
  store: any,
): Promise<AuthenticatedUser | null> => {
  const jwtStore = createJwtStoreAdapter(store);
  const jwtResult = await authenticateJWT(c, jwtStore).catch(() => null);
  console.log("[backend] auth jwt", {
    path: new URL(c.req.url).pathname,
    ok: !!jwtResult,
  });
  if (jwtResult?.user) {
    const active = await resolveActiveUser(c, store, jwtResult.user);
    return {
      user: active.user,
      activeUserId: active.activeUserId,
      sessionUser: jwtResult.user,
      sessionId: null,
      token: jwtResult.token ?? null,
    };
  }

  const sessionResult = await authenticateSession(c, store, { renewCookie: true }).catch(
    () => null,
  );
  console.log("[backend] auth session", {
    path: new URL(c.req.url).pathname,
    ok: !!sessionResult,
  });
  if (!sessionResult?.user) {
    return null;
  }
  const active = await resolveActiveUser(c, store, sessionResult.user);
  return {
    user: active.user,
    activeUserId: active.activeUserId,
    sessionUser: sessionResult.user,
    sessionId: sessionResult.sessionId ?? null,
    token: null,
  };
};

export const auth = async (c: any, next: () => Promise<void>) => {
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const started = performance.now();
  const store = makeData(c.env as any, c);
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
    if (!authResult) return fail(c, "Unauthorized", 401);
    c.set("user", authResult.user);
    c.set("sessionUser", authResult.sessionUser);
    c.set("activeUserId", authResult.activeUserId);
    c.set("authContext", {
      sessionId: authResult.sessionId,
      token: authResult.token,
      sessionUserId: authResult.sessionUser?.id ?? null,
      activeUserId: authResult.activeUserId ?? null,
    });
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
      c.set("user", authResult.user);
      c.set("sessionUser", authResult.sessionUser);
      c.set("activeUserId", authResult.activeUserId);
      c.set("authContext", {
        sessionId: authResult.sessionId,
        token: authResult.token,
        sessionUserId: authResult.sessionUser?.id ?? null,
        activeUserId: authResult.activeUserId ?? null,
      });
    }
  } catch {
    // ignore authentication failures and continue as guest
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
