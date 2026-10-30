import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, sessions } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import authRoutes from "../../routes/auth.ts";
import { saveOAuthState } from "../../lib/oauth-utils.ts";
import type { IKeyValueStore } from "../../runtime/types.ts";
import { createErrorMiddleware } from "../../middleware/error-handler.ts";
import { hashSessionIdForEnv } from "../../lib/crypto.ts";

/**
 * End-to-end glue test for GET /api/auth/callback/:provider (the OIDC path).
 *
 * The verification PRIMITIVES are covered elsewhere (verifyOidcIdToken,
 * owner-slot pin). This exercises the wired callback ORCHESTRATION: state lookup
 * + provider match, the CSRF nonce-cookie binding, the id_token claim-override
 * merge into the session identity, the fail-closed id_token_invalid redirect,
 * and session creation. The token/userinfo/JWKS HTTP calls are stubbed.
 */

const APP_URL = "https://yuru.test";
const ISSUER = "https://accounts.test";
const CLIENT = "client-123";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

class MockKV {
  store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
  async list() {
    return {
      keys: [...this.store.keys()].map((name) => ({ name })),
      list_complete: true as const,
    };
  }
}

// --- ES256 id_token signing harness (mirrors oidc-id-token.test.ts) ---
function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

function envWith(db: Database, kv: MockKV): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    KV: kv,
    OIDC_ISSUER_URL: ISSUER,
    OIDC_CLIENT_ID: CLIENT,
    ENCRYPTION_KEY: "0".repeat(64),
  } as unknown as Env;
}

function appFor(db: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(createErrorMiddleware({ logger: () => {} }));
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", null);
    await next();
  });
  app.route("/api/auth", authRoutes);
  return app;
}

