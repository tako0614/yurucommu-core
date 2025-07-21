import { MiddlewareHandler } from "hono";
import {
  deleteSessionById,
  findSessionById,
  updateSessionExpires,
} from "../repositories/session.ts";
import { getEnv } from "../../shared/config.ts";
import { createAuthMiddleware } from "../../shared/auth.ts";

const authRequired: MiddlewareHandler = createAuthMiddleware({
  cookieName: "sessionId",
  errorMessage: "認証が必要です",
  findSession: async (sid, c) => {
    const env = getEnv(c);
    return await findSessionById(env, sid);
  },
  deleteSession: async (sid, c) => {
    const env = getEnv(c);
    await deleteSessionById(env, sid);
  },
  updateSession: async (session, expires, c) => {
    const env = getEnv(c);
    await updateSessionExpires(env, session.sessionId, expires);
  },
});

export default authRequired;
