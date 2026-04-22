import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import { assertSpyCalls, spy, stub } from "jsr:@std/testing/mock";
import { FakeTime } from "jsr:@std/testing/time";
import authRoutes from "../../routes/auth.ts";
import { LOGIN_LOCKOUT_CONFIG } from "../../lib/auth-lockout.ts";
import { hashPassword } from "../../lib/crypto.ts";

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

    const mockGet = spy(() => Promise.resolve(actorData));
    const mockWhere = spy(() => ({ get: mockGet }));
    const mockFrom = spy(() => ({ where: mockWhere, get: mockGet }));
    const mockSelect = spy(() => ({ from: mockFrom }));

    type ThenResolve = ((value: unknown) => unknown) | null | undefined;

    const mockInsertValues = spy(() => ({
      returning: spy(() => ({
        get: spy(() => Promise.resolve(actorData)),
      })),
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

Deno.test("auth login lockout - locks out after 5 failed login attempts", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.24" };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(app, env, "/api/auth/login", {
        password: "wrong-password",
      }, headers);
      assertEquals(res.status, 401);
    }

    const { res: lockoutRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    assertEquals(lockoutRes.status, 429);
    assert_not_null(lockoutRes.headers.get("Retry-After"));

    const { res: blockedRes } = await request(app, env, "/api/auth/login", {
      password: "correct-password",
    }, headers);
    assertEquals(blockedRes.status, 429);
  } finally {
    time.restore();
  }
});

Deno.test("auth login lockout - clears lockout state after successful login", async () => {
  const hashedPassword = await hashPassword("correct-password");
  const time = new FakeTime(new Date("2026-02-18T00:00:00.000Z"));
  try {
    const { app, env } = createAuthTestApp(hashedPassword);
    const headers = { "CF-Connecting-IP": "198.51.100.25" };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(app, env, "/api/auth/login", {
        password: "wrong-password",
      }, headers);
      assertEquals(res.status, 401);
    }

    const { res: successRes } = await request(app, env, "/api/auth/login", {
      password: "correct-password",
    }, headers);
    assertEquals(successRes.status, 200);

    const { res: retryRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    assertEquals(retryRes.status, 401);
  } finally {
    time.restore();
  }
});

Deno.test("auth login lockout - allows retries again after lockout window passes", async () => {
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
    assertEquals(lockedRes.status, 429);

    time.tick(LOGIN_LOCKOUT_CONFIG.lockoutMs + 1_000);

    const { res: postWindowRes } = await request(app, env, "/api/auth/login", {
      password: "wrong-password",
    }, headers);
    assertEquals(postWindowRes.status, 401);
  } finally {
    time.restore();
  }
});

/** Helper: assert value is not null */
function assert_not_null<T>(value: T | null): asserts value is T {
  if (value === null) {
    throw new Error("Expected value to not be null");
  }
}
