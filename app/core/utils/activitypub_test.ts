import { assert } from "https://deno.land/std@0.208.0/assert/assert.ts";
import { verifyHttpSignature } from "./activitypub.ts";
import { generateKeyPair, pemToArrayBuffer } from "@takos/crypto";
import { bufToB64 } from "@takos/buffer";

async function computeContentDigest(body: string): Promise<string> {
  const buf = new TextEncoder().encode(body);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return `sha-256=:${bufToB64(hash)}:`;
}

async function withStubbedKey(
  keyId: string,
  publicKey: string,
  fn: () => Promise<void>,
) {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, _init?: RequestInit) => {
    if (typeof input === "string" && input === keyId) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ publicKeyPem: publicKey }),
          { status: 200 },
        ),
      );
    }
    return (orig as unknown as typeof globalThis.fetch)(input, _init);
  }) as unknown as typeof globalThis.fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = orig;
  }
}

Deno.test("RFC9421リクエスト署名を検証できる", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const keyId = "https://example.com/actor#main-key";
  const body = JSON.stringify({ hello: "world" });
  const url = "https://example.com/endpoint";
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

Deno.test("@authority を含む署名を検証できる", async () => {
  const { privateKey, publicKey } = await generateKeyPair();
  const keyId = "https://example.com/actor#main-key";
  const body = JSON.stringify({ hello: "world" });
  const url = "https://example.com/inbox";
  const method = "POST";
  const digest = await computeContentDigest(body);
  const headers = new Headers({ "Content-Digest": digest });
  const created = Math.floor(Date.now() / 1000);
  const sigParams =
    `("@method" "@target-uri" "@authority" "content-digest");created=${created};keyid="${keyId}";alg="ed25519"`;
  const signingString = [
    `"@method": ${method.toLowerCase()}`,
    `"@target-uri": ${url}`,
    `"@authority": example.com`,
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
