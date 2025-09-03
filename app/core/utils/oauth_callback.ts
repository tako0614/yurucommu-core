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
      console.log("[oauth] callback start", {
        path: c.req.path,
        hasCode: !!code,
        hasState: !!state,
      });
      const env = (c as unknown as { get: (k: string) => unknown }).get(
        "env",
      ) as Record<string, string>;
      const host = env["OAUTH_HOST"];
      const clientId = env["OAUTH_CLIENT_ID"];
      const clientSecret = env["OAUTH_CLIENT_SECRET"];
      if (!host || !clientId || !clientSecret) {
        console.warn("[oauth] missing env", {
          hasHost: !!host,
          hasClientId: !!clientId,
          hasClientSecret: !!clientSecret,
        });
        return await next();
      }
      const stateCookie = deps.getCookie(c, "oauthState") ?? "";
      if (!state || !stateCookie || state !== stateCookie) {
        console.warn("[oauth] state mismatch", {
          hasState: !!state,
          hasStateCookie: !!stateCookie,
          eq: state === stateCookie,
        });
        return await next();
      }
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
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      if (!tokenRes.ok) return await next();
      const tokenData = await tokenRes.json() as { access_token?: string };
      if (!tokenData.access_token) {
        console.warn("[oauth] no access_token in token response");
        return await next();
      }
      const verifyRes = await deps.fetch(`${base}/oauth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenData.access_token }),
      });
      if (!verifyRes.ok) {
        console.warn("[oauth] verify failed", { status: verifyRes.status });
        return await next();
      }
      const v = await verifyRes.json() as { active?: boolean };
      if (!v?.active) {
        console.warn("[oauth] token inactive");
        return await next();
      }
      console.log("[oauth] verified, issuing session");
      await deps.issueSession(c, getDB(c));
      return c.redirect("/");
    } catch (_e) {
      console.error("[oauth] callback error", _e);
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
