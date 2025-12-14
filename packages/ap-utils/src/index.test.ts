import { describe, expect, it } from "vitest";

import { computeDigest, createContext, isActivityPubRequest, signRequest, verifySignature } from "./index";
import { toBase64 } from "./lib/base64";

function toPem(type: "PRIVATE KEY" | "PUBLIC KEY", bytes: Uint8Array): string {
  const base64 = toBase64(bytes);
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) lines.push(base64.slice(i, i + 64));
  return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
}

async function generateRsaKeyPair(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );

  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const publicKeySpki = new Uint8Array(await crypto.subtle.exportKey("spki", keyPair.publicKey));

  return {
    privateKeyPem: toPem("PRIVATE KEY", privateKeyPkcs8),
    publicKeyPem: toPem("PUBLIC KEY", publicKeySpki)
  };
}

describe("@takos/ap-utils", () => {
  it("computeDigest() matches SHA-256 of 'hello'", async () => {
    await expect(computeDigest("hello")).resolves.toBe("SHA-256=LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=");
  });

  it("isActivityPubRequest() detects ActivityPub media types", () => {
    expect(isActivityPubRequest(new Request("https://example.com", { headers: { Accept: "application/activity+json" } }))).toBe(
      true
    );
    expect(
      isActivityPubRequest(
        new Request("https://example.com", {
          headers: { Accept: "application/ld+json; profile=\"https://www.w3.org/ns/activitystreams\"" }
        })
      )
    ).toBe(true);
    expect(isActivityPubRequest(new Request("https://example.com", { headers: { Accept: "application/json" } }))).toBe(false);
  });

  it("createContext() includes activitystreams + security", () => {
    expect(createContext()).toEqual(["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"]);
    expect(createContext(["https://example.com/custom"])).toEqual([
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      "https://example.com/custom"
    ]);
  });

  it("signRequest() and verifySignature() round-trip", async () => {
    const { privateKeyPem, publicKeyPem } = await generateRsaKeyPair();

    const request = new Request("https://example.com/ap/inbox?x=1", {
      method: "POST",
      headers: {
        "Content-Type": "application/activity+json"
      },
      body: JSON.stringify({ hello: "world" })
    });

    const signed = await signRequest(request, privateKeyPem, "https://example.com/ap/users/alice#main-key");
    const ok = await verifySignature(signed, async () => publicKeyPem);
    expect(ok).toBe(true);

    const tamperedHeaders = new Headers(signed.headers);
    tamperedHeaders.set("Digest", "SHA-256=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    const tampered = new Request(signed, { headers: tamperedHeaders });
    const ok2 = await verifySignature(tampered, async () => publicKeyPem);
    expect(ok2).toBe(false);
  });
});
