import { Hono } from "hono";
import { getDomain, jsonResponse } from "../utils/activitypub.ts";
import authRequired from "../utils/auth.ts";
import { createDB } from "../DB/mod.ts";
import { getEnv } from "../../shared/config.ts";
import { generateKeyPair } from "../../shared/crypto.ts";
import type { AccountDoc } from "../../shared/types.ts";

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
    avatarInitial: icon ??
      username.trim().charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });
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
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const updates = await c.req.json();
  const data: Record<string, unknown> = {};
  // userName is immutable after creation - removed from update logic
  if (updates.displayName) data.displayName = updates.displayName;
  if (updates.avatarInitial !== undefined) {
    data.avatarInitial = updates.avatarInitial;
  }
  if (updates.privateKey) data.privateKey = updates.privateKey;
  if (updates.publicKey) data.publicKey = updates.publicKey;
  if (Array.isArray(updates.followers)) data.followers = updates.followers;
  if (Array.isArray(updates.following)) data.following = updates.following;

  const account = await db.updateAccountById(id, data);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, formatAccount(account));
});

app.post("/accounts/:id/followers", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const exists = await db.findAccountById(id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const domain = getDomain(c);
  const selfActor = `https://${domain}/users/${exists.userName}`;
  if (follower === exists.userName || follower === selfActor) {
    return jsonResponse(c, { error: "Cannot follow yourself" }, 400);
  }
  const followers = await db.addFollower(id, follower);
  return jsonResponse(c, { followers });
});

app.delete("/accounts/:id/followers", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const exists = await db.findAccountById(id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const followers = await db.removeFollower(id, follower);
  return jsonResponse(c, { followers });
});

app.post("/accounts/:id/following", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const { target } = await c.req.json();
  const exists = await db.findAccountById(id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const domain = getDomain(c);
  const selfActor = `https://${domain}/users/${exists.userName}`;
  if (target === exists.userName || target === selfActor) {
    return jsonResponse(c, { error: "Cannot follow yourself" }, 400);
  }
  const following = await db.addFollowing(id, target);
  return jsonResponse(c, { following });
});

app.get("/accounts/:id/following", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const account = await db.findAccountById(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { following: account.following });
});

app.delete("/accounts/:id/following", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const { target } = await c.req.json();
  const exists = await db.findAccountById(id);
  if (!exists) return jsonResponse(c, { error: "Account not found" }, 404);
  const following = await db.removeFollowing(id, target);
  return jsonResponse(c, { following });
});

app.delete("/accounts/:id", async (c) => {
  const env = getEnv(c);
  const db = createDB(env);
  const id = c.req.param("id");
  const deleted = await db.deleteAccountById(id);
  if (!deleted) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { success: true });
});

export default app;
