import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { compare, genSalt, hash as bcryptHash } from "bcrypt";
import { sendVerifyMail } from "./mailer.ts";
import { createAuthMiddleware } from "@takos/auth";
import { createDB } from "@takos_host/db";
import type { HostDataStore } from "./db/types.ts";

/** bcrypt.hash をラップ（saltRounds = 10） */
export async function hash(text: string): Promise<string> {
  const salt = await genSalt(10);
  return await bcryptHash(text, salt);
}

/** Cookie オプションを生成するヘルパー */
export function createCookieOpts(c: Context, expires: Date) {
  return {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires,
    sameSite: "Lax" as const,
    path: "/",
  };
}

// DB は初期化順序の都合で遅延生成する
let dbInst: HostDataStore | null = null;
function db(): HostDataStore {
  if (!dbInst) dbInst = createDB({}) as HostDataStore;
  return dbInst;
}

export function createAuthApp(options?: {
  rootDomain?: string;
  termsRequired?: boolean;
}) {
  const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

    const exists = await db().hostUsers.findByUserNameOrEmail(userName, email);
    if (exists) {
      if (exists.emailVerified) return c.json({ error: "exists" }, 400);

      const newSalt = crypto.randomUUID();
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      await db().hostUsers.update(exists._id, {
        userName,
        email,
        salt: newSalt,
        hashedPassword: await hash(password + newSalt),
        verifyCode: newCode,
        verifyCodeExpires: new Date(Date.now() + 10 * 60 * 1000),
      });
      await sendVerifyMail(email, newCode);
      return c.json({ success: true });
    }

    const salt = crypto.randomUUID();
    const hashedPassword = await hash(password + salt);
    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verifyCodeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await db().hostUsers.create({
      userName,
      email,
      hashedPassword,
      salt,
      verifyCode,
      verifyCodeExpires,
      emailVerified: false,
    });

    await sendVerifyMail(email, verifyCode);
    return c.json({ success: true });
  });

  /* ---------------------------- RESEND ---------------------------- */
  app.post("/resend", async (c) => {
    const { userName } = await c.req.json();
    if (typeof userName !== "string") {
      return c.json({ error: "invalid" }, 400);
    }

    const user = await db().hostUsers.findByUserName(userName);
    if (!user || user.emailVerified) {
      return c.json({ error: "invalid" }, 400);
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await db().hostUsers.update(user._id, {
      verifyCode: code,
      verifyCodeExpires: new Date(Date.now() + 10 * 60 * 1000),
    });
    await sendVerifyMail(user.email, code);
    return c.json({ success: true });
  });

  /* ---------------------------- VERIFY ---------------------------- */
  app.post("/verify", async (c) => {
    const { userName, code } = await c.req.json();
    if (typeof userName !== "string" || typeof code !== "string") {
      return c.json({ error: "invalid1" }, 400);
    }

    const user = await db().hostUsers.findByUserName(userName);
    if (
      !user ||
      user.emailVerified ||
      user.verifyCode !== code ||
      !user.verifyCodeExpires ||
      user.verifyCodeExpires <= new Date()
    ) {
      return c.json({ error: "invalid2" }, 400);
    }

    await db().hostUsers.update(user._id, {
      emailVerified: true,
      verifyCode: null,
      verifyCodeExpires: null,
    });

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await db().hostSessions.create({ sessionId, user: user._id, expiresAt });

    setCookie(c, "hostSessionId", sessionId, createCookieOpts(c, expiresAt));

    return c.json({ success: true });
  });

  /* ----------------------------- LOGIN ---------------------------- */
  app.post("/login", async (c) => {
    const { userName, password } = await c.req.json();
    if (typeof userName !== "string" || typeof password !== "string") {
      return c.json({ error: "invalid" }, 400);
    }

    const user = await db().hostUsers.findByUserName(userName);
    if (!user) return c.json({ error: "invalid" }, 401);
    if (!user.emailVerified) return c.json({ error: "unverified" }, 403);

    const ok = await compare(password + user.salt, user.hashedPassword);
    if (!ok) return c.json({ error: "invalid" }, 401);

    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await db().hostSessions.create({ sessionId, user: user._id, expiresAt });

    setCookie(c, "hostSessionId", sessionId, createCookieOpts(c, expiresAt));

    return c.json({ success: true });
  });

  /* --------------------------- STATUS ----------------------------- */
  app.get("/status", async (c) => {
    const sid = getCookie(c, "hostSessionId");
    if (!sid) return c.json({ login: false, rootDomain, termsRequired });

    const session = await db().hostSessions.findById(sid);
    if (session && session.expiresAt > new Date()) {
      const newExpires = new Date(Date.now() + SESSION_LIFETIME_MS);
      await db().hostSessions.update(sid, { expiresAt: newExpires });
      setCookie(
        c,
        "hostSessionId",
        sid,
        createCookieOpts(c, newExpires),
      );
      return c.json({
        login: true,
        user: session.user,
        rootDomain,
        termsRequired,
      });
    }

    if (session) await db().hostSessions.delete(sid);
    return c.json({ login: false, rootDomain, termsRequired });
  });

  /* ---------------------------- LOGOUT ---------------------------- */
  app.delete("/logout", async (c) => {
    const sid = getCookie(c, "hostSessionId");
    if (sid) {
      await db().hostSessions.delete(sid);
      deleteCookie(c, "hostSessionId", { path: "/" });
    }
    return c.json({ success: true });
  });

  return app;
}

/* --------------- Auth-required middleware ---------------- */
export const authRequired: MiddlewareHandler = createAuthMiddleware({
  cookieName: "hostSessionId",
  errorMessage: "unauthorized",
  findSession: async (sid) => {
    const session = await db().hostSessions.findById(sid);
    return session;
  },
  deleteSession: async (sid) => {
    await db().hostSessions.delete(sid);
  },
  updateSession: async (session, expires) => {
    await db().hostSessions.update(
      (session as { sessionId: string }).sessionId,
      { expiresAt: expires },
    );
  },
  attach: (c, session) => {
    c.set("user", { _id: (session as { user: string }).user });
  },
});
