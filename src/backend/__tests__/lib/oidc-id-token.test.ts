import { expect, test } from "bun:test";
import {
  parseTakosumiAppGrant,
  readVerifiedTakosumiAppGrant,
  takosumiGrantIsAppOwner,
  verifyOidcIdToken,
} from "../../lib/oidc-id-token.ts";

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

const grantOf = (takosumi: unknown) =>
  readVerifiedTakosumiAppGrant({ sub: "subject-abc", takosumi });

test("reads the legacy three-key Takosumi Workspace claim (compat)", () => {
  const grant = grantOf({
    workspace_id: "ws_yurucommu",
    capsule_id: "cap_yurucommu",
    role: "owner",
  });
  expect(grant).toEqual({
    capsuleId: "cap_yurucommu",
    workspace: { workspaceId: "ws_yurucommu", role: "owner" },
  });
  expect(takosumiGrantIsAppOwner(grant)).toBe(true);
  for (const role of ["admin", "member", "viewer"] as const) {
    const nonOwner = grantOf({
      workspace_id: "ws_yurucommu",
      capsule_id: "cap_yurucommu",
      role,
    });
    expect(nonOwner?.workspace?.role).toBe(role);
    expect(takosumiGrantIsAppOwner(nonOwner)).toBe(false);
  }
});

test("reads the per-app claim alongside the Workspace claims Takosumi emits since 2026-10-29", () => {
  const grant = grantOf({
    capsule_id: "cap_yurucommu",
    workspace_id: "ws_yurucommu",
    role: "owner",
    app_role: "owner",
  });
  expect(grant).toEqual({
    capsuleId: "cap_yurucommu",
    appRole: "owner",
    workspace: { workspaceId: "ws_yurucommu", role: "owner" },
  });
  expect(takosumiGrantIsAppOwner(grant)).toBe(true);
});

test("reads the per-app claim without any Workspace claims", () => {
  const owner = grantOf({ capsule_id: "cap_yurucommu", app_role: "owner" });
  expect(owner).toEqual({ capsuleId: "cap_yurucommu", appRole: "owner" });
  expect(takosumiGrantIsAppOwner(owner)).toBe(true);

  const member = grantOf({ capsule_id: "cap_yurucommu", app_role: "member" });
  expect(member).toEqual({ capsuleId: "cap_yurucommu", appRole: "member" });
  expect(takosumiGrantIsAppOwner(member)).toBe(false);
});

test("app_role is authoritative over the legacy Workspace role when both are present", () => {
  // A Workspace owner who is only a member of this app is not its owner.
  const grant = grantOf({
    capsule_id: "cap_yurucommu",
    workspace_id: "ws_yurucommu",
    role: "owner",
    app_role: "member",
  });
  expect(grant?.appRole).toBe("member");
  expect(grant?.workspace?.role).toBe("owner");
  expect(takosumiGrantIsAppOwner(grant)).toBe(false);
});

test("a non-member of an owned app (capsule_id only) gets a grant without authority", () => {
  const grant = grantOf({ capsule_id: "cap_yurucommu" });
  expect(grant).toEqual({ capsuleId: "cap_yurucommu" });
  expect(takosumiGrantIsAppOwner(grant)).toBe(false);
});

test("ignores unknown extra keys and never surfaces them", () => {
  const grant = grantOf({
    capsule_id: "cap_yurucommu",
    app_role: "owner",
    workspace_id: "ws_yurucommu",
    role: "owner",
    interface_id: "if_1",
    future_claim: { owner: true },
    is_owner: true,
    token: "x",
  });
  expect(grant).toEqual({
    capsuleId: "cap_yurucommu",
    appRole: "owner",
    workspace: { workspaceId: "ws_yurucommu", role: "owner" },
  });
  // An unknown key can never confer authority on its own.
  const unknownOnly = grantOf({
    capsule_id: "cap_yurucommu",
    owner: true,
    appRole: "owner",
    app_roles: ["owner"],
  });
  expect(unknownOnly).toEqual({ capsuleId: "cap_yurucommu" });
  expect(takosumiGrantIsAppOwner(unknownOnly)).toBe(false);
});

