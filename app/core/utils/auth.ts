import type { MiddlewareHandler } from "hono";
import { createAuthMiddleware } from "@takos/auth";
import type { SessionDoc } from "@takos/types";
import type { DataStore } from "../db/types.ts";

export default function authRequired(db: DataStore): MiddlewareHandler {
  return createAuthMiddleware<SessionDoc>({
    cookieName: "sessionId",
    errorMessage: "認証が必要です",
    findSession: async (sid) => {
      return await db.sessions.findById(sid);
    },
    deleteSession: async (sid) => {
      await db.sessions.deleteById(sid);
    },
    updateSession: async (session, expires) => {
      await db.sessions.updateExpires(session.sessionId, expires);
    },
  });
}
