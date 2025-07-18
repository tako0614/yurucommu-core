import { MiddlewareHandler } from "hono";
import Session from "../models/session.ts";
import { getEnv } from "./env_store.ts";
import { createAuthMiddleware } from "../../shared/auth.ts";

const authRequired: MiddlewareHandler = createAuthMiddleware({
  cookieName: "sessionId",
  errorMessage: "認証が必要です",
  findSession: async (sid, c) => {
    const env = getEnv(c);
    return await Session.findOne({
      sessionId: sid,
      tenant_id: env["ACTIVITYPUB_DOMAIN"],
    });
  },
  deleteSession: async (sid, c) => {
    const env = getEnv(c);
    await Session.deleteOne({
      sessionId: sid,
      tenant_id: env["ACTIVITYPUB_DOMAIN"],
    });
  },
  updateSession: async (session, expires) => {
    (session as unknown as { expiresAt: Date }).expiresAt = expires;
    await (session as unknown as { save: () => Promise<void> }).save();
  },
});

export default authRequired;
