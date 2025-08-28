import { Hono } from "hono";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import { getDB } from "../db/mod.ts";
import { getEnv } from "@takos/config";
import { generateKeyPair } from "@takos/crypto";
import type { AccountDoc } from "@takos/types";
import { isUrl } from "@takos/url";
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
  const db = getDB(c);
  const list = await db.accounts.list();
  // exclude internal system account from API results
  const filtered = list.filter((doc: AccountDoc) => doc.userName !== "system");
  const formatted = filtered.map((doc: AccountDoc) => formatAccount(doc));
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
  const db = getDB(c);
  const existingAccount = await db.accounts.findByUserName(username.trim());
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
  const account = await db.accounts.create({
    userName: username.trim(),
    displayName: displayName ?? username.trim(),
    avatarInitial: avatar,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });
  await announceIfPublicAndDiscoverable(env, domain, {
    category: "account",
    eventType: "new",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account as unknown as Record<string, unknown>);
  return jsonResponse(c, formatAccount(account));
});

app.get("/accounts/:id", async (c) => {
  const db = getDB(c);
  const id = c.req.param("id");
  const account = await db.accounts.findById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, {
    ...formatAccount(account),
    privateKey: account.privateKey,
  });
});

app.put("/accounts/:id", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = getDB(c);
  const id = c.req.param("id");
  const updates = await c.req.json();
  const orig = await db.accounts.findById(id);
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

  const account = await db.accounts.updateById(id, data);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  await announceIfPublicAndDiscoverable(env, domain, {
    category: "account",
    eventType: "update",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account as unknown as Record<string, unknown>);
  return jsonResponse(c, formatAccount(account));
});

app.delete("/accounts/:id", async (c) => {
  const domain = getDomain(c);
  const env = getEnv(c);
  const db = getDB(c);
  const id = c.req.param("id");
  const account = await db.accounts.findById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  const deleted = await db.accounts.deleteById(id);
  if (!deleted) return jsonResponse(c, { error: "Account not found" }, 404);
  await announceIfPublicAndDiscoverable(env, domain, {
    category: "account",
    eventType: "delete",
    objectUris: [`https://${domain}/users/${account.userName}`],
  }, account as unknown as Record<string, unknown>);
  return jsonResponse(c, { success: true });
});

export default app;
