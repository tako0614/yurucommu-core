import { expect, test } from "bun:test";
import { Hono } from "hono";

import { rateLimit, RateLimitConfigs } from "../../middleware/rate-limit.ts";

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
  headers: Record<string, string>,
) {
  const res = await app.fetch(
    new Request(`https://test.local${path}`, { method: "GET", headers }),
    env,
  );
  await res.text();
  return res;
}

test("rateLimit middleware - shares counters across middleware instances via KV", async () => {
  const env = { KV: new MockKVNamespace() };
  const headers = { "CF-Connecting-IP": "203.0.113.10" };
  const config = { windowMs: 60_000, maxRequests: 2, keyPrefix: "test:" };

  const appA = new Hono();
  appA.use("/limited", rateLimit(config));
  appA.get("/limited", (c) => c.json({ ok: true }));

  const appB = new Hono();
  appB.use("/limited", rateLimit(config));
  appB.get("/limited", (c) => c.json({ ok: true }));

  const res1 = await request(appA, env, "/limited", headers);
  expect(res1.status).toEqual(200);
  expect(res1.headers.get("X-RateLimit-Remaining")).toEqual("1");

  const res2 = await request(appB, env, "/limited", headers);
  expect(res2.status).toEqual(200);
  expect(res2.headers.get("X-RateLimit-Remaining")).toEqual("0");

  const res3 = await request(appA, env, "/limited", headers);
  expect(res3.status).toEqual(429);
  expect(res3.headers.get("Retry-After")).not.toEqual(null);
});

test("rateLimit middleware - hardens auth limit to 20 requests per minute", () => {
  expect(RateLimitConfigs.auth.maxRequests).toEqual(20);
  expect(RateLimitConfigs.auth.windowMs).toEqual(60_000);
});

test("rateLimit middleware - unread-count polling endpoints skip KV entirely", async () => {
  const kv = new MockKVNamespace();
  let gets = 0;
  let puts = 0;
  const env = {
    KV: {
      get: (k: string) => (gets++, kv.get(k)),
      put: (k: string, v: string, o?: { expirationTtl?: number }) => (
        puts++,
        kv.put(k, v, o)
      ),
      delete: (k: string) => kv.delete(k),
    },
  };
  const headers = { "CF-Connecting-IP": "203.0.113.20" };
  const app = new Hono();
  app.use("/api/*", rateLimit({ windowMs: 60_000, maxRequests: 1 }));
  app.use("/api/dm/*", rateLimit(RateLimitConfigs.dm));
  app.get("/api/notifications/unread/count", (c) => c.json({ count: 0 }));
  app.get("/api/dm/unread/count", (c) => c.json({ count: 0 }));
  app.get("/api/other", (c) => c.json({ ok: true }));

  for (let i = 0; i < 5; i++) {
    const n = await request(
      app,
      env,
      "/api/notifications/unread/count",
      headers,
    );
    expect(n.status).toEqual(200);
    expect(n.headers.get("X-RateLimit-Limit")).toEqual(null);
    const d = await request(app, env, "/api/dm/unread/count", headers);
    expect(d.status).toEqual(200);
  }
  expect(gets).toEqual(0);
  expect(puts).toEqual(0);

  // Non-exempt routes are still limited through KV.
  expect((await request(app, env, "/api/other", headers)).status).toEqual(200);
  expect((await request(app, env, "/api/other", headers)).status).toEqual(429);
  expect(puts).toEqual(2);
});
