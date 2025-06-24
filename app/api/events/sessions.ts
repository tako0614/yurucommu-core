import { z } from "zod";
import { eventManager } from "../eventManager.ts";
import { verifyPassword } from "../utils/crypto.ts";
import { Session } from "../models/sessions.ts";
import { getCookie, setCookie } from "hono/cookie";

// ログイン
eventManager.add(
  "takos",
  "sessions:login",
  z.object({ password: z.string() }),
  async (c, payload) => {
    const isValid = await verifyPassword(
      payload.password,
      c.env.hashedPassword,
      c.env.salt,
    );

    if (!isValid) {
      throw new Error("パスワードが正しくありません");
    }

    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await Session.create({ token: sessionToken, expiresAt });
    setCookie(c, "session_token", sessionToken, {
      httpOnly: true,
      sameSite: "Lax",
      expires: expiresAt,
    });
    return { message: "ログインに成功しました" };
  },
);

// ログアウト
eventManager.add(
  "takos",
  "sessions:logout",
  z.unknown(),
  async (c, _payload) => {
    const sessionToken = getCookie(c, "session_token");
    if (sessionToken) {
      await Session.deleteOne({ token: sessionToken });
      setCookie(c, "session_token", "", { maxAge: 0, path: "/" });
    }
    return { message: "ログアウトしました" };
  },
);

// ステータス
eventManager.add(
  "takos",
  "sessions:status",
  z.unknown(),
  async (c, _payload) => {
    const sessionToken = getCookie(c, "session_token");
    if (!sessionToken) return { login: false };
    const session = await Session.findOne({ token: sessionToken });
    return { login: !!session };
  },
);
