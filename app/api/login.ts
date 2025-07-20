import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { compare } from "bcrypt"; // bcrypt で検証
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "../../shared/config.ts";
import { createSession } from "./repositories/session.ts";

const app = new Hono();

app.post(
  "/login",
  // ✅ 入力検証
  zValidator(
    "json",
    z.object({
      password: z.string().min(1, "password is required"),
    }),
  ),
  async (c) => {
    const { password } = c.req.valid("json") as { password: string };

    const env = getEnv(c);
    const hashedPassword = env["hashedPassword"]; // bcrypt でハッシュ化済み文字列を想定

    if (!hashedPassword) {
      return c.json({ error: "not_configured" }, 400);
    }

    try {
      // ✅ パスワード検証（bcrypt）
      const ok = await compare(password, hashedPassword);
      if (!ok) {
        return c.json({ error: "Invalid password" }, 401);
      }

      // ✅ セッション生成
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      await createSession(env, sessionId, expiresAt);

      // ✅ Cookie 設定
      setCookie(c, "sessionId", sessionId, {
        path: "/",
        httpOnly: true,
        secure: c.req.url.startsWith("https://"),
        expires: expiresAt,
        sameSite: "Lax",
      });

      return c.json({ success: true, message: "Login successful" });
    } catch (error) {
      console.error("Login error:", error);
      return c.json({ error: "Authentication failed" }, 500);
    }
  },
);

export default app;
