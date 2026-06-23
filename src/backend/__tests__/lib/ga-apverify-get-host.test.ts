// HTTP Signature verification on the GET read-gate path (verifyGetHttpSignature)
// must mirror the POST path: require `host` among the signed headers AND verify
// the signed Host value matches the request URL host. (request-target) signs
// only method + path, NOT the host, so without binding `host` a signed GET
// captured for path P on one origin could be replayed against a DIFFERENT origin
// serving the same path P that trusts the same actor key — a cross-target
// read-gate replay. This path is live: it gates non-public /ap/objects/:id reads
// (outbox.ts) in authorized-fetch mode.

import { expect, test } from "bun:test";

import { generateKeyPair, signRequest } from "../../lib/ap-signing.ts";
import { verifyGetHttpSignature } from "../../lib/ap-verify.ts";

const KEY_ID = "https://remote.example/users/alice#main-key";
const TARGET_URL = "https://yurucommu.test/ap/objects/abc123";

// Minimal db mock: `verifyGetHttpSignature` resolves the actor public key via
// `fetchActorPublicKey`, which short-circuits on a fresh cached row, so we never
// touch the network.
function createDbMock(publicKeyPem: string) {
  return {
    query: {
      actorCache: {
        findFirst: () =>
          Promise.resolve({
            apId: "https://remote.example/users/alice",
            publicKeyPem,
            publicKeyId: KEY_ID,
            lastFetchedAt: new Date().toISOString(),
          }),
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function buildSignedGet(headers: Record<string, string>): Request {
  return new Request(TARGET_URL, { method: "GET", headers });
}

test("verifyGetHttpSignature accepts a correct bodyless GET that signs host", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const headers = await signRequest(privateKeyPem, KEY_ID, "GET", TARGET_URL);
  const request = buildSignedGet(headers);
  const db = createDbMock(publicKeyPem);

  const result = await verifyGetHttpSignature(request, db);
  expect(result.valid).toBe(true);
  expect(result.signingActor).toBe("https://remote.example/users/alice");
});

test("verifyGetHttpSignature rejects a GET whose signed-header set omits host", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // Hand-roll a signature over "(request-target) date" only (no host), as a
  // non-conforming peer would. The host-inclusion guard rejects before crypto.
  const url = new URL(TARGET_URL);
  const date = new Date().toUTCString();
  const { bufferToBase64 } = await import("../../lib/base64.ts");
  const signedHeaders = "(request-target) date";
  const signatureString = `(request-target): get ${url.pathname}\ndate: ${date}`;

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
    Signature: `keyId="${KEY_ID}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`,
  };
  const request = buildSignedGet(headers);
  const db = createDbMock(publicKeyPem);

  const result = await verifyGetHttpSignature(request, db);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("host");
});

test("verifyGetHttpSignature rejects when the signed Host does not match the request target", async () => {
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  // Sign for a DIFFERENT origin (the attacker's captured target) and replay the
  // same signature + Host header against TARGET_URL. The signature is valid for
  // the signed string but the signed Host does not match the delivery target.
  const otherTarget = "https://evil.test/ap/objects/abc123";
  const signedForOther = await signRequest(
    privateKeyPem,
    KEY_ID,
    "GET",
    otherTarget,
  );
  const request = buildSignedGet(signedForOther);
  const db = createDbMock(publicKeyPem);

  const result = await verifyGetHttpSignature(request, db);
  expect(result.valid).toBe(false);
  expect(result.error).toContain("Host");
});
