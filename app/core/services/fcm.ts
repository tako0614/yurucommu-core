import type { DataStore } from "../db/types.ts";
import { pemToArrayBuffer } from "@takos/crypto";
import { bufToB64 } from "@takos/buffer";

function encodeBase64Url(buf: ArrayBuffer | Uint8Array): string {
  return bufToB64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(
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
  interface TokenApiResponse {
    access_token: string;
    expires_in: number;
  }
  const json = await res.json() as TokenApiResponse;
  cache = { token: json.access_token, exp: now + json.expires_in };
  return cache.token;
}

export async function registerToken(
  db: DataStore,
  token: string,
  userName: string,
): Promise<void> {
  await db.fcm.register(token, userName);
}

export async function unregisterToken(
  db: DataStore,
  token: string,
): Promise<void> {
  await db.fcm.unregister(token);
}

export async function sendNotification(
  db: DataStore,
  title: string,
  body: string,
  env: Record<string, string>,
): Promise<void> {
  const accessToken = await getAccessToken(env);
  if (!accessToken) return;
  const list = await db.fcm.list();
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
