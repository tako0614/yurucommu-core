import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();
app.use("/session/*", authRequired);

app.get("/session/status", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) {
    return c.json({ login: false });
  }

  try {
    const env = getEnv(c);
    const db = createDB(env);
    const session = await db.findSessionById(sessionId);
    if (session && session.expiresAt > new Date()) {
      return c.json({ login: true });
    } else {
      if (session) {
        // Clean up expired session
        await db.deleteSessionById(sessionId);
      }
      return c.json({ login: false });
    }
  } catch (error) {
    console.error("Session status check failed:", error);
    return c.json({ login: false, error: "Server error" }, 500);
  }
});

export default app;
