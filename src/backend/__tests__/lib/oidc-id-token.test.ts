import { expect, test } from "bun:test";
import { verifyOidcIdToken } from "../../lib/oidc-id-token.ts";

// ES256 ID Token verification: a valid token (signed by the issuer's key) passes
// and yields its claims; signature/alg/iss/aud/exp tampering all fail closed.

const ISSUER = "https://app.takosumi.test";
const CLIENT = "toc_client123";
const JWKS_URL = `${ISSUER}/oauth/jwks`;

function b64url(bytes: Uint8Array): string {
  const s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

async function makeKeyAndJwks(kid = "k1") {
  const kp = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", kp.publicKey);
  return {
    privateKey: kp.privateKey,
    jwks: { keys: [{ ...jwk, kid, use: "sig", alg: "ES256" }] },
  };
}

async function signIdToken(
  privateKey: CryptoKey,
  kid: string,
  claims: Record<string, unknown>,
): Promise<string> {
  const signingInput = `${b64urlJson({ alg: "ES256", typ: "JWT", kid })}.${b64urlJson(claims)}`;
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
      new TextEncoder().encode(signingInput),
    ),
  );
  return `${signingInput}.${b64url(sig)}`;
}

function withMockJwks<T>(jwks: unknown, fn: () => Promise<T>): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((_input: RequestInfo | URL) =>
    Promise.resolve(
      new Response(JSON.stringify(jwks), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

function validClaims(): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: "subject-abc",
    aud: CLIENT,
    name: "Tako",
    email: "tako@example.com",
    iat: now,
    exp: now + 600,
  };
}

const opts = { issuer: ISSUER, clientId: CLIENT, jwksUrl: JWKS_URL };

test("verifies a valid ES256 id_token and returns its identity claims", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const token = await signIdToken(privateKey, "k1", validClaims());
  await withMockJwks(jwks, async () => {
    const claims = await verifyOidcIdToken(token, opts);
    expect(claims.sub).toBe("subject-abc");
    expect(claims.name).toBe("Tako");
    expect(claims.email).toBe("tako@example.com");
  });
});

test("accepts an issuer with a trailing slash mismatch", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const token = await signIdToken(privateKey, "k1", validClaims());
  await withMockJwks(jwks, async () => {
    const claims = await verifyOidcIdToken(token, {
      ...opts,
      issuer: `${ISSUER}/`,
    });
    expect(claims.sub).toBe("subject-abc");
  });
});

test("rejects a tampered signature", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const token = await signIdToken(privateKey, "k1", validClaims());
  const tampered = `${token.slice(0, -6)}AAAAAA`;
  await withMockJwks(jwks, async () => {
    await expect(verifyOidcIdToken(tampered, opts)).rejects.toThrow();
  });
});

test("rejects alg=none (no signature downgrade)", async () => {
  const token = `${b64urlJson({ alg: "none", typ: "JWT" })}.${b64urlJson(validClaims())}.`;
  const { jwks } = await makeKeyAndJwks();
  await withMockJwks(jwks, async () => {
    await expect(verifyOidcIdToken(token, opts)).rejects.toThrow();
  });
});

test("rejects a token signed by a DIFFERENT key (no matching JWKS key)", async () => {
  const signer = await makeKeyAndJwks("signer-kid");
  const token = await signIdToken(
    signer.privateKey,
    "signer-kid",
    validClaims(),
  );
  // The published JWKS belongs to a different key entirely.
  const other = await makeKeyAndJwks("signer-kid");
  await withMockJwks(other.jwks, async () => {
    await expect(verifyOidcIdToken(token, opts)).rejects.toThrow();
  });
});

test("rejects a wrong audience", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const token = await signIdToken(privateKey, "k1", {
    ...validClaims(),
    aud: "someone-else",
  });
  await withMockJwks(jwks, async () => {
    await expect(verifyOidcIdToken(token, opts)).rejects.toThrow();
  });
});

test("rejects a wrong issuer", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const token = await signIdToken(privateKey, "k1", {
    ...validClaims(),
    iss: "https://evil.example",
  });
  await withMockJwks(jwks, async () => {
    await expect(verifyOidcIdToken(token, opts)).rejects.toThrow();
  });
});

test("rejects an expired token", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const token = await signIdToken(privateKey, "k1", {
    ...validClaims(),
    exp: Math.floor(Date.now() / 1000) - 3600,
  });
  await withMockJwks(jwks, async () => {
    await expect(verifyOidcIdToken(token, opts)).rejects.toThrow();
  });
});
