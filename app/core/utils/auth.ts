import { MiddlewareHandler } from "hono";
import { createDB } from "../db/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { createAuthMiddleware } from "../../shared/auth.ts";
import type { SessionDoc } from "../../shared/types.ts";

const authRequired: MiddlewareHandler = createAuthMiddleware<SessionDoc>({
  cookieName: "sessionId",
  errorMessage: "認証が必要です",
  findSession: async (sid, c) => {
    const env = getEnv(c);
    const db = createDB(env);
    return await db.findSessionById(sid);
  },
  deleteSession: async (sid, c) => {
    const env = getEnv(c);
    const db = createDB(env);
    await db.deleteSessionById(sid);
  },
  updateSession: async (session, expires, c) => {
    const env = getEnv(c);
    const db = createDB(env);
    await db.updateSessionExpires(session.sessionId, expires);
  },
});

export default authRequired;
