import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { getDB } from "../db/mod.ts";

const app = new Hono();

app.get("/session/status", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) {
    return c.json({ login: false });
  }

  try {
    const db = getDB(c);
    const session = await db.sessions.findById(sessionId);
    if (session && session.expiresAt > new Date()) {
      return c.json({ login: true });
    } else {
      if (session) {
        // Clean up expired session
        await db.sessions.deleteById(sessionId);
      }
      return c.json({ login: false });
    }
  } catch (error) {
    console.error("Session status check failed:", error);
    return c.json({ login: false, error: "Server error" }, 500);
  }
});

export default app;
