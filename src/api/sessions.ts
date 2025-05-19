import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { Session } from "./models/sessions.ts";
import { verifyPassword } from "./utils/crypto.ts";
import { Env } from "./index.ts";

const app = new Hono<{ Bindings: Env }>();

// 認証関連のエンドポイント
app.post("/api/login", async (c) => {
  try {
    console.log(c.env);
    const body = await c.req.json();
    // バリデーション
    if (!body.password || typeof body.password !== "string") {
      return c.json({
        success: false,
        error: "有効なパスワードを入力してください",
      }, 400);
    }

    // パスワード検証
    const isValid = await verifyPassword(
      body.password,
      c.env.hashedPassword,
      c.env.salt,
    );

    if (isValid) {
      // セッション作成
      const sessionToken = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1時間後

      await Session.create({
        token: sessionToken,
        expiresAt: expiresAt,
      });

      // Cookieの設定
      setCookie(c, "session_token", sessionToken, {
        httpOnly: true,
        sameSite: "Lax",
        expires: expiresAt,
      });

      return c.json({ success: true, message: "ログインに成功しました" });
    } else {
      return c.json(
        { success: false, error: "パスワードが正しくありません" },
        401,
      );
    }
  } catch (error) {
    console.error("Login error:", error);
    return c.json({
      success: false,
      error: "リクエスト処理中にエラーが発生しました",
    }, 500);
  }
});

app.get("/api/logout", async (c) => {
  const sessionToken = getCookie(c, "session_token");
  if (sessionToken) {
    await Session.deleteOne({ token: sessionToken });
    setCookie(c, "session_token", "", { maxAge: 0, path: "/" });
  }
  return c.json({ success: true, message: "ログアウトしました" });
});

// ステータス関連のエンドポイント
app.get("/api/health", (c) => {
  return c.json({ success: true, message: "ok" });
});

app.get("/api/status", async (c) => {
  const sessionToken = getCookie(c, "session_token");
  if (!sessionToken) {
    return c.json({ login: false });
  }

  const session = await Session.findOne({ token: sessionToken });
  return c.json({ login: !!session });
});

export default app;
