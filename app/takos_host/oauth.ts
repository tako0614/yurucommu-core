import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { cors } from "hono/cors";
import OAuthClient from "../models/takos_host/oauth_client.ts";
import OAuthCode from "../models/takos_host/oauth_code.ts";
import OAuthToken from "../models/takos_host/oauth_token.ts";
import {
  findHostSessionById,
  updateHostSession,
} from "./repositories/session.ts";

export const oauthApp = new Hono();
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
  const client = await OAuthClient.findOne({ clientId });
  if (!client || client.redirectUri !== redirectUri) {
    return c.text("invalid_client", 400);
  }
  const sid = getCookie(c, "hostSessionId");
  if (!sid) return c.text("login required", 401);
  const session = await findHostSessionById(sid);
  if (!session || session.expiresAt <= new Date()) {
    return c.text("login required", 401);
  }
  const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await updateHostSession(sid, newExpiresAt);
  setCookie(c, "hostSessionId", sid, {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: newExpiresAt,
    sameSite: "Lax",
    path: "/",
  });
  const code = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const oauthCode = new OAuthCode({
    code,
    client: client._id,
    user: session.user,
    expiresAt,
  });
  await oauthCode.save();
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
  const client = await OAuthClient.findOne({ clientId });
  if (
    !client || client.clientSecret !== clientSecret ||
    client.redirectUri !== redirectUri
  ) {
    return c.json({ error: "invalid_client" }, 400);
  }
  const authCode = await OAuthCode.findOne({ code, client: client._id });
  if (!authCode || authCode.expiresAt <= new Date()) {
    return c.json({ error: "invalid_grant" }, 400);
  }
  await OAuthCode.deleteOne({ code });
  const tokenStr = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const token = new OAuthToken({
    token: tokenStr,
    client: client._id,
    user: authCode.user,
    expiresAt,
  });
  await token.save();
  return c.json({
    access_token: tokenStr,
    token_type: "Bearer",
    expires_in: 86400,
  });
});

// Token verification
oauthApp.post("/verify", async (c) => {
  const { token } = await c.req.json();
  if (typeof token !== "string") return c.json({ active: false }, 400);
  const t = await OAuthToken.findOne({ token }).populate("user");
  if (!t || t.expiresAt <= new Date()) {
    return c.json({ active: false }, 401);
  }
  return c.json({ active: true, userName: t.user.userName });
});

export default oauthApp;
