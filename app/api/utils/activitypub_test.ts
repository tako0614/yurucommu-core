import { assert } from "https://deno.land/std@0.208.0/assert/assert.ts";
import { verifyHttpSignature } from "./activitypub.ts";
import {
  bufferToPem,
  generateKeyPair,
  pemToArrayBuffer,
} from "../../shared/crypto.ts";
import { bufToB64 } from "../../shared/buffer.ts";

async function computeLegacyDigest(body: string): Promise<string> {
  const buf = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return `SHA-256=${bufToB64(hash)}`;
}

async function computeContentDigest(body: string): Promise<string> {
  const buf = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return `sha-256=:${bufToB64(hash)}:`;
}

async function generateRsaKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
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

async function withStubbedKey(
  keyId: string,
  publicKey: string,
  fn: () => Promise<void>,
) {
  const orig = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, _init?: RequestInit) => {
    if (typeof input === "string" && input === keyId) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ publicKeyPem: publicKey }),
          { status: 200 },
        ),
      );
    }
    return orig(input, _init);
  };
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

Deno.test("cavage署名を検証できる", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const keyId = "https://example.com/actor#main-key";
  const body = JSON.stringify({ hello: "world" });
  const url = "https://example.com/inbox";
  const method = "POST";
  const headers = new Headers();
  headers.set("Host", "example.com");
  const date = new Date().toUTCString();
  headers.set("Date", date);
  const digest = await computeLegacyDigest(body);
  headers.set("Digest", digest);
  const signingString = [
    `(request-target): ${method.toLowerCase()} /inbox`,
    "host: example.com",
    `date: ${date}`,
    `digest: ${digest}`,
  ].join("\n");
  const keyData = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    cryptoKey,
    new TextEncoder().encode(signingString),
  );
  const sigB64 = bufToB64(signature);
  headers.set(
    "Signature",
    `keyId="${keyId}",algorithm="ed25519",headers="(request-target) host date digest",signature="${sigB64}"`,
  );
  const req = new Request(url, { method, headers });
  await withStubbedKey(keyId, publicKey, async () => {
    const ok = await verifyHttpSignature(req, body);
    assert(ok);
  });
});

Deno.test("RSA鍵のcavage署名を検証できる", async () => {
  const { privateKey, publicKey } = await generateRsaKeyPair();
  const keyId = "https://example.com/actor#rsa-key";
  const body = JSON.stringify({ hello: "rsa" });
  const url = "https://example.com/inbox";
  const method = "POST";
  const headers = new Headers();
  headers.set("Host", "example.com");
  const date = new Date().toUTCString();
  headers.set("Date", date);
  const digest = await computeLegacyDigest(body);
  headers.set("Digest", digest);
  const signingString = [
    `(request-target): ${method.toLowerCase()} /inbox`,
    "host: example.com",
    `date: ${date}`,
    `digest: ${digest}`,
  ].join("\n");
  const keyData = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingString),
  );
  const sigB64 = bufToB64(signature);
  headers.set(
    "Signature",
    `keyId="${keyId}",algorithm="rsa-sha256",headers="(request-target) host date digest",signature="${sigB64}"`,
  );
  const req = new Request(url, { method, headers });
  await withStubbedKey(keyId, publicKey, async () => {
    const ok = await verifyHttpSignature(req, body);
    assert(ok);
  });
});

Deno.test("RFC9421リクエスト署名を検証できる", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const keyId = "https://example.com/actor#main-key";
  const body = JSON.stringify({ hello: "world" });
  const url = "https://example.com/fasp";
  const method = "POST";
  const digest = await computeContentDigest(body);
  const headers = new Headers({ "Content-Digest": digest });
  const created = Math.floor(Date.now() / 1000);
  const sigParams =
    `("@method" "@target-uri" "content-digest");created=${created};keyid="${keyId}";alg="ed25519"`;
  const signingString = [
    `"@method": ${method.toLowerCase()}`,
    `"@target-uri": ${url}`,
    `"content-digest": ${digest}`,
    `"@signature-params": ${sigParams}`,
  ].join("\n");
  const keyData = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    cryptoKey,
    new TextEncoder().encode(signingString),
  );
  headers.set("Signature-Input", `sig1=${sigParams}`);
  headers.set("Signature", `sig1=:${bufToB64(signature)}:`);
  const req = new Request(url, { method, headers });
  await withStubbedKey(keyId, publicKey, async () => {
    const ok = await verifyHttpSignature(req, body);
    assert(ok);
  });
});

Deno.test("RFC9421レスポンス署名を検証できる", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const keyId = "https://example.com/actor#main-key";
  const body = JSON.stringify({ ok: true });
  const digest = await computeContentDigest(body);
  const headers = new Headers({ "Content-Digest": digest });
  const created = Math.floor(Date.now() / 1000);
  const sigParams =
    `("@status" "content-digest");created=${created};keyid="${keyId}";alg="ed25519"`;
  const signingString = [
    `"@status": 200`,
    `"content-digest": ${digest}`,
    `"@signature-params": ${sigParams}`,
  ].join("\n");
  const keyData = pemToArrayBuffer(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    cryptoKey,
    new TextEncoder().encode(signingString),
  );
  headers.set("Signature-Input", `sig1=${sigParams}`);
  headers.set("Signature", `sig1=:${bufToB64(signature)}:`);
  const res = new Response(body, { status: 200, headers });
  await withStubbedKey(keyId, publicKey, async () => {
    const ok = await verifyHttpSignature(res, body);
    assert(ok);
  });
});
