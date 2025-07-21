import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "../../shared/config.ts";
import { createSession } from "../repositories/session.ts";

const app = new Hono();

app.post(
  "/oauth/login",
  // ① JSON に accessToken が含まれているか検証
  zValidator("json", z.object({ accessToken: z.string() })),
  async (c) => {
    const { accessToken } = c.req.valid("json") as { accessToken: string };

    const env = getEnv(c);
    const host = env["OAUTH_HOST"] ?? env["ROOT_DOMAIN"];
    if (!host) {
      return c.json({ error: "Server configuration error" }, 500);
    }
    const url = host.startsWith("http") ? host : `https://${host}`;

    // ② アクセストークン検証
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

    // ③ セッション発行（7 日間有効）
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await createSession(env, sessionId, expiresAt, user.id);

    // ④ Cookie 設定
    setCookie(c, "sessionId", sessionId, {
      path: "/",
      httpOnly: true,
      secure: c.req.url.startsWith("https://"),
      expires: expiresAt,
      sameSite: "Lax",
    });

    return c.json({ success: true, message: "Login successful" });
  },
);

export default app;
