import { Hono } from "hono";
import { compare } from "bcrypt";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getEnv } from "../../shared/config.ts";
import { issueSession } from "../utils/session.ts";

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
