import { expect, test } from "bun:test";
import { Hono } from "hono";

import { assertSpyCalls, spy, stub } from "jsr:@std/testing/mock";
import { FakeTime } from "jsr:@std/testing/time";
import authRoutes from "../../routes/auth.ts";
import { LOGIN_LOCKOUT_CONFIG } from "../../lib/auth-lockout.ts";
import { hashPassword } from "../../lib/crypto.ts";
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
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
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
  hashedPassword: string,
  envOverrides: Record<string, unknown> = {},
  options: { existingOwner?: boolean } = {},
) {
  const env = {
    KV: new MockKVNamespace(),
    AUTH_PASSWORD_HASH: hashedPassword,
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

    const mockOwnerGet = spy(() =>
      Promise.resolve(options.existingOwner === false ? null : actorData)
    );
    const mockGet = spy(() => Promise.resolve(actorData));
    const mockWhere = spy(() => ({ get: mockGet }));
    const mockActorWhere = spy(() => ({ get: mockOwnerGet }));
    const mockFrom = spy((table?: unknown) => {
      if (table === actors) return { where: mockActorWhere, get: mockGet };
      return { where: mockWhere, get: mockGet };
    });
    const mockSelect = spy(() => ({ from: mockFrom }));

    type ThenResolve = ((value: unknown) => unknown) | null | undefined;

    const capturedInserts =
      (env as { _capturedInserts?: Array<Record<string, unknown>> })
        ._capturedInserts;
    const mockInsertValues = spy((values?: Record<string, unknown>) => {
      if (capturedInserts && values) capturedInserts.push(values);
      return {
        returning: spy(() => ({
          get: spy(() => Promise.resolve(actorData)),
        })),
        then: (resolve: ThenResolve) =>
          Promise.resolve(undefined).then(resolve),
      };
    });
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

test("auth login lockout - locks out after 5 failed login attempts", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.24" };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(app, env, "/api/auth/login", {
        password: "wrong-password",
      }, headers);
      expect(res.status).toEqual(401);
    }

    const { res: lockoutRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    expect(lockoutRes.status).toEqual(429);
    assert_not_null(lockoutRes.headers.get("Retry-After"));

    const { res: blockedRes } = await request(app, env, "/api/auth/login", {
      password: "correct-password",
    }, headers);
    expect(blockedRes.status).toEqual(429);
  } finally {
    time.restore();
  }
});

test("auth login lockout - clears lockout state after successful login", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.25" };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(app, env, "/api/auth/login", {
        password: "wrong-password",
      }, headers);
      expect(res.status).toEqual(401);
    }

    const { res: successRes } = await request(app, env, "/api/auth/login", {
      password: "correct-password",
    }, headers);
    expect(successRes.status).toEqual(200);

    const { res: retryRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    expect(retryRes.status).toEqual(401);
  } finally {
    time.restore();
  }
});

test("auth login lockout - allows retries again after lockout window passes", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.26" };

    for (let i = 0; i < LOGIN_LOCKOUT_CONFIG.maxFailedAttempts; i++) {
      await request(
        app,
        env,
        "/api/auth/login",
        { password: "wrong-password" },
        headers,
      );
    }

    const { res: lockedRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    expect(lockedRes.status).toEqual(429);

    time.tick(LOGIN_LOCKOUT_CONFIG.lockoutMs + 1_000);

    const { res: postWindowRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    expect(postWindowRes.status).toEqual(401);
  } finally {
    time.restore();
  }
});

test("password login first run creates the fixed owner actor", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const { app, env } = createAuthTestApp(hashedPassword, {}, {
    existingOwner: false,
  });

  const { res, body } = await request(app, env, "/api/auth/login", {
    password: "correct-password",
  }, { "CF-Connecting-IP": "198.51.100.27" });

  expect(res.status).toEqual(200);
  expect(body).toEqual({ success: true });
});

test("password login - stores a hashed session id and sets SameSite=Strict cookie", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const inserted: Array<Record<string, unknown>> = [];
  const { app, env } = createAuthTestApp(
    hashedPassword,
    { YURUCOMMU_SESSION_HASH_SALT: "test-salt", _capturedInserts: inserted },
  );

  const { res } = await request(app, env, "/api/auth/login", {
    password: "correct-password",
  }, { "CF-Connecting-IP": "198.51.100.40" });

  expect(res.status).toEqual(200);

  // The persisted session-row key must be the salted SHA-256, never the raw id.
  expect(inserted.length).toEqual(1);
  const storedId = inserted[0].id;
  if (typeof storedId !== "string") {
    throw new Error("expected stored session id to be a string");
  }
  expect(storedId.startsWith("sha256:")).toEqual(true);
  // accessToken mirrors the same hashed key.
  expect(inserted[0].accessToken).toEqual(storedId);

  const setCookie = res.headers.get("set-cookie") ?? "";
  // The cookie carries the raw id (not the hashed key) with Strict flags.
  expect(/(^|[^a-z])session=/i.test(setCookie)).toEqual(true);
  expect(setCookie.includes(storedId)).toEqual(false);
  expect(/SameSite=Strict/i.test(setCookie)).toEqual(true);
  expect(/HttpOnly/i.test(setCookie)).toEqual(true);
  expect(/Secure/i.test(setCookie)).toEqual(true);
});

/** Helper: assert value is not null */
function assert_not_null<T>(value: T | null): asserts value is T {
  if (value === null) {
    throw new Error("Expected value to not be null");
  }
}
