import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { compare, hash as bcryptHash } from "bcrypt";
import HostUser from "./models/user.ts";
import HostSession from "./models/session.ts";
import { sendVerifyMail } from "./mailer.ts";

/** bcrypt.hash をラップ（saltRounds = 10） */
export async function hash(text: string): Promise<string> {
  return await bcryptHash(text, "10");
}

export function createAuthApp(options?: {
  rootDomain?: string;
  termsRequired?: boolean;
}) {
  const app = new Hono();
  const rootDomain   = options?.rootDomain   ?? "";
  const termsRequired = options?.termsRequired ?? false;

  /* --------------------------- REGISTER --------------------------- */
  app.post("/register", async (c) => {
    const { userName, email, password, accepted } = await c.req.json();
    if (
      typeof userName !== "string" ||
      typeof email   !== "string" ||
      typeof password !== "string" ||
      (termsRequired && accepted !== true)
    ) {
      return c.json({ error: "invalid" }, 400);
    }

    const exists = await HostUser.findOne({ $or: [{ userName }, { email }] });
    if (exists) return c.json({ error: "exists" }, 400);

    const hashedPassword     = await hash(password);
    const verifyCode         = Math.floor(100000 + Math.random() * 900000).toString();
    const verifyCodeExpires  = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const user = new HostUser({
      userName,
      email,
      hashedPassword,
      verifyCode,
      verifyCodeExpires,
      emailVerified: false,
    });
    await user.save();

    await sendVerifyMail(email, verifyCode);
    return c.json({ success: true });
  });

  /* ---------------------------- VERIFY ---------------------------- */
  app.post("/verify", async (c) => {
    const { userName, code } = await c.req.json();
    if (typeof userName !== "string" || typeof code !== "string") {
      return c.json({ error: "invalid" }, 400);
    }

    const user = await HostUser.findOne({ userName });
    if (
      !user ||
      user.emailVerified ||
      user.verifyCode          !== code ||
      !user.verifyCodeExpires  ||
      user.verifyCodeExpires   <= new Date()
    ) {
      return c.json({ error: "invalid" }, 400);
    }

    user.emailVerified   = true;
    user.verifyCode      = undefined;
    user.verifyCodeExpires = undefined;
    await user.save();

    return c.json({ success: true });
  });

  /* ----------------------------- LOGIN ---------------------------- */
  app.post("/login", async (c) => {
    const { userName, password } = await c.req.json();
    if (typeof userName !== "string" || typeof password !== "string") {
      return c.json({ error: "invalid" }, 400);
    }

    const user = await HostUser.findOne({ userName });
    if (!user)                    return c.json({ error: "invalid"   }, 401);
    if (!user.emailVerified)      return c.json({ error: "unverified"}, 403);

    const ok = await compare(password, user.hashedPassword);
    if (!ok) return c.json({ error: "invalid" }, 401);

    const sessionId  = crypto.randomUUID();
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await new HostSession({ sessionId, user: user._id, expiresAt }).save();

    setCookie(c, "hostSessionId", sessionId, {
      httpOnly : true,
      secure   : c.req.url.startsWith("https://"),
      expires  : expiresAt,
      sameSite : "Lax",
      path     : "/",
    });

    return c.json({ success: true });
  });

  /* --------------------------- STATUS ----------------------------- */
  app.get("/status", async (c) => {
    const sid = getCookie(c, "hostSessionId");
    if (!sid) return c.json({ login: false, rootDomain, termsRequired });

    const session = await HostSession.findOne({ sessionId: sid });
    if (session && session.expiresAt > new Date()) {
      // 期限延長
      session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await session.save();
      setCookie(c, "hostSessionId", sid, {
        httpOnly : true,
        secure   : c.req.url.startsWith("https://"),
        expires  : session.expiresAt,
        sameSite : "Lax",
        path     : "/",
      });
      return c.json({
        login : true,
        user  : session.user,
        rootDomain,
        termsRequired,
      });
    }

    if (session) await HostSession.deleteOne({ sessionId: sid });
    return c.json({ login: false, rootDomain, termsRequired });
  });

  /* ---------------------------- LOGOUT ---------------------------- */
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

/* --------------- Auth-required middleware ---------------- */
export const authRequired: MiddlewareHandler = async (c, next) => {
  const sid = getCookie(c, "hostSessionId");
  if (!sid) return c.json({ error: "unauthorized" }, 401);

  const session = await HostSession.findOne({ sessionId: sid }).populate("user");
  if (!session || session.expiresAt <= new Date()) {
    if (session) await HostSession.deleteOne({ sessionId: sid });
    return c.json({ error: "unauthorized" }, 401);
  }

  // 期限延長
  session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await session.save();

  setCookie(c, "hostSessionId", sid, {
    httpOnly : true,
    secure   : c.req.url.startsWith("https://"),
    expires  : session.expiresAt,
    sameSite : "Lax",
    path     : "/",
  });

  c.set("user", session.user);
  await next();
};
