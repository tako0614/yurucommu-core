import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { getEnv } from "./utils/env_store.ts";
import Session from "./models/session.ts";

const app = new Hono();

app.post("/oauth/login", async (c) => {
  const { accessToken } = await c.req.json();
  const env = getEnv(c);
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
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session = new Session({ sessionId, expiresAt });
  (session as unknown as { $locals?: { env?: Record<string, string> } })
    .$locals = { env };
  await session.save();
  setCookie(c, "sessionId", sessionId, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: expiresAt,
    sameSite: "Lax",
  });
  return c.json({ success: true, message: "Login successful" });
});

export default app;
