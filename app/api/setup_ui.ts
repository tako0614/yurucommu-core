import { Hono } from "hono";
import { load, stringify } from "jsr:@std/dotenv";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { join } from "jsr:@std/path";
import Account from "./models/account.ts";
import { addFollowEdge } from "./services/unified_store.ts";
import { getEnv } from "./utils/env_store.ts";
import authRequired from "./utils/auth.ts";

const app = new Hono();
app.use("/setup", authRequired);
app.use("/setup/*", authRequired);

app.get("/setup/status", (c) => {
  const env = getEnv(c);
  const configured = Boolean(env["hashedPassword"] && env["salt"]);
  return c.json({ configured });
});

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bufferToPem(buffer: ArrayBuffer, type: "PRIVATE KEY" | "PUBLIC KEY") {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const priv = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pub = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKey: bufferToPem(priv, "PRIVATE KEY"),
    publicKey: bufferToPem(pub, "PUBLIC KEY"),
  };
}

app.post("/setup", async (c) => {
  const env = getEnv(c);
  if (env["hashedPassword"] && env["salt"]) {
    return c.json({ error: "already_configured" }, 400);
  }
  const { password, username, displayName, follow } = await c.req.json();
  if (!password || !username) {
    return c.json({ error: "invalid_parameters" }, 400);
  }

  const salt = crypto.randomUUID().replace(/-/g, "");
  const hashed = await sha256Hex(password + salt);
  env.hashedPassword = hashed;
  env.salt = salt;

  const envPath = join("app", "api", ".env");
  await ensureFile(envPath);
  const fileEnv = await load({ envPath });
  fileEnv.hashedPassword = hashed;
  fileEnv.salt = salt;
  await Deno.writeTextFile(envPath, stringify(fileEnv));

  const keys = await generateKeyPair();
  const account = new Account({
    userName: username,
    displayName: displayName || username,
    avatarInitial: username.charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: Array.isArray(follow) ? follow : [],
    tenant_id: env["ACTIVITYPUB_DOMAIN"] ?? "",
  });
  (account as unknown as { $locals?: { env?: Record<string, string> } })
    .$locals = {
      env,
    };
  await account.save();

  if (Array.isArray(follow)) {
    for (const actor of follow) {
      await addFollowEdge(env["ACTIVITYPUB_DOMAIN"] ?? "", actor);
    }
  }

  return c.json({ success: true });
});

export default app;
