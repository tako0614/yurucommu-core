import { Hono } from "hono";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { generateKeyPair } from "../../shared/crypto.ts";
import type { AccountDoc } from "../../shared/types.ts";
import { isUrl } from "../../shared/url.ts";
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

function isFilesUrl(url: string): boolean {
  if (!isUrl(url)) return false;
  try {
    const u = new URL(url);
    return u.pathname.startsWith("/api/files/");
  } catch {
    return false;
  }
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
  let avatar = "/api/image/people.png";
  if (icon !== undefined) {
    if (typeof icon === "string" && isFilesUrl(icon)) {
      avatar = icon.trim();
    } else {
      return jsonResponse(c, {
        error: "icon は /api/files で取得した URL を指定してください",
      }, 400);
    }
  }
  const account = await db.createAccount({
    userName: username.trim(),
    displayName: displayName ?? username.trim(),
    avatarInitial: avatar,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });
  await announceIfPublicAndDiscoverable(env, {
    category: "account",
    eventType: "new",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account as unknown as Record<string, unknown>);
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
    if (
      typeof updates.avatarInitial === "string" &&
      isFilesUrl(updates.avatarInitial)
    ) {
      data.avatarInitial = updates.avatarInitial.trim();
    } else {
      return jsonResponse(c, {
        error: "avatarInitial は /api/files で取得した URL を指定してください",
      }, 400);
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
  }, account as unknown as Record<string, unknown>);
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
  }, account as unknown as Record<string, unknown>);
  return jsonResponse(c, { success: true });
});

export default app;
