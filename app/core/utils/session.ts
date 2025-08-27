import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import { createDB } from "../db/mod.ts";
import { getEnv } from "../../shared/config.ts";

export async function issueSession(c: Context): Promise<void> {
  const env = getEnv(c);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const db = createDB(env);
  const deviceId = crypto.randomUUID();
  await db.createSession(sessionId, expiresAt, deviceId);
  setCookie(c, "sessionId", sessionId, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: expiresAt,
    sameSite: "Lax",
  });
}
