import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import Session from "./models/session.ts";
import authRequired from "./utils/auth.ts";

const app = new Hono();
app.use("*", authRequired);

app.post("/logout", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  if (sessionId) {
    await Session.deleteOne({ sessionId });
    deleteCookie(c, "sessionId", { path: "/" });
  }
  return c.json({ success: true });
});

export default app;
