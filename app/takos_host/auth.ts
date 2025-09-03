import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Context } from "hono";
import { compare, genSalt, hash as bcryptHash } from "npm:bcrypt";
import { sendVerifyMail } from "./mailer.ts";
import { createAuthMiddleware } from "@takos/auth";
import { createDB } from "@takos_host/db";
import type { HostDataStore } from "./db/types.ts";

/** bcrypt.hash をラチE�E�E�EaltRounds = 10�E�E*/
export async function hash(text: string): Promise<string> {
  const salt = await genSalt(10);
  return await bcryptHash(text, salt);
}

/** Cookie オプションを生成する�Eルパ�E */
export function createCookieOpts(c: Context, expires: Date) {
  return {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires,
    sameSite: "Lax" as const,
    path: "/",
  };
}

// DB は初期化頁E���E都合で遁E��生�Eする
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

  /* ------------------------- GOOGLE AUTH ------------------------- */
  function getGoogleEnv(c: Context) {
    const D = (globalThis as unknown as { Deno?: typeof Deno }).Deno;
    const headerId = c.req.header("x-google-client-id");
    const headerSecret = c.req.header("x-google-client-secret");
    const clientId = D?.env.get("GOOGLE_CLIENT_ID") ?? headerId ?? "";
    const clientSecret = D?.env.get("GOOGLE_CLIENT_SECRET") ?? headerSecret ??
      "";
    return { clientId, clientSecret };
  }

  function buildGoogleRedirectUri(c: Context): string {
    const u = new URL(c.req.url);
    u.pathname = "/auth/google/callback";
    u.search = "";
    u.hash = "";
    return u.toString();
  }

  app.get("/google/start", (c) => {
    const { clientId } = getGoogleEnv(c);
    const redirectUri = buildGoogleRedirectUri(c);
    if (!clientId) {
      return c.json({ error: "google_not_configured" }, 500);
    }
    const state = crypto.randomUUID();
    const scopes = ["openid", "email", "profile"].join(" ");
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("access_type", "online");
    authUrl.searchParams.set("include_granted_scopes", "true");

    // state を短朁ECookie に保存！E0 刁E��E
    const expires = new Date(Date.now() + 10 * 60 * 1000);
    setCookie(c, "g_state", state, createCookieOpts(c, expires));
    // 任意リダイレクト�E廁E��し、固定パスに統一

    return c.redirect(authUrl.toString());
  });

  app.get("/google/callback", async (c) => {
    const { clientId, clientSecret } = getGoogleEnv(c);
    const redirectUri = buildGoogleRedirectUri(c);
    const code = c.req.query("code") ?? "";
    const state = c.req.query("state") ?? "";
    const saved = getCookie(c, "g_state") ?? "";
    if (!clientId || !clientSecret) {
      return c.json({ error: "google_not_configured" }, 500);
    }
    if (!code || !state || !saved || state !== saved) {
      return c.json({ error: "invalid_state" }, 400);
    }

    // ト�Eクン交揁E
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!tokenRes.ok) {
      return c.json({ error: "token_exchange_failed" }, 400);
    }
    const tokenJson = await tokenRes.json() as {
      access_token?: string;
      id_token?: string;
    };
    const accessToken = tokenJson.access_token ?? "";
    if (!accessToken) return c.json({ error: "no_access_token" }, 400);

    // ユーザー惁E��取征E
    const userinfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!userinfoRes.ok) return c.json({ error: "userinfo_failed" }, 400);
    const profile = await userinfoRes.json() as {
      email?: string;
      email_verified?: boolean;
      name?: string;
      given_name?: string;
      family_name?: string;
      picture?: string;
      sub?: string;
    };
    const email = profile.email ?? "";
    if (!email) return c.json({ error: "no_email" }, 400);

    // ユーザー作�E or 取征E
    const baseName = email.split("@")[0].replace(/[^a-zA-Z0-9_\-\.]/g, "");
    // 重褁E��なぁEuserName を生戁E
    async function ensureUserName(): Promise<string> {
      let candidate = baseName ||
        `user_${Math.random().toString(36).slice(2, 8)}`;
      let n = 0;
      while (true) {
        const exists = await db().hostUsers.findByUserNameOrEmail(
          candidate,
          email,
        );
        if (!exists || exists.email === email) return candidate;
        n++;
        candidate = `${baseName}_${n}`;
      }
    }

    const exists = await db().hostUsers.findByUserNameOrEmail(email, email);
    let userId: string;
    if (exists) {
      // 既存ユーザーならメール検証を有効匁E
      await db().hostUsers.update(exists._id, {
        emailVerified: true,
        verifyCode: null,
        verifyCodeExpires: null,
      });
      userId = exists._id;
    } else {
      const userName = await ensureUserName();
      const salt = "-";
      const hashedPassword = "-";
      const created = await db().hostUsers.create({
        userName,
        email,
        hashedPassword,
        salt,
        verifyCode: "",
        verifyCodeExpires: new Date(),
        emailVerified: true,
      });
      userId = created._id;
    }

    // セチE��ョン発衁E
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
    await db().hostSessions.create({ sessionId, user: userId, expiresAt });
    setCookie(c, "hostSessionId", sessionId, createCookieOpts(c, expiresAt));

    // state クチE��ーの掁E��
    setCookie(c, "g_state", "", {
      ...createCookieOpts(c, new Date(0)),
      expires: new Date(0),
    });
    // リダイレクト（固定！E    return c.redirect("/user");
  });

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
