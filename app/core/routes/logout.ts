import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { getDB } from "../db/mod.ts";
import authRequired from "../utils/auth.ts";

const app = new Hono();
app.use("/logout", authRequired);

app.post("/logout", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  if (sessionId) {
    const db = getDB(c);
    await db.deleteSessionById(sessionId);
    deleteCookie(c, "sessionId", { path: "/" });
  }
  return c.json({ success: true });
});

export default app;
