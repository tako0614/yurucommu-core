import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { compare } from "bcrypt";
import { getEnv } from "./utils/env_store.ts";
import Session from "./models/session.ts";

const app = new Hono();

app.post("/login", async (c) => {
  const { password } = await c.req.json();
  const env = getEnv(c);
  const hashedPassword = env["hashedPassword"];
  if (!hashedPassword) {
    return c.json({ error: "not_configured" }, 400);
  }
  try {
    const ok = await compare(password, hashedPassword);

    if (ok) {
      const sessionId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

      const session = new Session({
        sessionId,
        expiresAt,
      });
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
    } else {
      return c.json({ error: "Invalid password" }, 401);
    }
  } catch (error) {
    console.error("Login error:", error);
    return c.json({ error: "Authentication failed" }, 500);
  }
});

export default app;
