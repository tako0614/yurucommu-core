import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { createYurucommuBackendApp } from "../index.ts";

Deno.test("backend CSP omits Takos origins when TAKOS_URL is not configured", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/"),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: {},
    } as never,
  );

  assertEquals(res.status, 503);
  const csp = res.headers.get("Content-Security-Policy");
  assert(csp);
  if (csp.includes("takos.jp")) {
    throw new Error(
      "CSP must not hardcode takos.jp when Takos integration is disabled",
    );
  }
  if (csp.includes("script-src 'self' 'unsafe-inline'")) {
    throw new Error("CSP must not allow inline scripts");
  }
});

Deno.test("backend CSP includes the configured Accounts issuer when enabled", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/"),
    {
      APP_URL: "https://test.local",
      OIDC_ISSUER_URL: "https://accounts.example.com",
      DB_INSTANCE: {},
    } as never,
  );

  assertEquals(res.status, 503);
  const csp = res.headers.get("Content-Security-Policy");
  assert(csp);
  assertStringIncludes(csp, "https://accounts.example.com");
  if (csp.includes("script-src 'self' 'unsafe-inline'")) {
    throw new Error("CSP must not allow inline scripts");
  }
});

Deno.test("backend healthz reports degraded runtime bindings before DB middleware", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/healthz"),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: {},
    } as never,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    status: "degraded",
    service: "yurucommu",
    missingBindings: [
      "MEDIA",
      "KV",
      "DELIVERY_QUEUE",
      "DELIVERY_DLQ",
      "ENCRYPTION_KEY",
      "AUTH_METHOD",
    ],
  });
});

Deno.test("backend readyz reports missing runtime bindings before DB middleware", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/readyz"),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: {},
    } as never,
  );

  assertEquals(res.status, 503);
  assertEquals(await res.json(), {
    status: "misconfigured",
    service: "yurucommu",
    missingBindings: [
      "MEDIA",
      "KV",
      "DELIVERY_QUEUE",
      "DELIVERY_DLQ",
      "ENCRYPTION_KEY",
      "AUTH_METHOD",
    ],
  });
});

Deno.test("backend readyz accepts Accounts OIDC as a provisioned auth method", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/readyz"),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: {},
      MEDIA: {},
      KV: {},
      DELIVERY_QUEUE: {},
      DELIVERY_DLQ: {},
      ENCRYPTION_KEY: "test-encryption-key",
      OIDC_ISSUER_URL: "https://accounts.example.com",
      CLIENT_ID: "client",
      CLIENT_SECRET: "secret",
    } as never,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    status: "ok",
    service: "yurucommu",
    missingBindings: [],
  });
});

Deno.test("backend healthz can be strict after bootstrap", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/healthz"),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: {},
      YURUCOMMU_STRICT_READINESS: "1",
    } as never,
  );

  assertEquals(res.status, 503);
  assertEquals(await res.json(), {
    status: "misconfigured",
    service: "yurucommu",
    missingBindings: [
      "MEDIA",
      "KV",
      "DELIVERY_QUEUE",
      "DELIVERY_DLQ",
      "ENCRYPTION_KEY",
      "AUTH_METHOD",
    ],
  });
});
