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
const authenticateUser = async (c: any, store: any) => {
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
  const store = makeData(c.env as any, c);
  try {
    console.log("[backend] auth start", {
      path: new URL(c.req.url).pathname,
      method: c.req.method,
    });
    const authResult = await authenticateUser(c, store);
    if (!authResult) return fail(c, "Unauthorized", 401);
    c.set("user", authResult.user);
    await next();
  } finally {
    await releaseStore(store);
  }
};

export const optionalAuth = async (c: any, next: () => Promise<void>) => {
  const store = makeData(c.env as any, c);
  try {
    const authResult = await authenticateUser(c, store);
    if (authResult) {
      c.set("user", authResult.user);
    }
  } catch {
    // ignore authentication failures and continue as guest
  } finally {
    await releaseStore(store);
  }
  await next();
};
