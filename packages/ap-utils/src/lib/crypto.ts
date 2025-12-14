import { fromBase64, toBase64 } from "./base64";

const textEncoder = new TextEncoder();

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto SubtleCrypto is not available in this runtime.");
  }
  return subtle;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await getSubtle().digest("SHA-256", toArrayBuffer(bytes));
  return new Uint8Array(digest);
}

export function utf8Bytes(value: string): Uint8Array {
  return textEncoder.encode(value);
}

function pemBodyToBytes(pem: string): Uint8Array {
  const trimmed = pem.trim();
  const lines = trimmed.split(/\r?\n/);
  const bodyLines = lines.filter((line) => !line.startsWith("-----BEGIN ") && !line.startsWith("-----END "));
  const body = bodyLines.join("");
  return fromBase64(body);
}

export async function importPrivateKeyPkcs8(privateKeyPem: string): Promise<CryptoKey> {
  if (!privateKeyPem.includes("BEGIN PRIVATE KEY")) {
    throw new Error("Unsupported private key PEM format; expected PKCS8 'BEGIN PRIVATE KEY'.");
  }
  const keyBytes = pemBodyToBytes(privateKeyPem);
  return await getSubtle().importKey(
    "pkcs8",
    toArrayBuffer(keyBytes),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function importPublicKeySpki(publicKeyPem: string): Promise<CryptoKey> {
  if (!publicKeyPem.includes("BEGIN PUBLIC KEY")) {
    throw new Error("Unsupported public key PEM format; expected SPKI 'BEGIN PUBLIC KEY'.");
  }
  const keyBytes = pemBodyToBytes(publicKeyPem);
  return await getSubtle().importKey(
    "spki",
    toArrayBuffer(keyBytes),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

export async function signRsaSha256(message: string, privateKeyPem: string): Promise<string> {
  const key = await importPrivateKeyPkcs8(privateKeyPem);
  const signature = await getSubtle().sign("RSASSA-PKCS1-v1_5", key, toArrayBuffer(utf8Bytes(message)));
  return toBase64(new Uint8Array(signature));
}

export async function verifyRsaSha256(message: string, signatureBase64: string, publicKeyPem: string): Promise<boolean> {
  const key = await importPublicKeySpki(publicKeyPem);
  return await getSubtle().verify(
    "RSASSA-PKCS1-v1_5",
    key,
    toArrayBuffer(fromBase64(signatureBase64)),
    toArrayBuffer(utf8Bytes(message))
  );
}
