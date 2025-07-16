import SystemKey from "../models/system_key.ts";

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

export async function generateKeyPair() {
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

export async function getSystemKey(domain: string) {
  let doc = await SystemKey.findOne({ domain }).lean<{
    domain: string;
    privateKey: string;
    publicKey: string;
  }>();
  if (!doc) {
    const keys = await generateKeyPair();
    doc = { domain, ...keys };
    await SystemKey.create(doc);
  }
  return doc;
}
