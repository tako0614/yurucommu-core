import { Hono } from "hono";
import { getDB } from "../db/mod.ts";
import { generateKeyPair } from "@takos/crypto";
import authRequired from "../utils/auth.ts";

const app = new Hono();

// 初回オンボーディングの表示可否は「アカウントが存在するか」で判定する
app.get("/onboarding/status", async (c) => {
  const db = getDB(c);
  const list = await db.accounts.list();
  const configured = (list?.length ?? 0) > 0;
  return c.json({ configured });
});

// /api/setup POSTエンドポイント
// オンボーディングは「初回のアカウント作成と初期フォロー設定」を担う用途。
// すでにログイン済みであることを前提とし、env の生成/更新は行わない。
app.post("/onboarding", authRequired, async (c) => {
  const db = getDB(c);
  const { username, displayName, follow } = await c.req.json();

    if (!username || typeof username !== "string") {
      return c.json({ error: "invalid_parameters" }, 400);
    }
    const name = String(username).trim();
    if (!/^[-_a-zA-Z0-9]{3,32}$/.test(name) || name === "system") {
      return c.json({ error: "invalid_username" }, 400);
    }

  // 既存ユーザー名チェック（重複防止）
  const exists = await db.accounts.findByUserName(name);
    if (exists) {
      return c.json({ error: "username_exists" }, 409);
    }

    const keys = await generateKeyPair();
    const account = await db.accounts.create({
      userName: name,
      displayName: (displayName && String(displayName).trim()) || name,
      avatarInitial: name.charAt(0).toUpperCase().substring(0, 2),
      privateKey: keys.privateKey,
      publicKey: keys.publicKey,
      followers: [],
      following: [],
    });

    // 初期フォロー（URL/Acct/ローカル名を許容）
    // ここでは DB 上の following のみ更新（AP配達は行わない）
    if (Array.isArray(follow)) {
      for (const target of follow) {
        try {
          await db.accounts.addFollowing(String(account._id), String(target));
        } catch (_e) {
          // 個別のフォロー失敗は握りつぶす（セットアップ全体は継続）
        }
      }
    }

  return c.json({ success: true });
});

export default app;