// Stub globalThis.fetch to serve the token / userinfo / JWKS endpoints.
function withStubbedFetch<T>(
  idToken: string,
  jwks: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const orig = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/oauth/token")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "at-1",
            id_token: idToken,
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    if (url.includes("/oauth/jwks")) {
      return Promise.resolve(
        new Response(JSON.stringify(jwks), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (url.includes("/oauth/userinfo")) {
      // Minimal userinfo (no name/email) — the id_token must supply identity.
      return Promise.resolve(
        new Response(JSON.stringify({ sub: "takos-sub-1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as typeof fetch;
  return fn().finally(() => {
    globalThis.fetch = orig;
  });
}

function callbackRequest(state: string, nonceCookie: string | null) {
  const headers: Record<string, string> = {};
  if (nonceCookie !== null) headers.cookie = `oauth_nonce=${nonceCookie}`;
  return new Request(
    `${APP_URL}/api/auth/callback/takos?code=auth-code&state=${state}`,
    { method: "GET", headers, redirect: "manual" },
  );
}

function validClaims(nonce: string) {
  const now = Math.floor(Date.now() / 1000);
  return {
    iss: ISSUER,
    sub: "takos-sub-1",
    aud: CLIENT,
    name: "Tako Tako",
    email: "tako@accounts.test",
    preferred_username: "tako",
    iat: now,
    exp: now + 600,
    nonce,
    takosumi: {
      workspace_id: "ws_yurucommu",
      capsule_id: "cap_yurucommu",
      role: "owner",
    },
  };
}

test("happy path: the signed Takosumi Workspace owner claim boots the owner without a static subject pin", async () => {
  const db = await freshDb();
  const kv = new MockKV();
  const state = "state-ok";
  const nonce = "nonce-ok";
  await saveOAuthState(kv as unknown as IKeyValueStore, state, {
    provider: "takos",
    codeVerifier: "verifier",
    createdAt: Date.now(),
    nonce,
  });
  const { privateKey, jwks } = await makeKeyAndJwks();
  const idToken = await signIdToken(privateKey, "k1", validClaims(nonce));

  const res = await withStubbedFetch(idToken, jwks, async () =>
    appFor(db).fetch(callbackRequest(state, nonce), envWith(db, kv)),
  );

  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");

  // Identity came from the id_token (userinfo had only `sub`), owner on first
  // login. The takos OIDC subject is namespaced ("takos:<sub>", #11) so it can
  // never collide with the reserved password:/local: identity keys.
  const actor = await db
    .select()
    .from(actors)
    .where(eq(actors.takosUserId, "takos:takos-sub-1"))
    .get();
  expect(actor).toBeTruthy();
  expect(actor?.name).toBe("Tako Tako");
  expect(actor?.role).toBe("owner");

  // A session was created for the new actor with provider "takos".
  const session = await db
    .select({ provider: sessions.provider, memberId: sessions.memberId })
    .from(sessions)
    .where(eq(sessions.memberId, actor!.apId))
    .get();
  expect(session?.provider).toBe("takos");
});

test("provider mismatch: state stored for a different provider is rejected", async () => {
  const db = await freshDb();
  const kv = new MockKV();
  const state = "state-mismatch";
  await saveOAuthState(kv as unknown as IKeyValueStore, state, {
    provider: "google",
    codeVerifier: "v",
    createdAt: Date.now(),
    nonce: "n",
  });
  const res = await appFor(db).fetch(
    callbackRequest(state, "n"),
    envWith(db, kv),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=provider_mismatch");
  expect((await db.select().from(actors).all()).length).toBe(0);
});

test("CSRF: a missing oauth_nonce cookie fails the nonce binding", async () => {
  const db = await freshDb();
  const kv = new MockKV();
  const state = "state-csrf";
  await saveOAuthState(kv as unknown as IKeyValueStore, state, {
    provider: "takos",
    codeVerifier: "v",
    createdAt: Date.now(),
    nonce: "nonce-server",
  });
  const res = await appFor(db).fetch(
    callbackRequest(state, null), // no cookie
    envWith(db, kv),
  );
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=csrf_check_failed");
  expect((await db.select().from(actors).all()).length).toBe(0);
});

test("fail closed: an id_token signed by a foreign key is rejected (no login)", async () => {
  const db = await freshDb();
  const kv = new MockKV();
  const state = "state-badtoken";
  const nonce = "nonce-bad";
  await saveOAuthState(kv as unknown as IKeyValueStore, state, {
    provider: "takos",
    codeVerifier: "v",
    createdAt: Date.now(),
    nonce,
  });
  // Sign with a key whose public half is NOT in the published JWKS.
  const signer = await makeKeyAndJwks("k1");
  const published = await makeKeyAndJwks("k1");
  const idToken = await signIdToken(
    signer.privateKey,
    "k1",
    validClaims(nonce),
  );

  const res = await withStubbedFetch(idToken, published.jwks, async () =>
    appFor(db).fetch(callbackRequest(state, nonce), envWith(db, kv)),
  );

  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/?error=id_token_invalid");
  // No actor and no session were created.
  expect((await db.select().from(actors).all()).length).toBe(0);
  expect((await db.select().from(sessions).all()).length).toBe(0);
});

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile OIDC" : "OAuth callback"} reports session revocation failure instead of success or invalid token`, async () => {
    const db = await freshDb();
    const kv = new MockKV();
    const environment = envWith(db, kv);
    const state = `state-rotation-${mobile}`;
    const nonce = `nonce-rotation-${mobile}`;
    const { privateKey, jwks } = await makeKeyAndJwks();
    const idToken = await signIdToken(privateKey, "k1", validClaims(nonce));
    await saveOAuthState(kv as unknown as IKeyValueStore, state, {
      provider: "takos",
      codeVerifier: "verifier",
      createdAt: Date.now(),
      nonce,
    });
    const login = await withStubbedFetch(idToken, jwks, async () =>
      appFor(db).fetch(callbackRequest(state, nonce), environment),
    );
    expect(login.status).toBe(302);
    const raw = login.headers.get("set-cookie")?.match(/session=([^;]+)/)?.[1];
    expect(raw).toBeTruthy();
    const key = await hashSessionIdForEnv(environment, raw!);
    const before = await db.select().from(sessions).all();
    // The key is our own fixed-format SHA256 value, not caller-provided SQL.
    await db.run(
      sql.raw(`CREATE TRIGGER reject_oidc_session_delete BEFORE DELETE ON sessions
      WHEN OLD.id = '${key}' BEGIN SELECT RAISE(ABORT, 'fixture_session_delete_refused'); END;`),
    );
    const nextState = `${state}-next`;
    await saveOAuthState(kv as unknown as IKeyValueStore, nextState, {
      provider: "takos",
      codeVerifier: "verifier",
      createdAt: Date.now(),
      nonce,
    });
    const request = mobile
      ? new Request(`${APP_URL}/api/auth/mobile/oidc`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            cookie: `session=${raw}`,
          },
          body: JSON.stringify({ id_token: idToken }),
        })
      : new Request(
          `${APP_URL}/api/auth/callback/takos?code=auth-code&state=${nextState}`,
          {
            headers: { cookie: `session=${raw}; oauth_nonce=${nonce}` },
          },
        );
    const response = await withStubbedFetch(idToken, jwks, async () =>
      appFor(db).fetch(request, environment),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "SESSION_REVOCATION_FAILED",
    });
    expect(response.headers.get("set-cookie") ?? "").not.toMatch(
      /(?:^|,\s*)session=/,
    );
    expect(await db.select().from(sessions).all()).toEqual(before);
  });
}

// --- Takosumi `takosumi` claim shapes (per-app claims since 2026-10-29) ---
//
// Takosumi Accounts now adds `app_role` (and, for owned apps, may drop the
// Workspace pair) in the signed `takosumi` object. A fresh instance must still
// boot its first owner from that claim, through both login entry points.

async function signInWith(
  db: Database,
  kv: MockKV,
  takosumi: unknown,
  options: { mobile?: boolean; sub?: string; label: string },
) {
  const nonce = `nonce-${options.label}`;
  const state = `state-${options.label}`;
  const { privateKey, jwks } = await makeKeyAndJwks();
  const claims = {
    ...validClaims(nonce),
    ...(options.sub ? { sub: options.sub } : {}),
    takosumi,
  };
  const idToken = await signIdToken(privateKey, "k1", claims);
  await saveOAuthState(kv as unknown as IKeyValueStore, state, {
    provider: "takos",
    codeVerifier: "verifier",
    createdAt: Date.now(),
    nonce,
  });
  const request = options.mobile
    ? new Request(`${APP_URL}/api/auth/mobile/oidc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      })
    : callbackRequest(state, nonce);
  return withStubbedFetch(idToken, jwks, async () =>
    appFor(db).fetch(request, envWith(db, kv)),
  );
}

const NEW_OWNER_CLAIM = {
  capsule_id: "cap_yurucommu",
  workspace_id: "ws_yurucommu",
  role: "owner",
  app_role: "owner",
};

for (const mobile of [false, true]) {
  const entry = mobile ? "mobile OIDC" : "OAuth callback";
  const succeeded = (res: Response) =>
    mobile ? res.status === 200 : res.headers.get("location") === "/";
  const refused = async (res: Response) =>
    mobile
      ? res.status === 403 &&
        (await res.json()).error === "actor_creation_failed"
      : res.headers.get("location") === "/?error=actor_creation_failed";

  for (const [label, takosumi] of [
    ["new per-app claim with Workspace claims", NEW_OWNER_CLAIM],
    ["per-app claim only", { capsule_id: "cap_yurucommu", app_role: "owner" }],
    [
      "per-app claim with unknown extra keys",
      { ...NEW_OWNER_CLAIM, interface_id: "if_1", future: { a: 1 } },
    ],
    [
      "legacy three-key Workspace claim",
      {
        capsule_id: "cap_yurucommu",
        workspace_id: "ws_yurucommu",
        role: "owner",
      },
    ],
  ] as const) {
    test(`${entry}: fresh instance boots the first owner from the ${label}`, async () => {
      const db = await freshDb();
      const kv = new MockKV();
      const res = await signInWith(db, kv, takosumi, {
        mobile,
        label: `boot-${mobile}-${label}`,
      });
      expect(succeeded(res)).toBe(true);
      const all = await db.select().from(actors).all();
      expect(all).toHaveLength(1);
      expect(all[0]?.takosUserId).toBe("takos:takos-sub-1");
      expect(all[0]?.role).toBe("owner");
    });
  }

  for (const [label, takosumi] of [
    ["app_role member", { capsule_id: "cap_yurucommu", app_role: "member" }],
    [
      "app_role member over a Workspace owner role",
      { ...NEW_OWNER_CLAIM, app_role: "member" },
    ],
    ["capsule_id only", { capsule_id: "cap_yurucommu" }],
    ["malformed app_role", { ...NEW_OWNER_CLAIM, app_role: "admin" }],
    ["non-string app_role", { ...NEW_OWNER_CLAIM, app_role: true }],
    ["missing capsule_id", { app_role: "owner" }],
    [
      "incomplete Workspace pair",
      { capsule_id: "cap_yurucommu", app_role: "owner", role: "owner" },
    ],
    [
      "unknown owner-looking keys only",
      { capsule_id: "cap_yurucommu", owner: true, is_owner: "owner" },
    ],
  ] as const) {
    test(`${entry}: fresh instance refuses the first owner for ${label}`, async () => {
      const db = await freshDb();
      const kv = new MockKV();
      const res = await signInWith(db, kv, takosumi, {
        mobile,
        label: `refuse-${mobile}-${label}`,
      });
      expect(await refused(res)).toBe(true);
      expect(await db.select().from(actors).all()).toHaveLength(0);
      expect(await db.select().from(sessions).all()).toHaveLength(0);
    });
  }

  test(`${entry}: an existing owner keeps signing in with any claim shape and no new owner appears`, async () => {
    const db = await freshDb();
    const kv = new MockKV();
    const first = await signInWith(db, kv, NEW_OWNER_CLAIM, {
      mobile,
      label: `existing-a-${mobile}`,
    });
    expect(succeeded(first)).toBe(true);
    const [owner] = await db.select().from(actors).all();
    expect(owner?.role).toBe("owner");

    // Re-login resolves by subject; the claim is not consulted again.
    for (const [index, takosumi] of [
      { capsule_id: "cap_yurucommu", app_role: "member" },
      {
        capsule_id: "cap_yurucommu",
        workspace_id: "ws_yurucommu",
        role: "owner",
      },
      undefined,
    ].entries()) {
      const again = await signInWith(db, kv, takosumi, {
        mobile,
        label: `existing-b-${mobile}-${index}`,
      });
      expect(succeeded(again)).toBe(true);
    }
    const after = await db.select().from(actors).all();
    expect(after).toHaveLength(1);
    expect(after[0]?.apId).toBe(owner!.apId);
    expect(after[0]?.role).toBe("owner");

    // A different subject with a per-app owner claim cannot join or take over.
    const intruder = await signInWith(db, kv, NEW_OWNER_CLAIM, {
      mobile,
      sub: "takos-sub-2",
      label: `existing-c-${mobile}`,
    });
    expect(await refused(intruder)).toBe(true);
    expect(await db.select().from(actors).all()).toHaveLength(1);
  });
}
