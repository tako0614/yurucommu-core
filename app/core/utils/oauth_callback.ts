import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { issueSession } from "./session.ts";
import { getDB } from "../db/mod.ts";

export interface OAuthCallbackDeps {
  getCookie: typeof getCookie;
  deleteCookie: typeof deleteCookie;
  issueSession: typeof issueSession;
  fetch: typeof fetch;
}

export function createHandleOAuthCallback(
  deps: OAuthCallbackDeps,
): MiddlewareHandler {
  return async function handleOAuthCallback(
    c: Context,
    next: () => Promise<void>,
  ) {
    try {
      if (c.req.method !== "GET") return await next();
      const code = c.req.query("code");
      const state = c.req.query("state") ?? "";
      if (!code) return await next();
      const env = (c as unknown as { get: (k: string) => unknown }).get(
        "env",
      ) as Record<string, string>;
      const host = env["OAUTH_HOST"];
      const clientId = env["OAUTH_CLIENT_ID"];
      const clientSecret = env["OAUTH_CLIENT_SECRET"];
      if (!host || !clientId || !clientSecret) return await next();
      const stateCookie = deps.getCookie(c, "oauthState") ?? "";
      if (!state || !stateCookie || state !== stateCookie) return await next();
      deps.deleteCookie(c, "oauthState", { path: "/" });
      const xfProto = c.req.header("x-forwarded-proto");
      const xfHost = c.req.header("x-forwarded-host");
      let origin: string;
      if (xfProto && xfHost) {
        origin = `${xfProto.split(",")[0].trim()}://${
          xfHost.split(",")[0].trim()
        }`;
      } else {
        const u = new URL(c.req.url);
        origin = `${u.protocol}//${u.host}`;
      }
      const redirectUri = origin;
      const base = host.startsWith("http") ? host : `https://${host}`;
      const form = new URLSearchParams();
      form.set("grant_type", "authorization_code");
      form.set("code", code);
      form.set("client_id", clientId);
      form.set("client_secret", clientSecret);
      form.set("redirect_uri", redirectUri);
      const tokenRes = await deps.fetch(`${base}/oauth/token`, {
        method: "POST",
        body: form,
      });
      if (!tokenRes.ok) return await next();
      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) return await next();
      const verifyRes = await deps.fetch(`${base}/oauth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenData.access_token }),
      });
      if (!verifyRes.ok) return await next();
  const v = await verifyRes.json() as { active?: boolean };
  if (!v?.active) return await next();
      await deps.issueSession(c, getDB(c));
      return c.redirect("/");
    } catch (_e) {
      await next();
    }
  };
}

export const handleOAuthCallback = createHandleOAuthCallback({
  getCookie,
  deleteCookie,
  issueSession,
  fetch: globalThis.fetch,
});
