import { expect, test } from "bun:test";
import { Hono } from "hono";

import { FakeTime } from "#test/time";
import authRoutes from "../../routes/auth.ts";
import { LOGIN_LOCKOUT_CONFIG } from "../../lib/auth-lockout.ts";
import { hashPassword } from "../../lib/crypto.ts";
import { actors, sessions } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

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

async function createAuthTestApp(
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

  const { db } = await createTestDb();
  if (options.existingOwner !== false) {
    const apId = "https://test.yurucommu.com/ap/users/tako";
    await db.insert(actors).values({
      apId,
      type: "Person",
      preferredUsername: "tako",
      name: "tako",
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem: "test-public-key",
      privateKeyPem: "test-private-key",
      role: "owner",
      takosUserId: "password:owner",
    });
  }
  const app = new Hono();
  app.use("/api/auth/*", async (c, next) => {
    (c as unknown as { set: (key: string, value: unknown) => void }).set(
      "db",
      db,
    );
    await next();
  });
  app.route("/api/auth", authRoutes);

  return { app, env, db };
}

test("auth login lockout - locks out after 5 failed login attempts", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = await createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.24" };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(
        app,
        env,
        "/api/auth/login",
        {
          password: "wrong-password",
        },
        headers,
      );
      expect(res.status).toEqual(401);
    }

    const { res: lockoutRes } = await request(
      app,
      env,
      "/api/auth/login",
      {
        password: "wrong-password",
      },
      headers,
    );
    expect(lockoutRes.status).toEqual(429);
    assert_not_null(lockoutRes.headers.get("Retry-After"));

    const { res: blockedRes } = await request(
      app,
      env,
      "/api/auth/login",
      {
        password: "correct-password",
      },
      headers,
    );
    expect(blockedRes.status).toEqual(429);
  } finally {
    time.restore();
  }
});

test("auth login lockout - clears lockout state after successful login", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = await createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.25" };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(
        app,
        env,
        "/api/auth/login",
        {
          password: "wrong-password",
        },
        headers,
      );
      expect(res.status).toEqual(401);
    }

    const { res: successRes } = await request(
      app,
      env,
      "/api/auth/login",
      {
        password: "correct-password",
      },
      headers,
    );
    expect(successRes.status).toEqual(200);

    const { res: retryRes } = await request(
      app,
      env,
      "/api/auth/login",
      {
        password: "wrong-password",
      },
      headers,
    );
    expect(retryRes.status).toEqual(401);
  } finally {
    time.restore();
  }
});

test("auth login lockout - allows retries again after lockout window passes", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = await createAuthTestApp(hashedPassword);
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

    const { res: lockedRes } = await request(
      app,
      env,
      "/api/auth/login",
      {
        password: "wrong-password",
      },
      headers,
    );
    expect(lockedRes.status).toEqual(429);

    time.tick(LOGIN_LOCKOUT_CONFIG.lockoutMs + 1_000);

    const { res: postWindowRes } = await request(
      app,
      env,
      "/api/auth/login",
      {
        password: "wrong-password",
      },
      headers,
    );
    expect(postWindowRes.status).toEqual(401);
  } finally {
    time.restore();
  }
});

test("password login first run creates the fixed owner actor", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const { app, env, db } = await createAuthTestApp(
    hashedPassword,
    {},
    {
      existingOwner: false,
    },
  );

  const { res, body } = await request(
    app,
    env,
    "/api/auth/login",
    {
      password: "correct-password",
    },
    { "CF-Connecting-IP": "198.51.100.27" },
  );

  expect(res.status).toEqual(200);
  expect(body).toEqual({ success: true });
  expect(await db.select().from(actors)).toHaveLength(1);
});

test("password login - stores a hashed session id and sets SameSite=Strict cookie", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const { app, env, db } = await createAuthTestApp(hashedPassword, {
    YURUCOMMU_SESSION_HASH_SALT: "test-salt",
  });

  const { res } = await request(
    app,
    env,
    "/api/auth/login",
    {
      password: "correct-password",
    },
    { "CF-Connecting-IP": "198.51.100.40" },
  );

  expect(res.status).toEqual(200);

  // The persisted session-row key must be the salted SHA-256, never the raw id.
  const inserted = await db.select().from(sessions);
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

test("mobile password login returns a host bearer and does not set a cookie", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const { app, env, db } = await createAuthTestApp(hashedPassword, {
    YURUCOMMU_SESSION_HASH_SALT: "test-salt",
  });

  const { res, body } = await request(
    app,
    env,
    "/api/auth/mobile/login",
    { password: "correct-password" },
    { "CF-Connecting-IP": "198.51.100.41" },
  );

  expect(res.status).toEqual(200);
  expect(res.headers.get("set-cookie")).toBeNull();
  expect(body).toMatchObject({
    token_type: "Bearer",
    expires_in: 30 * 24 * 60 * 60,
  });
  const token = (body as { access_token?: unknown }).access_token;
  expect(typeof token).toEqual("string");
  expect((token as string).startsWith("sha256:")).toEqual(false);
  expect((await db.select().from(sessions))[0]?.id).not.toEqual(token);
});

test("mobile password login preserves leading and trailing whitespace", async () => {
  const password = " correct password ";
  const hashedPassword = await hashPassword(password);
  const { app, env } = await createAuthTestApp(hashedPassword);

  const { res } = await request(
    app,
    env,
    "/api/auth/mobile/login",
    { password },
    { "CF-Connecting-IP": "198.51.100.42" },
  );

  expect(res.status).toEqual(200);
});

test("mobile bearer logout revokes the host session", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const { app, env, db } = await createAuthTestApp(hashedPassword);
  const login = await request(
    app,
    env,
    "/api/auth/mobile/login",
    { password: "correct-password" },
    { "CF-Connecting-IP": "198.51.100.43" },
  );
  const token = (login.body as { access_token: string }).access_token;
  expect(await db.select().from(sessions)).toHaveLength(1);

  const logout = await request(
    app,
    env,
    "/api/auth/logout",
    {},
    { Authorization: `Bearer ${token}` },
  );

  expect(logout.res.status).toBe(200);
  expect(logout.body).toEqual({ success: true });
  expect(await db.select().from(sessions)).toHaveLength(0);
});

/** Helper: assert value is not null */
function assert_not_null<T>(value: T | null): asserts value is T {
  if (value === null) {
    throw new Error("Expected value to not be null");
  }
}
