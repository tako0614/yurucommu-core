import type { Context, Next } from "hono";

import type { Env, Variables } from "../types.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "middleware.csrf" });

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "DELETE", "PATCH"]);

function getOrigin(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function isActivityPubInbox(path: string): boolean {
  return path.includes("/inbox") && path.includes("/ap/");
}

function isDevLocalhost(appUrl: string | undefined): boolean {
  return !!appUrl &&
    (appUrl.includes("localhost") || appUrl.includes("127.0.0.1"));
}

function isBearerApiRequest(
  c: Context<{ Bindings: Env; Variables: Variables }>,
) {
  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  // Browser session requests must still satisfy CSRF checks even if a script
  // adds an Authorization header. Server-to-server bearer calls should not
  // carry cookies.
  return !c.req.header("Cookie");
}

/**
 * CSRF protection middleware.
 * Validates Origin/Referer for state-changing requests as defense-in-depth
 * alongside SameSite=Lax cookies.
 */
export function csrfProtection() {
  return async (
    c: Context<{ Bindings: Env; Variables: Variables }>,
    next: Next,
  ) => {
    if (!STATE_CHANGING_METHODS.has(c.req.method.toUpperCase())) return next();
    if (isActivityPubInbox(c.req.path)) return next();
    if (isBearerApiRequest(c)) return next();

    const appUrl = c.env.APP_URL;
    const expectedOrigin = getOrigin(appUrl);

    const requestOrigin = c.req.header("Origin") ||
      getOrigin(c.req.header("Referer") ?? null);
    if (!requestOrigin) {
      log.warn("CSRF check failed: missing origin", {
        event: "csrf.check.missing_origin",
        method: c.req.method,
        path: c.req.path,
      });
      return c.json(
        { error: "CSRF validation failed: missing Origin header" },
        403,
      );
    }

    if (requestOrigin !== expectedOrigin) {
      if (isDevLocalhost(appUrl) && requestOrigin.includes("localhost")) {
        return next();
      }
      log.warn("CSRF check failed: origin mismatch", {
        event: "csrf.check.origin_mismatch",
        method: c.req.method,
        path: c.req.path,
        expectedOrigin,
        requestOrigin,
      });
      return c.json({ error: "CSRF validation failed" }, 403);
    }

    return next();
  };
}
