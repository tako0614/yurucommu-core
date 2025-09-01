import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createCookieOpts } from "./auth.ts";
import { cors } from "hono/cors";
import { createDB } from "@takos_host/db";
import type { HostDataStore } from "./db/types.ts";

// OAuth 2.0 Authorization Code Grant (最小実装)
export const oauthApp = new Hono();

const AUTH_CODE_LIFETIME_MS = 10 * 60 * 1000; // 10 minutes
const ACCESS_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // 24 hours
// CORSミドルウェアの節約化
oauthApp.use("/token", cors());
oauthApp.use("/verify", cors());

// Authorization Endpoint
oauthApp.get("/authorize", async (c) => {
  const clientId = c.req.query("client_id");
  const redirectUri = c.req.query("redirect_uri");
  const state = c.req.query("state") ?? "";
  if (!clientId || !redirectUri) {
    return c.text("invalid_request", 400);
  }
  const db = createDB({}) as HostDataStore;
  const client = await db.oauth.find(clientId);
  if (!client || client.redirectUri !== redirectUri) {
    return c.text("invalid_client", 400);
  }
  const sid = getCookie(c, "hostSessionId");
  if (!sid) return c.text("login required", 401);
  const session = await db.hostSessions.findById(sid);
  if (!session || session.expiresAt <= new Date()) {
    return c.text("login required", 401);
  }
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await db.hostSessions.update(sid, { expiresAt: newExpiresAt });
  setCookie(c, "hostSessionId", sid, createCookieOpts(c, newExpiresAt));
  const code = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + AUTH_CODE_LIFETIME_MS);
  await db.oauth.createCode({ code, clientId, user: session.user, expiresAt });
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return c.redirect(url.toString());
});

// Token Endpoint
oauthApp.post("/token", async (c) => {
  const body = await c.req.formData();
  const grantType = body.get("grant_type");
  const code = body.get("code");
  const clientId = body.get("client_id");
  const clientSecret = body.get("client_secret");
  const redirectUri = body.get("redirect_uri");
  if (
    grantType !== "authorization_code" ||
    typeof code !== "string" ||
    typeof clientId !== "string" ||
    typeof clientSecret !== "string" ||
    typeof redirectUri !== "string"
  ) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const db = createDB({}) as HostDataStore;
  const client = await db.oauth.find(clientId);
  if (!client || client.clientSecret !== clientSecret || client.redirectUri !== redirectUri) {
    return c.json({ error: "invalid_client" }, 400);
  }
  const authCode = await db.oauth.findCode(code, clientId);
  if (!authCode || authCode.expiresAt <= new Date()) {
    return c.json({ error: "invalid_grant" }, 400);
  }
  await db.oauth.deleteCode(code);
  const tokenStr = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_LIFETIME_MS);
  await db.oauth.createToken({ token: tokenStr, clientId, user: authCode.user, expiresAt });
  return c.json({
    access_token: tokenStr,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_LIFETIME_MS / 1000),
  });
});

// Token verification
oauthApp.post("/verify", async (c) => {
  const { token } = await c.req.json();
  if (typeof token !== "string") return c.json({ active: false }, 400);
  const db = createDB({}) as HostDataStore;
  const t = await db.oauth.findToken(token);
  if (!t || t.expiresAt <= new Date()) {
    return c.json({ active: false }, 401);
  }
  const user = await db.hostUsers.findById(t.user);
  return c.json({
    active: true,
    user: {
      id: t.user,
      userName: user?.userName ?? "",
    },
  });
});

export default oauthApp;
