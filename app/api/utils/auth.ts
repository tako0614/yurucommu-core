import { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import Session from "../models/session.ts";
import { getEnv } from "./env_store.ts";

const authRequired: MiddlewareHandler = async (c, next) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) {
    return c.json({ error: "認証が必要です" }, 401);
  }
  const env = getEnv(c);
  const session = await Session.findOne({
    sessionId,
    tenant_id: env["ACTIVITYPUB_DOMAIN"],
  });
  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await Session.deleteOne({
        sessionId,
        tenant_id: env["ACTIVITYPUB_DOMAIN"],
      });
    }
    return c.json({ error: "認証が必要です" }, 401);
  }
  session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await session.save();
  setCookie(c, "sessionId", session.sessionId, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: session.expiresAt,
    sameSite: "Lax",
  });
  await next();
};

export default authRequired;