test("an inherited property is never read as a claim", () => {
  const inherited = Object.create({ app_role: "owner", role: "owner" });
  inherited.capsule_id = "cap_yurucommu";
  const grant = grantOf(inherited);
  expect(grant).toEqual({ capsuleId: "cap_yurucommu" });
  expect(takosumiGrantIsAppOwner(grant)).toBe(false);
  // A JSON `__proto__` key is an own data property, not a prototype swap.
  const parsed = JSON.parse(
    '{"capsule_id":"cap_yurucommu","__proto__":{"app_role":"owner"}}',
  );
  expect(takosumiGrantIsAppOwner(grantOf(parsed))).toBe(false);
});

test("refuses the whole grant when a known key is malformed", () => {
  for (const takosumi of [
    undefined,
    null,
    "owner",
    ["owner"],
    {},
    // capsule_id is required and bounded
    { app_role: "owner" },
    { workspace_id: "ws", role: "owner" },
    { capsule_id: "", app_role: "owner" },
    { capsule_id: " cap", app_role: "owner" },
    { capsule_id: "cap 1", app_role: "owner" },
    { capsule_id: "c".repeat(513), app_role: "owner" },
    { capsule_id: 42, app_role: "owner" },
    { capsule_id: null, app_role: "owner" },
    // app_role must be exactly "owner" | "member"
    { capsule_id: "cap", app_role: "admin" },
    { capsule_id: "cap", app_role: "Owner" },
    { capsule_id: "cap", app_role: "" },
    { capsule_id: "cap", app_role: null },
    { capsule_id: "cap", app_role: true },
    { capsule_id: "cap", app_role: ["owner"] },
    { capsule_id: "cap", app_role: { role: "owner" } },
    // legacy pair must be complete and valid
    { workspace_id: "ws", capsule_id: "cap", role: "root" },
    { workspace_id: "", capsule_id: "cap", role: "owner" },
    { workspace_id: "ws", capsule_id: "", role: "owner" },
    { capsule_id: "cap", role: "owner" },
    { capsule_id: "cap", workspace_id: "ws" },
    { capsule_id: "cap", workspace_id: "ws", role: null },
    { capsule_id: "cap", workspace_id: null, role: "owner" },
    // a valid legacy pair never rescues a malformed app_role
    { capsule_id: "cap", app_role: "root", workspace_id: "ws", role: "owner" },
  ]) {
    expect(grantOf(takosumi)).toBeUndefined();
  }
  expect(takosumiGrantIsAppOwner(undefined)).toBe(false);
});

test("reports which known key refused the claim, never its value", () => {
  const reason = (takosumi: unknown) =>
    parseTakosumiAppGrant({ sub: "subject-abc", takosumi });
  expect(parseTakosumiAppGrant({ sub: "subject-abc" })).toEqual({
    status: "absent",
  });
  expect(reason(undefined)).toEqual({ status: "absent" });
  expect(reason(null)).toEqual({ status: "rejected", reason: "not_object" });
  expect(reason(["x"])).toEqual({ status: "rejected", reason: "not_object" });
  expect(reason({ app_role: "owner" })).toEqual({
    status: "rejected",
    reason: "capsule_id",
  });
  expect(reason({ capsule_id: "cap", app_role: "admin" })).toEqual({
    status: "rejected",
    reason: "app_role",
  });
  expect(reason({ capsule_id: "cap", role: "owner" })).toEqual({
    status: "rejected",
    reason: "workspace_pair",
  });
  expect(
    reason({ capsule_id: "cap", app_role: "owner", workspace_id: "ws" }),
  ).toEqual({
    status: "granted",
    grant: { capsuleId: "cap", appRole: "owner" },
    ignoredWorkspacePair: true,
  });
});

