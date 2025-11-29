// Authentication middleware shared across routes

import type { Next } from "hono";
import type {
  AppContext,
  PublicAccountBindings as Bindings,
} from "@takos/platform/server";
import { fail, releaseStore, authenticateJWT } from "@takos/platform/server";
import { authenticateSession } from "@takos/platform/server/session";
import { makeData } from "../data";
import { createJwtStoreAdapter } from "../lib/jwt-store";

type AuthContext = AppContext<Bindings> & {
  env: Bindings;
};

// Unified auth: prefer JWT, fall back to session cookie for legacy paths.
export const authenticateUser = async (c: any, store: any) => {
  const jwtStore = createJwtStoreAdapter(store);
  const jwtResult = await authenticateJWT(c, jwtStore).catch(() => null);
  console.log("[backend] auth jwt", {
    path: new URL(c.req.url).pathname,
    ok: !!jwtResult,
  });
  if (jwtResult) return jwtResult;
  const sessionResult = await authenticateSession(c, store, { renewCookie: true }).catch(
    () => null,
  );
  console.log("[backend] auth session", {
    path: new URL(c.req.url).pathname,
    ok: !!sessionResult,
  });
  return sessionResult;
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
