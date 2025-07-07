import { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import Session from "../models/session.ts";

const authRequired: MiddlewareHandler = async (c, next) => {
  const sessionId = getCookie(c, "sessionId");
  if (!sessionId) {
    return c.json({ error: "認証が必要です" }, 401);
  }
  const session = await Session.findOne({ sessionId });
  if (!session || session.expiresAt <= new Date()) {
    if (session) {
      await Session.deleteOne({ sessionId });
    }
    return c.json({ error: "認証が必要です" }, 401);
  }
  await next();
};

export default authRequired;
