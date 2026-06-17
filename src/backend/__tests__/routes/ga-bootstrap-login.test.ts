import { expect, test } from "bun:test";
import { Hono } from "hono";

import { spy } from "#test/mock";
import authRoutes from "../../routes/auth.ts";
import { hashPassword, verifyBootstrapOrPassword } from "../../lib/crypto.ts";
import { actors } from "../../../db/index.ts";

class MockKVNamespace {
  private store = new Map<string, { value: string; expiration?: number }>();

  async get(key: string): Promise<string | null> {
    const record = this.store.get(key);
    if (!record) return null;
    if (record.expiration && record.expiration <= Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return record.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void> {
    const expiration = options?.expirationTtl
      ? Math.floor(Date.now() / 1000) + options.expirationTtl
      : undefined;
    this.store.set(key, { value, expiration });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

async function request(
  app: Hono,
  env: Record<string, unknown>,
  path: string,
  body: unknown,
  headers: Record<string, string>,
) {
  const res = await app.fetch(
    new Request(`https://test.local${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
    env,
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { res, body: json };
}

function createAuthTestApp(
  authPasswordHash: string,
  envOverrides: Record<string, unknown> = {},
) {
  const env = {
    KV: new MockKVNamespace(),
    AUTH_PASSWORD_HASH: authPasswordHash,
    APP_URL: "https://test.yurucommu.com",
    ...envOverrides,
  };

  const app = new Hono();
  app.use("/api/auth/*", async (c, next) => {
    const actorData = {
      apId: "https://test.yurucommu.com/ap/users/tako",
      type: "Person",
      preferredUsername: "tako",
      name: "tako",
      iconUrl: null,
      role: "owner",
      takosUserId: "password:owner",
    };

    const mockGet = spy(() => Promise.resolve(actorData));
    const mockWhere = spy(() => ({ get: mockGet }));
    const mockFrom = spy((table?: unknown) => {
      if (table === actors) return { where: mockWhere, get: mockGet };
      return { where: mockWhere, get: mockGet };
    });
    const mockSelect = spy(() => ({ from: mockFrom }));

    type ThenResolve = ((value: unknown) => unknown) | null | undefined;

    const mockInsertValues = spy(() => ({
      returning: spy(() => ({ get: spy(() => Promise.resolve(actorData)) })),
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    }));
    const mockInsert = spy(() => ({ values: mockInsertValues }));
    const mockDeleteWhere = spy(() => ({
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    }));
    const mockDelete = spy(() => ({
      where: mockDeleteWhere,
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    }));

    (c as unknown as { set: (key: string, value: unknown) => void }).set("db", {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
    });
    await next();
  });
  app.route("/api/auth", authRoutes);

  return { app, env };
}

// A colon-less 64-char hex token mirrors what a fresh Capsule install
// generates for AUTH_PASSWORD_HASH.
const BOOTSTRAP_TOKEN =
  "a".repeat(8) + "b".repeat(8) + "c".repeat(16) + "d".repeat(32);

test("bootstrap login: colon-less token authenticates only with the exact token", async () => {
  expect(BOOTSTRAP_TOKEN.includes(":")).toBe(false);
  expect(BOOTSTRAP_TOKEN.length).toBe(64);

  const { app, env } = createAuthTestApp(BOOTSTRAP_TOKEN);

  const okHeaders = { "CF-Connecting-IP": "203.0.113.10" };
  const { res: okRes } = await request(
    app,
    env,
    "/api/auth/login",
    { password: BOOTSTRAP_TOKEN },
    okHeaders,
  );
  expect(okRes.status).toBe(200);
});

test("bootstrap login: a wrong token is rejected", async () => {
  const { app, env } = createAuthTestApp(BOOTSTRAP_TOKEN);

  const { res } = await request(
    app,
    env,
    "/api/auth/login",
    { password: BOOTSTRAP_TOKEN.slice(0, -1) + "e" },
    { "CF-Connecting-IP": "203.0.113.11" },
  );
  expect(res.status).toBe(401);
});

test("bootstrap login: a proper salt:hash value still uses the PBKDF2 path", async () => {
  const pbkdf2 = await hashPassword("correct-horse");
  expect(pbkdf2.includes(":")).toBe(true);

  const { app, env } = createAuthTestApp(pbkdf2);

  // Entering the stored hash verbatim must NOT authenticate (PBKDF2 path).
  const { res: verbatimRes } = await request(
    app,
    env,
    "/api/auth/login",
    { password: pbkdf2 },
    { "CF-Connecting-IP": "203.0.113.12" },
  );
  expect(verbatimRes.status).toBe(401);

  // The real password authenticates via PBKDF2.
  const { res: okRes } = await request(
    app,
    env,
    "/api/auth/login",
    { password: "correct-horse" },
    { "CF-Connecting-IP": "203.0.113.13" },
  );
  expect(okRes.status).toBe(200);
});

test("verifyBootstrapOrPassword: unit-level behaviour for both shapes", async () => {
  // Bootstrap token: exact match only.
  expect(
    await verifyBootstrapOrPassword(BOOTSTRAP_TOKEN, BOOTSTRAP_TOKEN),
  ).toBe(true);
  expect(await verifyBootstrapOrPassword("nope", BOOTSTRAP_TOKEN)).toBe(false);
  // A prefix of the token must not match (length-independent compare).
  expect(
    await verifyBootstrapOrPassword(
      BOOTSTRAP_TOKEN.slice(0, 32),
      BOOTSTRAP_TOKEN,
    ),
  ).toBe(false);

  // PBKDF2 salt:hash: only the real password matches; the stored value does not.
  const pbkdf2 = await hashPassword("s3cret");
  expect(await verifyBootstrapOrPassword("s3cret", pbkdf2)).toBe(true);
  expect(await verifyBootstrapOrPassword(pbkdf2, pbkdf2)).toBe(false);
  expect(await verifyBootstrapOrPassword("wrong", pbkdf2)).toBe(false);
});
