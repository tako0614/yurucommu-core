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
    // attach session into the Hono context so route handlers can access
    // the logged-in session information (e.g. to determine current user)
    attach: (c, session) => {
      // attach the session document to Hono context using c.set so handlers
      // can retrieve it with c.get("session") or c.req.context if needed.
      // This avoids direct mutation of internal req fields and matches other
      // usage in the codebase (see takos_host/auth.ts where c.set is used).
      try {
        c.set("session", session);
      } catch {
        // noop
      }
    },
  });
}
