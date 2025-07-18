import { Hono } from "hono";
import { deleteCookie, getCookie } from "hono/cookie";
import Session from "./models/session.ts";
import authRequired from "./utils/auth.ts";
import { getEnv } from "../../shared/config.ts";

const app = new Hono();
app.use("/logout", authRequired);

app.post("/logout", async (c) => {
  const sessionId = getCookie(c, "sessionId");
  const env = getEnv(c);
  if (sessionId) {
    await Session.deleteOne({
      sessionId,
      tenant_id: env["ACTIVITYPUB_DOMAIN"],
    });
    deleteCookie(c, "sessionId", { path: "/" });
  }
  return c.json({ success: true });
});

export default app;
