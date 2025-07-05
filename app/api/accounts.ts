import { Hono } from "hono";
import Account from "./models/account.ts";
import type { Document } from "mongoose";
import { deliverActivityPubObject } from "./utils/activitypub.ts";
import { env } from "./utils/env.ts";

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bufferToPem(
  buffer: ArrayBuffer,
  type: "PUBLIC KEY" | "PRIVATE KEY",
): string {
  const b64 = bufferToBase64(buffer);
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
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
    privateKey: bufferToPem(priv, "PRIVATE KEY"),
    publicKey: bufferToPem(pub, "PUBLIC KEY"),
  };
}

interface AccountDoc extends Document {
  userName: string;
  displayName: string;
  avatarInitial: string;
  privateKey: string;
  publicKey: string;
  followers: string[];
  following: string[];
}

const app = new Hono();

function getDomain(c: any) {
  return env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
}

function jsonResponse(c: any, data: any, status = 200, contentType = "application/json") {
  return c.body(JSON.stringify(data), status, {
    "content-type": contentType
  });
}

app.get("/accounts", async (c) => {
  const list = await Account.find().lean<AccountDoc[]>();
  const formatted = list.map((doc: AccountDoc) => ({
    id: String(doc._id),
    userName: doc.userName,
    displayName: doc.displayName,
    avatarInitial: doc.avatarInitial,
  }));
  return jsonResponse(c, formatted);
});

app.post("/accounts", async (c) => {
  const { username, displayName, icon, privateKey, publicKey } = await c.req
    .json();
  
  // userName is required and cannot be changed after creation
  if (!username || typeof username !== "string" || username.trim() === "") {
    return jsonResponse(c, { error: "Username is required and cannot be empty" }, 400);
  }
  
  // Check if username already exists
  const existingAccount = await Account.findOne({ userName: username.trim() });
  if (existingAccount) {
    return jsonResponse(c, { error: "Username already exists" }, 409);
  }
  
  const keys = privateKey && publicKey
    ? { privateKey, publicKey }
    : await generateKeyPair();
  const account = new Account({
    userName: username.trim(),
    displayName: displayName ?? username.trim(),
    avatarInitial: icon ?? username.trim().charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });
  await account.save();
  return jsonResponse(c, {
    id: String(account._id),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
    publicKey: account.publicKey,
    followers: account.followers,
    following: account.following,
  });
});

app.get("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await Account.findById(id).lean<AccountDoc>();
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, {
    id: String(account._id),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
    privateKey: account.privateKey,
    publicKey: account.publicKey,
    followers: account.followers,
    following: account.following,
  });
});

app.put("/accounts/:id", async (c) => {
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

  const account = await Account.findByIdAndUpdate(id, data, { new: true });
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, {
    id: String(account._id),
    userName: account.userName,
    displayName: account.displayName,
    avatarInitial: account.avatarInitial,
    publicKey: account.publicKey,
    followers: account.followers,
    following: account.following,
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
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { followers: account.followers });
});

app.delete("/accounts/:id/followers", async (c) => {
  const id = c.req.param("id");
  const { follower } = await c.req.json();
  const account = await Account.findByIdAndUpdate(
    id,
    { $pull: { followers: follower } },
    { new: true },
  );
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { followers: account.followers });
});

app.post("/accounts/:id/following", async (c) => {
  const id = c.req.param("id");
  const { target } = await c.req.json();
  const account = await Account.findByIdAndUpdate(
    id,
    { $addToSet: { following: target } },
    { new: true },
  );
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { following: account.following });
});

app.get("/accounts/:id/following", async (c) => {
  const id = c.req.param("id");
  const account = await Account.findById(id).lean<AccountDoc>();
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { following: account.following });
});

app.delete("/accounts/:id/following", async (c) => {
  const id = c.req.param("id");
  const { target } = await c.req.json();
  const account = await Account.findByIdAndUpdate(
    id,
    { $pull: { following: target } },
    { new: true },
  );
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { following: account.following });
});

app.post("/accounts/:id/follow", async (c) => {
  const id = c.req.param("id");
  const { target, userName } = await c.req.json();
  if (typeof target !== "string" || typeof userName !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const account = await Account.findByIdAndUpdate(
    id,
    { $addToSet: { following: target } },
    { new: true },
  );
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);

  try {
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
    const actorId = `https://${domain}/users/${userName}`;
    const targetUrl = new URL(target);
    if (targetUrl.host === domain && targetUrl.pathname.startsWith("/users/")) {
      const username = targetUrl.pathname.split("/")[2];
      await Account.updateOne({ userName: username }, {
        $addToSet: { followers: actorId },
      });
    } else {
      const res = await fetch(target, {
        headers: { accept: "application/activity+json" },
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.inbox === "string") {
          const follow = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `https://${domain}/activities/${crypto.randomUUID()}`,
            type: "Follow",
            actor: actorId,
            object: target,
          };
          deliverActivityPubObject([data.inbox], follow, userName)
            .catch((err) => console.error("Delivery failed:", err));
        }
      }
    }
  } catch (err) {
    console.error("Follow request failed:", err);
  }

  return jsonResponse(c, { following: account.following });
});

app.delete("/accounts/:id/follow", async (c) => {
  const id = c.req.param("id");
  const { target } = await c.req.json();
  if (typeof target !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const account = await Account.findByIdAndUpdate(
    id,
    { $pull: { following: target } },
    { new: true },
  );
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);

  try {
    const domain = env["ACTIVITYPUB_DOMAIN"] ?? new URL(c.req.url).host;
    const actorId = `https://${domain}/users/${account.userName}`;
    const targetUrl = new URL(target);
    if (targetUrl.host === domain && targetUrl.pathname.startsWith("/users/")) {
      const username = targetUrl.pathname.split("/")[2];
      await Account.updateOne({ userName: username }, {
        $pull: { followers: actorId },
      });
    } else {
      const res = await fetch(target, {
        headers: { accept: "application/activity+json" },
      });
      if (res.ok) {
        const data = await res.json();
        if (typeof data.inbox === "string") {
          const undo = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: `https://${domain}/activities/${crypto.randomUUID()}`,
            type: "Undo",
            actor: actorId,
            object: {
              type: "Follow",
              actor: actorId,
              object: target,
            },
          };
          deliverActivityPubObject([data.inbox], undo, account.userName).catch((
            err,
          ) => console.error("Delivery failed:", err));
        }
      }
    }
  } catch (err) {
    console.error("Unfollow request failed:", err);
  }

  return jsonResponse(c, { following: account.following });
});

app.delete("/accounts/:id", async (c) => {
  const id = c.req.param("id");
  const account = await Account.findByIdAndDelete(id);
  if (!account) return jsonResponse(c, { error: "Account not found" }, 404);
  return jsonResponse(c, { success: true });
});

export default app;
