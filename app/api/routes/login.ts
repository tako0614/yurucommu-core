import { Hono } from "hono";
import { compare } from "bcrypt";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "../../shared/config.ts";
import { issueSession } from "../utils/session.ts";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const app = new Hono();

const schema = z.object({
  password: z.string().optional(),
  accessToken: z.string().optional(),
}).refine((d) => d.password || d.accessToken, {
  message: "password or accessToken is required",
});

app.post(
  "/login",
  zValidator("json", schema),
  async (c) => {
    const { password, accessToken } = c.req.valid("json") as {
      password?: string;
      accessToken?: string;
    };

    const env = getEnv(c);

    if (accessToken) {
      const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"];
      if (!host) {
        return c.json({ error: "Server configuration error" }, 500);
      }
      const url = host.startsWith("http") ? host : `https://${host}`;
      const res = await fetch(`${url}/oauth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: accessToken }),
      });
      if (!res.ok) return c.json({ error: "Invalid token" }, 401);
      const data = await res.json();
      if (!data.active) return c.json({ error: "Invalid token" }, 401);
      const user = data.user;
      if (!user || !user.id) return c.json({ error: "Invalid user" }, 401);

      await issueSession(c);
      return c.json({ success: true, message: "Login successful" });
    }

    const hashedPassword = env["hashedPassword"];
    if (!hashedPassword) {
      return c.json({ error: "not_configured" }, 400);
    }

    try {
      const ok = await compare(password ?? "", hashedPassword);
      if (!ok) {
        return c.json({ error: "Invalid password" }, 401);
      }

      await issueSession(c);

      return c.json({ success: true, message: "Login successful" });
    } catch (error) {
      console.error("Login error:", error);
      return c.json({ error: "Authentication failed" }, 500);
    }
  },
);

export default app;
// --- helpers ---
function getExternalOrigin(c: Parameters<Hono["get"]>[0]) {
  const xfProto = c.req.header("x-forwarded-proto");
  const xfHost = c.req.header("x-forwarded-host");
  if (xfProto && xfHost) {
    const proto = xfProto.split(",")[0].trim();
    const host = xfHost.split(",")[0].trim();
    return `${proto}://${host}`;
  }
  const u = new URL(c.req.url);
  return `${u.protocol}//${u.host}`;
}

// --- OAuth server-side flow ---
// Start: redirect user to OAuth host authorize with server-computed redirect_uri
app.get("/login/oauth/start", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"];
  const clientId = env["OAUTH_CLIENT_ID"];
  if (!host || !clientId) {
    return c.json({ error: "OAuth not configured" }, 500);
  }
  const base = host.startsWith("http") ? host : `https://${host}`;
  const origin = getExternalOrigin(c);
  // takos_host 側のクライアント登録はリダイレクトURIにルート(オリジン)を期待する
  // 既存のフロント実装は ?code=... を受けてトークン交換するため、ここは origin に合わせる
  const redirectUri = `${origin}`;
  const state = crypto.randomUUID();
  // Save state in cookie to validate later
  const expires = new Date(Date.now() + 10 * 60 * 1000);
  setCookie(c, "oauthState", state, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    sameSite: "Lax",
    expires,
  });
  const url = new URL(`${base}/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return c.redirect(url.toString());
});
// Callback: exchange code -> token and issue session, then redirect to app root
app.get("/login/oauth/callback", async (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"];
  const clientId = env["OAUTH_CLIENT_ID"];
  const clientSecret = env["OAUTH_CLIENT_SECRET"];
  if (!host || !clientId || !clientSecret) {
    return c.json({ error: "OAuth not configured" }, 500);
  }
  const base = host.startsWith("http") ? host : `https://${host}`;
  const origin = getExternalOrigin(c);
  const redirectUri = `${origin}`;
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const stateCookie = getCookie(c, "oauthState") ?? "";
  if (!code || !state || !stateCookie || state !== stateCookie) {
    return c.json({ error: "invalid_state" }, 400);
  }
  // clear state cookie
  deleteCookie(c, "oauthState", { path: "/" });
  // Exchange code for token
  const form = new URLSearchParams();
  form.set("grant_type", "authorization_code");
  form.set("code", code);
  form.set("client_id", clientId);
  form.set("client_secret", clientSecret);
  form.set("redirect_uri", redirectUri);
  const tokenRes = await fetch(`${base}/oauth/token`, { method: "POST", body: form });
  if (!tokenRes.ok) {
    return c.json({ error: "token_error" }, 400);
  }
  const tokenData = await tokenRes.json() as { access_token?: string };
  if (!tokenData.access_token) {
    return c.json({ error: "token_invalid" }, 400);
  }
  // Verify token (optional but safer)
  const verifyRes = await fetch(`${base}/oauth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: tokenData.access_token }),
  });
  if (!verifyRes.ok) return c.json({ error: "verify_failed" }, 401);
  const v = await verifyRes.json();
  if (!v.active) return c.json({ error: "inactive_token" }, 401);
  await issueSession(c);
  // redirect to app root
  return c.redirect("/");
});

// Debug endpoint: shows computed OAuth parameters
app.get("/login/oauth/debug", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"];
  const clientId = env["OAUTH_CLIENT_ID"] ?? null;
  const origin = getExternalOrigin(c);
  const redirectUri = `${origin}`;
  return c.json({
    host,
    clientId,
    origin,
    redirectUri,
  });
});
