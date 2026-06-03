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
  return (
    !!appUrl && (appUrl.includes("localhost") || appUrl.includes("127.0.0.1"))
  );
}

/**
 * Build the set of allowed origins for CSRF Origin / Referer check.
 *
 * Sources (= union):
 * - `APP_URL` env (= 既存 production-equivalent origin)
 * - `CSRF_ALLOWED_ORIGINS` env (= comma-separated 追加 origin、 dev hostname
 *   を register するための env、 default 未設定で backward compat)
 *
 * 未正規化 / 空文字 / 構文不正な URL は skip。 trailing slash は正規化される
 * (= `getOrigin` が `protocol//host` 形式に戻すため)。
 */
function buildAllowedOrigins(env: {
  APP_URL?: string;
  CSRF_ALLOWED_ORIGINS?: string;
}): Set<string> {
  const origins = new Set<string>();
  const appOrigin = getOrigin(env.APP_URL ?? null);
  if (appOrigin) origins.add(appOrigin);

  const extra =
    env.CSRF_ALLOWED_ORIGINS?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  for (const raw of extra) {
    const normalized = getOrigin(raw);
    if (normalized) origins.add(normalized);
  }
  return origins;
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
    const allowedOrigins = buildAllowedOrigins(c.env);

    const requestOrigin =
      c.req.header("Origin") || getOrigin(c.req.header("Referer") ?? null);
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

    if (!allowedOrigins.has(requestOrigin)) {
      const ro = (() => {
        try {
          return new URL(requestOrigin).hostname;
        } catch {
          return null;
        }
      })();
      if (
        isDevLocalhost(appUrl) &&
        ro &&
        (ro === "localhost" || ro === "127.0.0.1" || ro === "[::1]")
      ) {
        return next();
      }
      log.warn("CSRF check failed: origin mismatch", {
        event: "csrf.check.origin_mismatch",
        method: c.req.method,
        path: c.req.path,
        allowedOrigins: [...allowedOrigins],
        requestOrigin,
      });
      return c.json({ error: "CSRF validation failed" }, 403);
    }

    return next();
  };
}
