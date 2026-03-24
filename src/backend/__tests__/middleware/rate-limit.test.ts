import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit, RateLimitConfigs } from './rate-limit';

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
  headers: Record<string, string>
) {
  const res = await app.fetch(new Request(`https://test.local${path}`, { method: 'GET', headers }), env);
  await res.text();
  return res;
}

describe('rateLimit middleware', () => {
  it('shares counters across middleware instances via KV', async () => {
    const env = { KV: new MockKVNamespace() };
    const headers = { 'CF-Connecting-IP': '203.0.113.10' };
    const config = { windowMs: 60_000, maxRequests: 2, keyPrefix: 'test:' };

    const appA = new Hono();
    appA.use('/limited', rateLimit(config));
    appA.get('/limited', (c) => c.json({ ok: true }));

    const appB = new Hono();
    appB.use('/limited', rateLimit(config));
    appB.get('/limited', (c) => c.json({ ok: true }));

    const res1 = await request(appA, env, '/limited', headers);
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('1');

    const res2 = await request(appB, env, '/limited', headers);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('0');

    const res3 = await request(appA, env, '/limited', headers);
    expect(res3.status).toBe(429);
    expect(res3.headers.get('Retry-After')).not.toBeNull();
  });

  it('hardens auth limit to 20 requests per minute', () => {
    expect(RateLimitConfigs.auth.maxRequests).toBe(20);
    expect(RateLimitConfigs.auth.windowMs).toBe(60_000);
  });
});
