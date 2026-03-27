import { Hono } from 'hono';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import authRoutes from '../../routes/auth';
import { LOGIN_LOCKOUT_CONFIG } from '../../lib/auth-lockout';
import { hashPassword } from '../../lib/crypto';

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

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
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
  headers: Record<string, string>
) {
  const res = await app.fetch(new Request(`https://test.local${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  }), env);

  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { res, body: json };
}

let hashedPassword: string;

function createAuthTestApp(envOverrides: Record<string, unknown> = {}) {
  const env = {
    KV: new MockKVNamespace(),
    AUTH_PASSWORD_HASH: hashedPassword,
    APP_URL: 'https://test.yurucommu.com',
    ...envOverrides,
  };

  const app = new Hono();
  app.use('/api/auth/*', async (c, next) => {
    // Drizzle-style chainable mock for db operations:
    //   db.select().from().where().get() -> actor record
    //   db.insert().values() -> session insert (in rotateSession)
    //   db.delete().where() -> session delete (in rotateSession)
    const actorData = {
      apId: 'https://test.yurucommu.com/ap/users/tako',
      type: 'Person',
      preferredUsername: 'tako',
      name: 'tako',
      iconUrl: null,
      role: 'owner',
      takosUserId: 'password:owner',
    };

    const mockGet = vi.fn().mockResolvedValue(actorData);
    const mockWhere = vi.fn().mockReturnValue({ get: mockGet });
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere, get: mockGet });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

    type ThenResolve = ((value: unknown) => unknown) | null | undefined;

    const mockInsertValues = vi.fn().mockReturnValue({
      returning: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue(actorData),
      }),
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    });
    const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

    const mockDeleteWhere = vi.fn().mockReturnValue({
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    });
    const mockDelete = vi.fn().mockReturnValue({
      where: mockDeleteWhere,
      then: (resolve: ThenResolve) => Promise.resolve(undefined).then(resolve),
    });

    (c as unknown as { set: (key: string, value: unknown) => void }).set('db', {
      select: mockSelect,
      insert: mockInsert,
      delete: mockDelete,
    });
    await next();
  });
  app.route('/api/auth', authRoutes);

  return { app, env };
}

describe('auth login lockout', () => {
  beforeAll(async () => {
    hashedPassword = await hashPassword('correct-password');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-18T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('locks out after 5 failed login attempts', async () => {
    const { app, env } = createAuthTestApp();
    const headers = { 'CF-Connecting-IP': '198.51.100.24' };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
      expect(res.status).toBe(401);
    }

    const { res: lockoutRes } = await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
    expect(lockoutRes.status).toBe(429);
    expect(lockoutRes.headers.get('Retry-After')).not.toBeNull();

    const { res: blockedRes } = await request(app, env, '/api/auth/login', { password: 'correct-password' }, headers);
    expect(blockedRes.status).toBe(429);
  });

  it('clears lockout state after successful login', async () => {
    const { app, env } = createAuthTestApp();
    const headers = { 'CF-Connecting-IP': '198.51.100.25' };

    for (let i = 0; i < 4; i++) {
      const { res } = await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
      expect(res.status).toBe(401);
    }

    const { res: successRes } = await request(app, env, '/api/auth/login', { password: 'correct-password' }, headers);
    expect(successRes.status).toBe(200);

    const { res: retryRes } = await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
    expect(retryRes.status).toBe(401);
  });

  it('allows retries again after lockout window passes', async () => {
    const { app, env } = createAuthTestApp();
    const headers = { 'CF-Connecting-IP': '198.51.100.26' };

    for (let i = 0; i < LOGIN_LOCKOUT_CONFIG.maxFailedAttempts; i++) {
      await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
    }

    const { res: lockedRes } = await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
    expect(lockedRes.status).toBe(429);

    vi.advanceTimersByTime(LOGIN_LOCKOUT_CONFIG.lockoutMs + 1_000);

    const { res: postWindowRes } = await request(app, env, '/api/auth/login', { password: 'wrong-password' }, headers);
    expect(postWindowRes.status).toBe(401);
  });
});
