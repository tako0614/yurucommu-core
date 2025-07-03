import { Hono } from "hono";
import Account from "./models/account.ts";
import type { Document } from "mongoose";

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const priv = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const pub = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  return {
    privateKey: bufferToBase64(priv),
    publicKey: bufferToBase64(pub),
  };
}

interface AccountDoc extends Document {
  userName: string;
  displayName: string;
  avatarInitial: string;
  privateKey: string;
  publicKey: string;
  followers: string[];
}

const app = new Hono();

app.get("/accounts", async (c) => {
  const list = await Account.find().lean<AccountDoc>();
  const formatted = list.map((doc) => ({
    id: doc._id.toString(),
    userName: doc.userName,
    displayName: doc.displayName,
    avatarInitial: doc.avatarInitial,
  }));
  return c.json(formatted);
});

app.post("/accounts", async (c) => {
  const { username, displayName, icon, privateKey, publicKey } = await c.req
    .json();
  const keys = privateKey && publicKey
    ? { privateKey, publicKey }
    : await generateKeyPair();
  const account = new Account({
    userName: username,
    displayName: displayName ?? username,
    avatarInitial: icon ?? username.charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
  });
  await account.save();
  return c.json({
    id: account._id.toString(),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
    publicKey: account.publicKey,
    followers: account.followers,
  });
});

app.get("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await Account.findById(id).lean<AccountDoc>();
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({
    id: account._id.toString(),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
    privateKey: account.privateKey,
    publicKey: account.publicKey,
    followers: account.followers,
  });
});

app.put("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const updates = await c.req.json();
  const data: Record<string, unknown> = {};
  if (updates.userName) data.userName = updates.userName;
  if (updates.displayName) data.displayName = updates.displayName;
  if (updates.avatarInitial !== undefined) {
    data.avatarInitial = updates.avatarInitial;
  }
  if (updates.privateKey) data.privateKey = updates.privateKey;
  if (updates.publicKey) data.publicKey = updates.publicKey;
  if (Array.isArray(updates.followers)) data.followers = updates.followers;

  const account = await Account.findByIdAndUpdate(id, data, { new: true });
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({
    id: account._id.toString(),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
    publicKey: account.publicKey,
    followers: account.followers,
  });
});

app.post("/accounts/:id/followers", async (c) => {
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const account = await Account.findByIdAndUpdate(
    id,
    { $addToSet: { followers: follower } },
    { new: true },
  );
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({ followers: account.followers });
});

app.delete("/accounts/:id/followers", async (c) => {
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const account = await Account.findByIdAndUpdate(
    id,
    { $pull: { followers: follower } },
    { new: true },
  );
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({ followers: account.followers });
});

app.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await Account.findByIdAndDelete(id);
  if (!account) return c.json({ error: "Account not found" }, 404);
  return c.json({ success: true });
});

export default app;
