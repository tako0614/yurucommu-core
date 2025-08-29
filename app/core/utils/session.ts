import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import type { DataStore } from "../db/types.ts";

export async function issueSession(
  c: Context,
  db: DataStore,
): Promise<void> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const deviceId = crypto.randomUUID();
  await db.sessions.create(sessionId, expiresAt, deviceId);
  setCookie(c, "sessionId", sessionId, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: expiresAt,
    sameSite: "Lax",
  });
}
