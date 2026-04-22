import type { Context, Next } from "hono";

import type { Env, Variables } from "../types.ts";

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

    const appUrl = c.env.APP_URL;
    const expectedOrigin = getOrigin(appUrl);

    const requestOrigin = c.req.header("Origin") ||
      getOrigin(c.req.header("Referer") ?? null);
    if (!requestOrigin) {
      console.warn("CSRF check failed");
      return c.json(
        { error: "CSRF validation failed: missing Origin header" },
        403,
      );
    }

    if (requestOrigin !== expectedOrigin) {
      if (isDevLocalhost(appUrl) && requestOrigin.includes("localhost")) {
        return next();
      }
      console.warn("CSRF check failed");
      return c.json({ error: "CSRF validation failed" }, 403);
    }

    return next();
  };
}
