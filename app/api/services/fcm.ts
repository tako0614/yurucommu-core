import { createDB } from "../DB/mod.ts";
import type { DB } from "../../shared/db.ts";

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function encodeBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

interface TokenCache {
  token: string;
  exp: number;
}

let cache: TokenCache | null = null;

async function getAccessToken(
  env: Record<string, string>,
): Promise<string | null> {
  const required = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ];
  if (!required.every((k) => env[k])) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cache && cache.exp > now + 60) return cache.token;
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: env["FIREBASE_CLIENT_EMAIL"],
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const te = new TextEncoder();
  const segments = [
    encodeBase64Url(te.encode(JSON.stringify(header))),
    encodeBase64Url(te.encode(JSON.stringify(claim))),
  ];
  const data = segments.join(".");
  const keyData = pemToArrayBuffer(
    env["FIREBASE_PRIVATE_KEY"].replace(/\n/g, "\n"),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    te.encode(data),
  );
  const jwt = `${data}.${encodeBase64Url(sig)}`;
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body,
  });
  if (!res.ok) {
    console.error("Failed to get FCM token", await res.text());
    return null;
  }
  const json = await res.json();
  cache = { token: json.access_token, exp: now + json.expires_in };
  return cache.token;
}

export async function registerToken(
  token: string,
  userName: string,
  env: Record<string, string>,
  dbInst?: DB,
) {
  const db = dbInst ?? createDB(env);
  const collection = (await db.getDatabase()).collection("fcmtokens");
  await collection.updateOne(
    env["DB_MODE"] === "host"
      ? { token, tenant_id: env["ACTIVITYPUB_DOMAIN"] }
      : { token },
    { $set: { token, userName } },
    { upsert: true },
  );
}

export async function unregisterToken(
  token: string,
  env: Record<string, string>,
  dbInst?: DB,
) {
  const db = dbInst ?? createDB(env);
  const collection = (await db.getDatabase()).collection("fcmtokens");
  const cond = env["DB_MODE"] === "host"
    ? { token, tenant_id: env["ACTIVITYPUB_DOMAIN"] }
    : { token };
  await collection.deleteOne(cond);
}

export async function sendNotification(
  title: string,
  body: string,
  env: Record<string, string>,
  dbInst?: DB,
) {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return;
  const db = dbInst ?? createDB(env);
  const collection = (await db.getDatabase()).collection("fcmtokens");
  const cond = env["DB_MODE"] === "host"
    ? { tenant_id: env["ACTIVITYPUB_DOMAIN"] }
    : {};
  const list = await collection.find<{ token: string }>(cond).toArray();
  const projectId = env["FIREBASE_PROJECT_ID"];
  const url =
    `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  for (const { token } of list) {
    const payload = {
      message: {
        token,
        notification: { title, body },
      },
    };
    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });
  }
}
