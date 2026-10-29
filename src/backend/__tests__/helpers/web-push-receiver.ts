/**
 * Test-side counterpart of the Web Push sender: a user agent that owns a
 * subscription key pair and decrypts aes128gcm (RFC 8291), and a push service
 * that verifies the VAPID header (RFC 8292). Used by unit tests and by the
 * fake push service of the local end-to-end check.
 */

import { base64UrlDecode, base64UrlEncode } from "../../lib/web-push/bytes.ts";

function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

const encoder = new TextEncoder();

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", buffer(ikm), "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: buffer(salt), info: buffer(info) },
      key,
      length * 8,
    ),
  );
}

export interface TestUserAgent {
  readonly privateKey: CryptoKey;
  readonly p256dh: Uint8Array;
  readonly auth: Uint8Array;
  readonly p256dhBase64Url: string;
  readonly authBase64Url: string;
}

export async function createTestUserAgent(): Promise<TestUserAgent> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const p256dh = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: pair.privateKey,
    p256dh,
    auth,
    p256dhBase64Url: base64UrlEncode(p256dh),
    authBase64Url: base64UrlEncode(auth),
  };
}

/** Import a fixed ECDH key pair from a raw private scalar and public point. */
export async function importEcdhPrivateKey(
  privateScalar: Uint8Array,
  publicPoint: Uint8Array,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(privateScalar),
      x: base64UrlEncode(publicPoint.subarray(1, 33)),
      y: base64UrlEncode(publicPoint.subarray(33, 65)),
      ext: true,
    },
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
}

/** Decrypt one aes128gcm Web Push body as the subscription's user agent. */
export async function decryptWebPushBody(
  body: Uint8Array,
  agent: Pick<TestUserAgent, "privateKey" | "p256dh" | "auth">,
): Promise<Uint8Array> {
  const salt = body.subarray(0, 16);
  const recordSize = new DataView(
    body.buffer,
    body.byteOffset,
    body.byteLength,
  ).getUint32(16);
  const keyIdLength = body[20]!;
  const senderPublic = body.subarray(21, 21 + keyIdLength);
  const ciphertext = body.subarray(21 + keyIdLength);
  if (ciphertext.byteLength > recordSize) {
    throw new Error("multi-record bodies are not expected");
  }
  const senderKey = await crypto.subtle.importKey(
    "raw",
    buffer(senderPublic),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: senderKey },
      agent.privateKey,
      256,
    ),
  );
  const keyInfo = concat(
    encoder.encode("WebPush: info\0"),
    agent.p256dh,
    senderPublic,
  );
  const ikm = await hkdf(ecdhSecret, agent.auth, keyInfo, 32);
  const cek = await hkdf(
    ikm,
    salt,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    ikm,
    salt,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );
  const key = await crypto.subtle.importKey(
    "raw",
    buffer(cek),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: buffer(nonce), tagLength: 128 },
      key,
      buffer(ciphertext),
    ),
  );
  let end = padded.byteLength - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (end < 0 || padded[end] !== 0x02) {
    throw new Error("missing last-record padding delimiter");
  }
  return padded.subarray(0, end);
}

export interface VerifiedVapid {
  readonly header: Record<string, unknown>;
  readonly claims: { aud: string; exp: number; sub: string };
  readonly publicKey: string;
  readonly jwt: string;
}

/**
 * Parse and verify `Authorization: vapid t=..., k=...` the way a push service
 * does: ES256 over the JWS signing input with the key in `k`.
 */
export async function verifyVapidAuthorization(
  authorization: string | null,
): Promise<VerifiedVapid> {
  const match = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(
    authorization ?? "",
  );
  if (!match) throw new Error(`malformed VAPID header: ${authorization}`);
  const jwt = match[1]!;
  const publicKey = match[2]!;
  const [header, payload, signature] = jwt.split(".");
  if (!header || !payload || !signature) throw new Error("malformed JWT");
  const publicBytes = base64UrlDecode(publicKey);
  const signatureBytes = base64UrlDecode(signature);
  if (!publicBytes || !signatureBytes) throw new Error("bad base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    buffer(publicBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    buffer(signatureBytes),
    buffer(encoder.encode(`${header}.${payload}`)),
  );
  if (!valid) throw new Error("VAPID signature does not verify");
  const decode = (part: string) =>
    JSON.parse(new TextDecoder().decode(base64UrlDecode(part)!));
  return {
    header: decode(header),
    claims: decode(payload),
    publicKey,
    jwt,
  };
}
