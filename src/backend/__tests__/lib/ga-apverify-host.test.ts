// GA Wave-6 AP-VERIFY #18: HTTP Signature verification must require `host`
// among the signed headers AND verify the signed Host value matches the
// request URL host, mirroring Mastodon's required header set. Without binding
// `host`, a validly-signed request for one origin could be replayed against a
// different target that trusts the same actor key (cross-target replay).

import { expect, test } from "bun:test";

import { generateKeyPair, signRequest } from "../../lib/ap-signing.ts";
import { verifyHttpSignature } from "../../lib/ap-verify.ts";

const KEY_ID = "https://remote.example/users/alice#main-key";
const TARGET_URL = "https://yurucommu.test/ap/users/bob/inbox";

// Minimal db mock: `verifyHttpSignature` resolves the actor public key via
// `fetchActorPublicKey`, which short-circuits on a fresh cached row, so we
// never touch the network.
function createDbMock(publicKeyPem: string) {
  return {
    query: {
      actorCache: {
        findFirst: () =>
          Promise.resolve({
            apId: "https://remote.example/users/alice",
            publicKeyPem,
            publicKeyId: KEY_ID,
            // Fresh entry so the key resolves from cache, not a network fetch.
            lastFetchedAt: new Date().toISOString(),
          }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function buildSignedRequest(
  headers: Record<string, string>,
  body: string,
): Request {
  return new Request(TARGET_URL, {
    method: "POST",
    headers,
    body,
  });
}

test("verifyHttpSignature accepts a correct signature that signs host", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const body = JSON.stringify({
    type: "Create",
    id: "https://remote.example/a",
  });
  const headers = await signRequest(
    privateKeyPem,
    KEY_ID,
    "POST",
    TARGET_URL,
    body,
  );
  const request = buildSignedRequest(headers, body);
  const db = createDbMock(publicKeyPem);

  const result = await verifyHttpSignature(request, db, body);
  expect(result.valid).toBe(true);
  expect(result.keyId).toBe(KEY_ID);
});

test("verifyHttpSignature rejects a signature whose signed-header set omits host", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const body = JSON.stringify({
    type: "Create",
    id: "https://remote.example/a",
  });

  // Hand-roll a signature over the "(request-target) date digest" set only
  // (no host), as a non-conforming peer would.
  const url = new URL(TARGET_URL);
  const date = new Date().toUTCString();
  const { bufferToBase64 } = await import("../../lib/base64.ts");
  const digest = `SHA-256=${bufferToBase64(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  )}`;
  const signedHeaders = "(request-target) date digest";
  const signatureString = `(request-target): post ${url.pathname}\ndate: ${date}\ndigest: ${digest}`;

  const pemContents = privateKeyPem
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryKey,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signatureString),
  );
  const signature = bufferToBase64(signatureBuffer);

  const headers: Record<string, string> = {
    Date: date,
    Host: url.host,
    Digest: digest,
    Signature: `keyId="${KEY_ID}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`,
  };
  const request = buildSignedRequest(headers, body);
  const db = createDbMock(publicKeyPem);

  const result = await verifyHttpSignature(request, db, body);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("host");
});

test("verifyHttpSignature rejects when the Host header does not match the request target", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const body = JSON.stringify({
    type: "Create",
    id: "https://remote.example/a",
  });

  // Sign for a DIFFERENT target host (the attacker's captured origin) and then
  // replay against TARGET_URL. The signature is cryptographically valid for
  // the signed string but the signed Host does not match the delivery target.
  const otherTarget = "https://evil.test/ap/users/bob/inbox";
  const signedForOther = await signRequest(
    privateKeyPem,
    KEY_ID,
    "POST",
    otherTarget,
    body,
  );

  // Deliver to TARGET_URL but keep the Host header / signature from the other
  // origin (a forwarded / replayed request).
  const request = buildSignedRequest(signedForOther, body);
  const db = createDbMock(publicKeyPem);

  const result = await verifyHttpSignature(request, db, body);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("Host");
});
