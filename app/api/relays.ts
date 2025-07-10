import { Hono } from "hono";
import Relay from "./models/relay.ts";
import Account from "./models/account.ts";
import authRequired from "./utils/auth.ts";
import {
  createFollowActivity,
  createUndoFollowActivity,
  getDomain,
  jsonResponse,
  sendActivityPubObject,
} from "./utils/activitypub.ts";

function bufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function bufferToPem(buffer: ArrayBuffer, type: "PUBLIC KEY" | "PRIVATE KEY") {
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

const app = new Hono();
app.use("*", authRequired);

app.get("/relays", async (c) => {
  const list = await Relay.find().lean<{ _id: unknown; inboxUrl: string }[]>();
  const relays = list.map((r) => ({ id: String(r._id), inboxUrl: r.inboxUrl }));
  return jsonResponse(c, { relays });
});

app.post("/relays", async (c) => {
  const { inboxUrl } = await c.req.json();
  if (!inboxUrl || typeof inboxUrl !== "string") {
    return jsonResponse(c, { error: "Invalid body" }, 400);
  }
  const exists = await Relay.findOne({ inboxUrl });
  if (exists) return jsonResponse(c, { error: "Already exists" }, 409);
  const relay = new Relay({ inboxUrl });
  await relay.save();
  try {
    let account = await Account.findOne({ userName: "system" });
    if (!account) {
      const keys = await generateKeyPair();
      account = new Account({
        userName: "system",
        displayName: "system",
        avatarInitial: "S",
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        followers: [],
        following: [],
      });
      await account.save();
    }
    const domain = getDomain(c);
    const actorId = `https://${domain}/users/system`;
    const target = "https://www.w3.org/ns/activitystreams#Public";
    const follow = createFollowActivity(domain, actorId, target);
    await sendActivityPubObject(inboxUrl, follow, "system");
  } catch (err) {
    console.error("Failed to follow relay:", err);
  }
  return jsonResponse(c, { id: String(relay._id), inboxUrl: relay.inboxUrl });
});

app.delete("/relays/:id", async (c) => {
  const id = c.req.param("id");
  const relay = await Relay.findByIdAndDelete(id);
  if (!relay) return jsonResponse(c, { error: "Relay not found" }, 404);
  try {
    let account = await Account.findOne({ userName: "system" });
    if (!account) {
      const keys = await generateKeyPair();
      account = new Account({
        userName: "system",
        displayName: "system",
        avatarInitial: "S",
        privateKey: keys.privateKey,
        publicKey: keys.publicKey,
        followers: [],
        following: [],
      });
      await account.save();
    }
    const domain = getDomain(c);
    const actorId = `https://${domain}/users/system`;
    const target = "https://www.w3.org/ns/activitystreams#Public";
    const undo = createUndoFollowActivity(domain, actorId, target);
    await sendActivityPubObject(relay.inboxUrl, undo, "system");
  } catch (err) {
    console.error("Failed to undo follow relay:", err);
  }
  return jsonResponse(c, { success: true });
});

export default app;
