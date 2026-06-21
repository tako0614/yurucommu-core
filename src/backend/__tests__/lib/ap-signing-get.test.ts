import { expect, test } from "bun:test";

import { generateKeyPair, signRequest } from "../../lib/ap-signing.ts";

// Parse a Signature header into its components (keyId, headers, signature).
function parseSignature(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    const key = part.slice(0, eq).trim();
    const val = part
      .slice(eq + 1)
      .trim()
      .replace(/^"|"$/g, "");
    out[key] = val;
  }
  return out;
}

function pemToBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    .buffer as ArrayBuffer;
}

function b64ToBuffer(b64: string): ArrayBuffer {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    .buffer as ArrayBuffer;
}

async function verify(
  publicKeyPem: string,
  signatureB64: string,
  signingString: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "spki",
    pemToBuffer(publicKeyPem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64ToBuffer(signatureB64),
    new TextEncoder().encode(signingString),
  );
}

test("signRequest produces a verifiable bodyless GET signature (authorized-fetch)", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const keyId = "https://yuru.test/ap/actor#main-key";
  const url = "https://remote.example/users/alice";

  const headers = await signRequest(privateKeyPem, keyId, "GET", url);

  // A bodyless GET signs (request-target) host date — and carries NO Digest.
  const sig = parseSignature(headers.Signature);
  expect(sig.keyId).toEqual(keyId);
  expect(sig.algorithm).toEqual("rsa-sha256");
  expect(sig.headers).toEqual("(request-target) host date");
  expect(headers.Digest).toBeUndefined();
  expect(headers.Date).toBeDefined();

  // Reconstruct exactly what a secure-mode verifier reconstructs and confirm
  // the signature validates against the public key.
  const signingString = `(request-target): get /users/alice\nhost: remote.example\ndate: ${headers.Date}`;
  expect(await verify(publicKeyPem, sig.signature, signingString)).toBe(true);

  // A tampered signing string must NOT validate.
  const tampered = signingString.replace("/users/alice", "/users/mallory");
  expect(await verify(publicKeyPem, sig.signature, tampered)).toBe(false);
});

test("signRequest includes the query string in (request-target)", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const keyId = "https://yuru.test/ap/actor#main-key";
  const url = "https://remote.example/ap/objects?id=42";

  const headers = await signRequest(privateKeyPem, keyId, "GET", url);
  const sig = parseSignature(headers.Signature);

  // The signed request-target must carry `?id=42` (verifiers reconstruct
  // pathname + search); signing pathname-only would fail verification for a
  // query-bearing URL.
  const withQuery = `(request-target): get /ap/objects?id=42\nhost: remote.example\ndate: ${headers.Date}`;
  expect(await verify(publicKeyPem, sig.signature, withQuery)).toBe(true);

  const withoutQuery = `(request-target): get /ap/objects\nhost: remote.example\ndate: ${headers.Date}`;
  expect(await verify(publicKeyPem, sig.signature, withoutQuery)).toBe(false);
});
