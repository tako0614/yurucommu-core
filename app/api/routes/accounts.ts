import { Hono } from "hono";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { generateKeyPair } from "../../shared/crypto.ts";
import type { AccountDoc } from "../../shared/types.ts";
import { b64ToBuf } from "../../shared/buffer.ts";
import { isUrl } from "../../shared/url.ts";
import { saveFile } from "../services/file.ts";
import { announceIfPublicAndDiscoverable } from "../services/fasp.ts";

function formatAccount(doc: AccountDoc) {
  return {
    id: String(doc._id),
    userName: doc.userName,
    displayName: doc.displayName,
    avatarInitial: doc.avatarInitial,
    publicKey: doc.publicKey,
    followers: doc.followers,
    following: doc.following,
  };
}

// 画像データURLやURL文字列を処理して保存し、URLまたはイニシャルを返す
async function resolveAvatar(
  value: unknown,
  env: Record<string, string>,
  name: string,
): Promise<string> {
  if (typeof value === "string") {
    const trimmed = value.trim();
    // data URL の場合はファイルとして保存する
    if (trimmed.startsWith("data:image/")) {
      const match = trimmed.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        const [, type, data] = match;
        const bytes = b64ToBuf(data);
        const ext = type.split("/")[1]?.split("+")[0];
        const saved = await saveFile(bytes, env, {
          mediaType: type,
          ext: ext ? `.${ext}` : ".png",
        });
        return saved.url;
      }
    }
    // 既にURLで渡された場合はそのまま利用
    if (isUrl(trimmed) || trimmed.startsWith("/")) return trimmed;
  }
  // 画像が指定されない場合はデフォルトのプレースホルダーエンドポイントを返す
  // 固定サイズのプレースホルダー（必要に応じてクライアントでサイズを指定）
  return "/api/placeholder/128/128";
}

const app = new Hono();
app.use("/accounts/*", authRequired);

app.get("/accounts", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const list = await db.listAccounts();
  const formatted = list.map((doc) => formatAccount(doc));
  return jsonResponse(c, formatted);
});

app.post("/accounts", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const { username, displayName, icon, privateKey, publicKey } = await c.req
    .json();

  // userName is required and cannot be changed after creation
  if (!username || typeof username !== "string" || username.trim() === "") {
    return jsonResponse(c, {
      error: "Username is required and cannot be empty",
    }, 400);
  }

  if (username.trim() === "system") {
    return jsonResponse(c, { error: "このユーザー名は使用できません" }, 400);
  }

  // Check if username already exists
  const db = createDB(env);
  const existingAccount = await db.findAccountByUserName(username.trim());
  if (existingAccount) {
    return jsonResponse(c, { error: "Username already exists" }, 409);
  }

  const keys = privateKey && publicKey
    ? { privateKey, publicKey }
    : await generateKeyPair();
  const account = await db.createAccount({
    userName: username.trim(),
    displayName: displayName ?? username.trim(),
    avatarInitial: await resolveAvatar(
      icon,
      env,
      (displayName ?? username).trim(),
    ),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });
  await announceIfPublicAndDiscoverable(env, {
    category: "account",
    eventType: "new",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account);
  return jsonResponse(c, formatAccount(account));
});

app.get("/accounts/:id", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, {
    ...formatAccount(account),
    privateKey: account.privateKey,
  });
});

app.put("/accounts/:id", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const updates = await c.req.json();
  const orig = await db.findAccountById(id);
  if (!orig) return jsonResponse(c, { error: "Account not found" }, 404);

  const data: Record<string, unknown> = {};
  // userName is immutable after creation - removed from update logic
  if (updates.displayName) data.displayName = updates.displayName;
  if (updates.avatarInitial !== undefined) {
    const base = updates.displayName ?? orig.displayName ?? orig.userName;
    data.avatarInitial = await resolveAvatar(updates.avatarInitial, env, base);
  } else if (updates.displayName) {
    const cur = orig.avatarInitial;
    // 現在の値がデータURL/URL/パスでない場合はデフォルトのエンドポイントに揃える
    if (!cur || (!cur.startsWith("data:image/") && !isUrl(cur) && !cur.startsWith("/"))) {
      data.avatarInitial = "/api/placeholder/128/128";
    }
  }
  if (updates.privateKey) data.privateKey = updates.privateKey;
  if (updates.publicKey) data.publicKey = updates.publicKey;
  if (Array.isArray(updates.followers)) data.followers = updates.followers;
  if (Array.isArray(updates.following)) data.following = updates.following;

  const account = await db.updateAccountById(id, data);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  await announceIfPublicAndDiscoverable(env, {
    category: "account",
    eventType: "update",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account);
  return jsonResponse(c, formatAccount(account));
});

app.delete("/accounts/:id", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const deleted = await db.deleteAccountById(id);
  if (!deleted) return jsonResponse(c, { error: "Account not found" }, 404);
  await announceIfPublicAndDiscoverable(env, {
    category: "account",
    eventType: "delete",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account);
  return jsonResponse(c, { success: true });
});

export default app;
