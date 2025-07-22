import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import { createDB } from "../DB/mod.ts";
import authRequired from "../utils/auth.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();
app.use("/logout", authRequired);

app.post("/logout", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  const env = getEnv(c);
  if (sessionId) {
    const db = createDB(env);
    await db.deleteSessionById(sessionId);
    deleteCookie(c, "sessionId", { path: "/" });
  }
  return c.json({ success: true });
});

export default app;
