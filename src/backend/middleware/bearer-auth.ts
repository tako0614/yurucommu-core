import type { MiddlewareHandler } from "hono";
import type { Env, Variables } from "../types.ts";
import {
  getOidcClientCredentials,
  getOidcIssuerUrl,
  issuerEndpoint,
} from "../lib/oauth-providers.ts";

export function requireBearerAuth(
  requiredScope: string,
): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const auth = c.req.header("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const token = auth.slice(7);
    const issuer = getOidcIssuerUrl(c.env);
    const { clientId, clientSecret } = getOidcClientCredentials(c.env);
    if (!issuer || !clientId || !clientSecret) {
      return c.json({
        error: "server_error",
        error_description: "Takosumi Accounts OIDC client not configured",
      }, 500);
    }

    const res = await fetch(issuerEndpoint(issuer, "/oauth/introspect"), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      return c.json({
        error: "server_error",
        error_description: "Introspect failed",
      }, 500);
    }

    const info = await res.json() as {
      active: boolean;
      scope?: string;
      sub?: string;
      client_id?: string;
    };
    if (!info.active) {
      return c.json({ error: "invalid_token" }, 401);
    }
    const scopes = (info.scope ?? "").split(" ");
    if (!scopes.includes(requiredScope)) {
      return c.json({ error: "insufficient_scope" }, 403);
    }

    c.set("oauthToken", {
      sub: info.sub ?? "",
      scope: info.scope ?? "",
      client_id: info.client_id ?? "",
    });
    await next();
  };
}
