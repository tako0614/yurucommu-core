import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "@takos/config";
import { issueSession } from "../utils/session.ts";
import { getDB } from "../db/mod.ts";
import {
  setCookie,
} from 'hono/cookie'

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
      const host = env["OAUTH_HOST"];
      if (!host) {
        return c.json({ error: "Server configuration error" }, 500);
      }

      // OAuth ホストの検証
      const oauthHostname =
        host.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];

      // 内部アドレスやローカルホストのブロック
      const blockedHosts = [
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "169.254.169.254", // AWS metadata
        "::1",
        "::ffff:127.0.0.1",
      ];

      if (blockedHosts.includes(oauthHostname.toLowerCase())) {
        console.error(`Invalid OAuth host configuration: ${oauthHostname}`);
        return c.json({ error: "Invalid OAuth configuration" }, 500);
      }

      // IPアドレスの検証
      const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
      const ipv6Regex = /^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i;

      if (ipv4Regex.test(oauthHostname) || ipv6Regex.test(oauthHostname)) {
        // プライベートIPアドレスのチェック
        const privateRanges = [
          /^10\./,
          /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
          /^192\.168\./,
          /^127\./,
          /^0\./,
          /^169\.254\./,
          /^fc00:/i,
          /^fd[0-9a-f]{2}:/i,
          /^fe80:/i,
          /^::1$/i,
        ];

        if (privateRanges.some((range) => range.test(oauthHostname))) {
          console.error(`OAuth host resolves to private IP: ${oauthHostname}`);
          return c.json({ error: "Invalid OAuth configuration" }, 500);
        }
      }

      const url = host.startsWith("http") ? host : `https://${host}`;

      // タイムアウト設定
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      try {
        const res = await fetch(`${url}/oauth/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: accessToken }),
          signal: controller.signal,
        });

        if (!res.ok) return c.json({ error: "Invalid token" }, 401);
  const data = await res.json() as { active?: boolean; user?: { id?: string } };
  if (!data?.active) return c.json({ error: "Invalid token" }, 401);
  const user = data.user;
        if (!user || !user.id) return c.json({ error: "Invalid user" }, 401);

        await issueSession(c, getDB(c));
        return c.json({ success: true, message: "Login successful" });
      } finally {
        clearTimeout(timeout);
      }
    }

    const hashedPassword = env["hashedPassword"];
    if (!hashedPassword) {
      return c.json({ error: "not_configured" }, 400);
    }

    try {
      const salt = env["salt"] ?? "";
      const ok = (await sha256Hex((password ?? "") + salt)) === hashedPassword;
      if (!ok) {
        return c.json({ error: "Invalid password" }, 401);
      }

      await issueSession(c, getDB(c));

      return c.json({ success: true, message: "Login successful" });
    } catch (error) {
      console.error("Login error:", error);
      return c.json({ error: "Authentication failed" }, 500);
    }
  },
);

// --- OAuth server-side flow ---

// Client-driven flow: return authorize URL as JSON and set state cookie
app.get("/login/oauth/prepare", (c) => {
  const env = getEnv(c);
  const host = env["OAUTH_HOST"];
  const clientId = env["OAUTH_CLIENT_ID"];
  if (!host || !clientId) {
    return c.json({ error: "OAuth not configured" }, 500);
  }
  const base = host.startsWith("http") ? host : `https://${host}`;
  const origin = getExternalOrigin(c);
  const redirectPath = (env["OAUTH_REDIRECT_PATH"] ?? "/api/login/oauth/callback").trim() || "/api/login/oauth/callback";
  const normPath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
  const redirectUri = `${origin}${normPath}`;
  const state = crypto.randomUUID();
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
  c.header("Cache-Control", "no-store, no-cache, must-revalidate");
  c.header("Pragma", "no-cache");
  c.header("Expires", "0");
  return c.json({ authorizeUrl: url.toString() });
});

// OAuth コールバックエンドポイント
app.get("/login/oauth/callback", async (c) => {
  try {
    console.log("[oauth] callback endpoint hit directly");
    
    const code = c.req.query("code");
    const state = c.req.query("state") ?? "";
    
    if (!code) {
      return c.json({ error: "Missing authorization code" }, 400);
    }
    
    console.log("[oauth] callback start", {
      hasCode: !!code,
      hasState: !!state,
    });
    
    const env = getEnv(c);
    const host = env["OAUTH_HOST"];
    const clientId = env["OAUTH_CLIENT_ID"];
    const clientSecret = env["OAUTH_CLIENT_SECRET"];
    
    if (!host || !clientId || !clientSecret) {
      console.warn("[oauth] missing env", {
        hasHost: !!host,
        hasClientId: !!clientId,
        hasClientSecret: !!clientSecret,
      });
      return c.json({ error: "OAuth configuration error" }, 500);
    }
    
    // Get state cookie and verify
    const { getCookie, deleteCookie } = await import("hono/cookie");
    const stateCookie = getCookie(c, "oauthState") ?? "";
    
    if (!state || !stateCookie || state !== stateCookie) {
      console.warn("[oauth] state mismatch", {
        hasState: !!state,
        hasStateCookie: !!stateCookie,
        eq: state === stateCookie,
      });
      return c.json({ error: "Invalid state parameter" }, 400);
    }
    
    deleteCookie(c, "oauthState", { path: "/" });
    
    // Build redirect URI
    const origin = getExternalOrigin(c);
    const redirectPath = (env["OAUTH_REDIRECT_PATH"] ?? "/api/login/oauth/callback").trim() || "/api/login/oauth/callback";
    const normPath = redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`;
    const redirectUri = `${origin}${normPath}`;
    
    // Exchange code for token
    const base = host.startsWith("http") ? host : `https://${host}`;
    const form = new URLSearchParams();
    form.set("grant_type", "authorization_code");
    form.set("code", code);
    form.set("client_id", clientId);
    form.set("client_secret", clientSecret);
    form.set("redirect_uri", redirectUri);
    
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    
    if (!tokenRes.ok) {
      console.warn("[oauth] token exchange failed", { status: tokenRes.status });
      return c.json({ error: "Token exchange failed" }, 400);
    }
    
    const tokenData = await tokenRes.json() as { access_token?: string };
    if (!tokenData.access_token) {
      console.warn("[oauth] no access_token in token response");
      return c.json({ error: "No access token received" }, 400);
    }
    
    // Verify token
    const verifyRes = await fetch(`${base}/oauth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenData.access_token }),
    });
    
    if (!verifyRes.ok) {
      console.warn("[oauth] verify failed", { status: verifyRes.status });
      return c.json({ error: "Token verification failed" }, 400);
    }
    
    const v = await verifyRes.json() as { active?: boolean };
    if (!v?.active) {
      console.warn("[oauth] token inactive");
      return c.json({ error: "Token is not active" }, 400);
    }
    
    console.log("[oauth] verified, issuing session");
    
    // Issue session
    await issueSession(c, getDB(c));
    
    // Redirect to home
    return c.redirect("/");
    
  } catch (error) {
    console.error("[oauth] callback error", error);
    return c.json({ error: "OAuth callback failed" }, 500);
  }
});

export default app;
// --- helpers ---
function getExternalOrigin(c: import("hono").Context) {
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