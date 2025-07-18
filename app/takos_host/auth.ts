import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { compare, hash as bcryptHash } from "bcrypt";
import HostUser from "./models/user.ts";
import HostSession from "./models/session.ts";

export async function hash(text: string): Promise<string> {
  return await bcryptHash(text);
}

export function createAuthApp(options?: { rootDomain?: string }) {
  const app = new Hono();
  const rootDomain = options?.rootDomain ?? "";

  app.post("/register", async (c) => {
    const { userName, password } = await c.req.json();
    if (typeof userName !== "string" || typeof password !== "string") {
      return c.json({ error: "invalid" }, 400);
    }
    const exists = await HostUser.findOne({ userName });
    if (exists) return c.json({ error: "exists" }, 400);
    const salt = crypto.randomUUID();
    const hashedPassword = await hash(password);
    const user = new HostUser({ userName, hashedPassword, salt });
    await user.save();
    return c.json({ success: true });
  });

  app.post("/login", async (c) => {
    const { userName, password } = await c.req.json();
    const user = await HostUser.findOne({ userName });
    if (!user) return c.json({ error: "invalid" }, 401);
    const ok = await compare(password, user.hashedPassword);
    if (!ok) {
      return c.json({ error: "invalid" }, 401);
    }
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const session = new HostSession({ sessionId, user: user._id, expiresAt });
    await session.save();
    setCookie(c, "hostSessionId", sessionId, {
      httpOnly: true,
      secure: c.req.url.startsWith("https://"),
      expires: expiresAt,
      sameSite: "Lax",
      path: "/",
    });
    return c.json({ success: true });
  });

  app.get("/status", async (c) => {
    const sid = getCookie(c, "hostSessionId");
    if (!sid) return c.json({ login: false, rootDomain });
    const session = await HostSession.findOne({ sessionId: sid });
    if (session && session.expiresAt > new Date()) {
      return c.json({ login: true, user: session.user, rootDomain });
    }
    if (session) await HostSession.deleteOne({ sessionId: sid });
    return c.json({ login: false, rootDomain });
  });

  app.delete("/logout", async (c) => {
    const sid = getCookie(c, "hostSessionId");
    if (sid) {
      await HostSession.deleteOne({ sessionId: sid });
      deleteCookie(c, "hostSessionId", { path: "/" });
    }
    return c.json({ success: true });
  });

  return app;
}

export const authRequired: MiddlewareHandler = async (c, next) => {
  const sid = getCookie(c, "hostSessionId");
  if (!sid) return c.json({ error: "unauthorized" }, 401);
  const session = await HostSession.findOne({ sessionId: sid }).populate(
    "user",
  );
  if (!session || session.expiresAt <= new Date()) {
    if (session) await HostSession.deleteOne({ sessionId: sid });
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", session.user);
  await next();
};
