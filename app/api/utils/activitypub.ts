import Account from "../models/account.ts";
import { env } from "./env.ts";

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return base64ToArrayBuffer(b64);
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function signRequest(
  url: string,
  method: string,
  body: string,
  account: { userName: string; privateKey: string },
): Promise<Headers> {
  const headers = new Headers();
  const host = new URL(url).host;
  const date = new Date().toUTCString();
  const encoder = new TextEncoder();
  const digestValue = arrayBufferToBase64(
    await crypto.subtle.digest("SHA-256", encoder.encode(body)),
  );
  const digest = `SHA-256=${digestValue}`;

  headers.set("host", host);
  headers.set("date", date);
  headers.set("digest", digest);
  headers.set("content-type", "application/activity+json");

  const signingString =
    `(request-target): ${method.toLowerCase()} ${new URL(url).pathname}\n` +
    `host: ${host}\n` +
    `date: ${date}\n` +
    `digest: ${digest}`;

  const keyData = pemToArrayBuffer(account.privateKey);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingString),
  );
  const signatureB64 = arrayBufferToBase64(signature);
  const keyId = `https://${
    env["ACTIVITYPUB_DOMAIN"]
  }/users/${account.userName}#main-key`;
  headers.set(
    "signature",
    `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${signatureB64}"`,
  );

  return headers;
}

export async function sendActivityPubObject(
  inboxUrl: string,
  object: unknown,
  actor: string,
): Promise<Response> {
  const body = JSON.stringify(object);
  const account = await Account.findOne({ userName: actor }).lean();
  if (!account) throw new Error("actor not found");
  const headers = await signRequest(inboxUrl, "POST", body, {
    userName: actor,
    privateKey: account.privateKey,
  });

  try {
    return await fetch(inboxUrl, {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    console.error(`Failed to send ActivityPub object to ${inboxUrl}:`, err);
    throw err;
  }
}

export async function deliverActivityPubObject(
  inboxes: string[],
  object: unknown,
  actor: string,
): Promise<void> {
  for (const inbox of inboxes) {
    if (inbox.startsWith("http")) {
      try {
        await sendActivityPubObject(inbox, object, actor);
      } catch (_) {
        /* ignore individual errors */
      }
    }
  }
}

export function ensurePem(
  key: string,
  type: "PUBLIC KEY" | "PRIVATE KEY",
): string {
  if (key.includes("BEGIN")) return key;
  const lines = key.match(/.{1,64}/g)?.join("\n") ?? key;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

function parseSignatureHeader(header: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const part of header.split(",")) {
    const [k, v] = part.trim().split("=");
    params[k] = v.replace(/^"|"$/g, "");
  }
  return params;
}

export async function verifyHttpSignature(
  req: Request,
  body: string,
): Promise<boolean> {
  const signatureHeader = req.headers.get("signature");
  if (!signatureHeader) return false;
  const params = parseSignatureHeader(signatureHeader);
  const publicKeyUrl = params.keyId;
  let publicKeyPem = "";
  try {
    const res = await fetch(publicKeyUrl, {
      headers: { accept: "application/activity+json" },
    });
    if (res.ok) {
      const data = await res.json();
      publicKeyPem = data.publicKeyPem ?? data.publicKey?.publicKeyPem ?? "";
    }
  } catch (_) {
    return false;
  }
  if (!publicKeyPem) return false;

  const digestHeader = req.headers.get("digest");
  if (digestHeader) {
    const encoder = new TextEncoder();
    const expectedDigest = arrayBufferToBase64(
      await crypto.subtle.digest("SHA-256", encoder.encode(body)),
    );
    if (digestHeader !== `SHA-256=${expectedDigest}`) {
      return false;
    }
  }

  const headersList = params.headers.split(" ");
  const url = new URL(req.url);
  const lines: string[] = [];
  for (const h of headersList) {
    let value: string | null = null;
    if (h === "(request-target)") {
      value = `${req.method.toLowerCase()} ${url.pathname}`;
    } else {
      value = req.headers.get(h);
    }
    if (value === null) return false;
    lines.push(`${h.toLowerCase()}: ${value}`);
  }
  const signingString = lines.join("\n");

  const encoder = new TextEncoder();
  const keyData = pemToArrayBuffer(publicKeyPem);
  const key = await crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = base64ToArrayBuffer(params.signature);
  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    signatureBytes,
    encoder.encode(signingString),
  );
  return verified;
}
