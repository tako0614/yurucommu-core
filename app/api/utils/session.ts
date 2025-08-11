import { setCookie } from "hono/cookie";
import type { Context } from "hono";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";

export async function issueSession(c: Context): Promise<void> {
  const env = getEnv(c);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const db = createDB(env);
  await db.createSession(sessionId, expiresAt);
  setCookie(c, "sessionId", sessionId, {
    path: "/",
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: expiresAt,
    sameSite: "Lax",
  });
}
