import { Hono } from "hono";
import { compare } from "bcrypt";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "@takos/config";
import { issueSession } from "../utils/session.ts";
import { setCookie } from "hono/cookie";

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
        const data = await res.json();
        if (!data.active) return c.json({ error: "Invalid token" }, 401);
        const user = data.user;
        if (!user || !user.id) return c.json({ error: "Invalid user" }, 401);

        await issueSession(c);
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
  const host = env["OAUTH_HOST"];
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
// (旧) /login/oauth/callback は利用しない（redirect_uri はオリジンのみ）。

// Debug endpoint: shows computed OAuth parameters
// (デバッグ用エンドポイント) は削除しました。
