import { type Context, Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { getDB } from "../db/mod.ts";
import authRequired from "../utils/auth.ts";

const app = new Hono();
const auth = (c: Context, next: () => Promise<void>) =>
  authRequired(getDB(c))(c, next);
app.use("/logout", auth);

app.post("/logout", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  if (sessionId) {
    const db = getDB(c);
  await db.sessions.deleteById(sessionId);
    deleteCookie(c, "sessionId", { path: "/" });
  }
  return c.json({ success: true });
});

export default app;
