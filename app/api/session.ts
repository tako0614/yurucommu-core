import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import Session from "./models/session.ts";
import authRequired from "./utils/auth.ts";

const app = new Hono();
app.use("*", authRequired);

app.get("/session/status", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) {
    return c.json({ login: false });
  }

  try {
    const session = await Session.findOne({ sessionId });
    if (session && session.expiresAt > new Date()) {
      return c.json({ login: true });
    } else {
      if (session) {
        // Clean up expired session
        await Session.deleteOne({ sessionId });
      }
      return c.json({ login: false });
    }
  } catch (error) {
    console.error("Session status check failed:", error);
    return c.json({ login: false, error: "Server error" }, 500);
  }
});

export default app;
