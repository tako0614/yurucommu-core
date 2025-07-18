import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { compare, genSalt, hash as bcryptHash } from "bcrypt";
import HostUser from "./models/user.ts";
import HostSession from "./models/session.ts";
import { sendVerifyMail } from "./mailer.ts";

/** bcrypt.hash をラップ（saltRounds = 10） */
export async function hash(text: string): Promise<string> {
  const salt = await genSalt(10);
  return await bcryptHash(text, salt);
}

export function createAuthApp(options?: {
  rootDomain?: string;
  termsRequired?: boolean;
}) {
  const app = new Hono();
  const rootDomain = options?.rootDomain ?? "";
  const termsRequired = options?.termsRequired ?? false;

  /* --------------------------- REGISTER --------------------------- */
  app.post("/register", async (c) => {
    const { userName, email, password, accepted } = await c.req.json();
    if (
      typeof userName !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      (termsRequired && accepted !== true)
    ) {
      return c.json({ error: "invalid" }, 400);
    }

    const exists = await HostUser.findOne({ $or: [{ userName }, { email }] });
    if (exists) {
      if (exists.emailVerified) return c.json({ error: "exists" }, 400);

      exists.userName = userName;
      exists.email = email;
      const newSalt = crypto.randomUUID();
      exists.salt = newSalt;
      exists.hashedPassword = await hash(password + newSalt);
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      exists.verifyCode = newCode;
      exists.verifyCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
      await exists.save();
      await sendVerifyMail(email, exists.verifyCode);
      return c.json({ success: true });
    }

    const salt = crypto.randomUUID();
    const hashedPassword = await hash(password + salt);
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verifyCodeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    const user = new HostUser({
      userName,
      email,
      hashedPassword,
      salt,
      verifyCode,
      verifyCodeExpires,
      emailVerified: false,
    });
    await user.save();

    await sendVerifyMail(email, verifyCode);
    return c.json({ success: true });
  });

  /* ---------------------------- RESEND ---------------------------- */
  app.post("/resend", async (c) => {
    const { userName } = await c.req.json();
    if (typeof userName !== "string") {
      return c.json({ error: "invalid" }, 400);
    }

    const user = await HostUser.findOne({ userName });
    if (!user || user.emailVerified) {
      return c.json({ error: "invalid" }, 400);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    user.verifyCode = code;
    user.verifyCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();
    await sendVerifyMail(user.email, code);
    return c.json({ success: true });
  });

  /* ---------------------------- VERIFY ---------------------------- */
  app.post("/verify", async (c) => {
    const { userName, code } = await c.req.json();
    if (typeof userName !== "string" || typeof code !== "string") {
      return c.json({ error: "invalid1" }, 400);
    }

    const user = await HostUser.findOne({ userName });
    if (
      !user ||
      user.emailVerified ||
      user.verifyCode !== code ||
      !user.verifyCodeExpires ||
      user.verifyCodeExpires <= new Date()
    ) {
      return c.json({ error: "invalid2" }, 400);
    }

    user.emailVerified = true;
    user.verifyCode = undefined;
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
    if (!user) return c.json({ error: "invalid" }, 401);
    if (!user.emailVerified) return c.json({ error: "unverified" }, 403);

    const ok = await compare(password + user.salt, user.hashedPassword);
    if (!ok) return c.json({ error: "invalid" }, 401);

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    await new HostSession({ sessionId, user: user._id, expiresAt }).save();

    setCookie(c, "hostSessionId", sessionId, {
      httpOnly: true,
      secure: c.req.url.startsWith("https://"),
      expires: expiresAt,
      sameSite: "Lax",
      path: "/",
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
        httpOnly: true,
        secure: c.req.url.startsWith("https://"),
        expires: session.expiresAt,
        sameSite: "Lax",
        path: "/",
      });
      return c.json({
        login: true,
        user: session.user,
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

  const session = await HostSession.findOne({ sessionId: sid }).populate(
    "user",
  );
  if (!session || session.expiresAt <= new Date()) {
    if (session) await HostSession.deleteOne({ sessionId: sid });
    return c.json({ error: "unauthorized" }, 401);
  }

  // 期限延長
  session.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await session.save();

  setCookie(c, "hostSessionId", sid, {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: session.expiresAt,
    sameSite: "Lax",
    path: "/",
  });

  c.set("user", session.user);
  await next();
};
