import { getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";

export interface AuthOptions<T> {
  cookieName: string;
  errorMessage: string;
  findSession: (sid: string, c: Context) => Promise<T | null>;
  deleteSession?: (sid: string, c: Context) => Promise<void>;
  updateSession: (session: T, expires: Date, c: Context) => Promise<void>;
  attach?: (c: Context, session: T) => void;
}

export function createAuthMiddleware<T>(
  opts: AuthOptions<T>,
): MiddlewareHandler {
  return async (c, next) => {
    const sid = getCookie(c, opts.cookieName);
    if (!sid) return c.json({ error: opts.errorMessage }, 401);
    const session = await opts.findSession(sid, c);
    if (
      !session ||
      (session as unknown as { expiresAt?: Date }).expiresAt! <= new Date()
    ) {
      if (session && opts.deleteSession) await opts.deleteSession(sid, c);
      return c.json({ error: opts.errorMessage }, 401);
    }
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await opts.updateSession(session, expiresAt, c);
    setCookie(c, opts.cookieName, sid, {
      httpOnly: true,
      secure: c.req.url.startsWith("https://"),
      expires: expiresAt,
      sameSite: "Lax",
      path: "/",
    });
    if (opts.attach) opts.attach(c, session);
    await next();
  };
}