test("a valid app_role survives a malformed legacy Workspace pair, which is dropped", () => {
  // The pair cannot decide anything once app_role is present, so a staged
  // removal of Workspace claims or a new Workspace role must not break
  // first-owner bootstrap again.
  for (const takosumi of [
    { capsule_id: "cap", app_role: "owner", role: "owner" },
    { capsule_id: "cap", app_role: "owner", workspace_id: "ws" },
    { capsule_id: "cap", app_role: "owner", workspace_id: "ws", role: "root" },
    { capsule_id: "cap", app_role: "owner", workspace_id: "", role: "owner" },
  ]) {
    const grant = grantOf(takosumi);
    expect(grant).toEqual({ capsuleId: "cap", appRole: "owner" });
    expect(takosumiGrantIsAppOwner(grant)).toBe(true);
  }
  const member = grantOf({
    capsule_id: "cap",
    app_role: "member",
    workspace_id: "ws",
    role: "superowner",
  });
  expect(member).toEqual({ capsuleId: "cap", appRole: "member" });
  expect(takosumiGrantIsAppOwner(member)).toBe(false);
});

test("the legacy owner claim with unknown extra keys grants during compat", () => {
  // The previous exact-key parser refused this; the compat fallback now
  // accepts it because no app_role is present.
  const grant = grantOf({
    capsule_id: "cap_yurucommu",
    workspace_id: "ws_yurucommu",
    role: "owner",
    interface_id: "if_1",
  });
  expect(grant).toEqual({
    capsuleId: "cap_yurucommu",
    workspace: { workspaceId: "ws_yurucommu", role: "owner" },
  });
  expect(takosumiGrantIsAppOwner(grant)).toBe(true);
});

test("issuer fixtures: exact shapes Takosumi Accounts emits decide ownership as intended", () => {
  // Mirrors takosumi accounts/service oidc-live-grant + oidc-routes output.
  const cases: Array<[string, unknown, boolean]> = [
    [
      "owned app, owner with Workspace role",
      {
        capsule_id: "cap",
        workspace_id: "ws",
        role: "owner",
        app_role: "owner",
      },
      true,
    ],
    [
      "owned app, owner without Workspace role",
      { capsule_id: "cap", app_role: "owner" },
      true,
    ],
    [
      "owned app, member who is a Workspace owner",
      {
        capsule_id: "cap",
        workspace_id: "ws",
        role: "owner",
        app_role: "member",
      },
      false,
    ],
    [
      "owned app, member who is a Workspace admin",
      {
        capsule_id: "cap",
        workspace_id: "ws",
        role: "admin",
        app_role: "member",
      },
      false,
    ],
    ["owned app, non-member", { capsule_id: "cap" }, false],
    [
      "legacy unowned app, Workspace owner",
      { capsule_id: "cap", workspace_id: "ws", role: "owner" },
      true,
    ],
    [
      "legacy unowned app, Workspace admin",
      { capsule_id: "cap", workspace_id: "ws", role: "admin" },
      false,
    ],
  ];
  for (const [, takosumi, owner] of cases) {
    expect(takosumiGrantIsAppOwner(grantOf(takosumi))).toBe(owner);
  }
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

test("rejects a token with NO exp claim (fail closed, not eternal)", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  const claims = validClaims();
  delete (claims as Record<string, unknown>).exp;
  const token = await signIdToken(privateKey, "k1", claims);
  await withMockJwks(jwks, async () => {
    await expect(verifyOidcIdToken(token, opts)).rejects.toThrow();
  });
});

test("when expectedNonce is set, accepts a matching nonce and rejects a mismatch/missing one", async () => {
  const { privateKey, jwks } = await makeKeyAndJwks();
  await withMockJwks(jwks, async () => {
    const ok = await signIdToken(privateKey, "k1", {
      ...validClaims(),
      nonce: "n-123",
    });
    const matched = await verifyOidcIdToken(ok, {
      ...opts,
      expectedNonce: "n-123",
    });
    expect(matched.sub).toBe("subject-abc");

    const wrong = await signIdToken(privateKey, "k1", {
      ...validClaims(),
      nonce: "n-evil",
    });
    await expect(
      verifyOidcIdToken(wrong, { ...opts, expectedNonce: "n-123" }),
    ).rejects.toThrow();

    // no nonce echoed but one expected -> reject
    const none = await signIdToken(privateKey, "k1", validClaims());
    await expect(
      verifyOidcIdToken(none, { ...opts, expectedNonce: "n-123" }),
    ).rejects.toThrow();
  });
});
