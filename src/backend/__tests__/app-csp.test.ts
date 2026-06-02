import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../index.ts";

test("backend CSP omits Takos origins when TAKOS_URL is not configured", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
  } as never);

  expect(res.status).toEqual(503);
  const csp = res.headers.get("Content-Security-Policy");
  expect(csp).toBeTruthy();
  if (!csp) throw new Error("missing Content-Security-Policy header");
  if (csp.includes("takos.jp")) {
    throw new Error(
      "CSP must not hardcode takos.jp when Takos integration is disabled",
    );
  }
  if (csp.includes("script-src 'self' 'unsafe-inline'")) {
    throw new Error("CSP must not allow inline scripts");
  }
});

test("backend CSP does not list unpkg.com in script-src (only connect-src for FFmpeg fetch)", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
  } as never);

  const csp = res.headers.get("Content-Security-Policy");
  expect(csp).toBeTruthy();
  if (!csp) throw new Error("missing Content-Security-Policy header");
  const scriptSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("script-src "));
  expect(scriptSrc).toBeTruthy();
  if (!scriptSrc) throw new Error("missing script-src directive");
  if (scriptSrc.includes("unpkg.com")) {
    throw new Error(
      "script-src must not whitelist unpkg.com: compromised npm packages would become executable on this origin",
    );
  }
  // connect-src may still list unpkg.com because toBlobURL() fetches the
  // FFmpeg core from there and wraps the body in a blob: URL before import.
  const connectSrc = csp
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith("connect-src "));
  expect(connectSrc).toBeTruthy();
  expect(connectSrc).toContain("https://unpkg.com");
});

test("backend CSP includes the configured Accounts issuer when enabled", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/"), {
    APP_URL: "https://test.local",
    OIDC_ISSUER_URL: "https://accounts.example.com",
    DB_INSTANCE: {},
  } as never);

  expect(res.status).toEqual(503);
  const csp = res.headers.get("Content-Security-Policy");
  expect(csp).toBeTruthy();
  if (!csp) throw new Error("missing Content-Security-Policy header");
  expect(csp).toContain("https://accounts.example.com");
  if (csp.includes("script-src 'self' 'unsafe-inline'")) {
    throw new Error("CSP must not allow inline scripts");
  }
});

test("backend healthz reports degraded runtime bindings before DB middleware", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/healthz"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
  } as never);

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({
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

test("backend readyz reports missing runtime bindings before DB middleware", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/readyz"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
  } as never);

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({
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

test("backend readyz accepts Accounts OIDC as a provisioned auth method", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/readyz"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
    MEDIA: {},
    KV: {},
    DELIVERY_QUEUE: {},
    DELIVERY_DLQ: {},
    ENCRYPTION_KEY: "test-encryption-key",
    OIDC_ISSUER_URL: "https://accounts.example.com",
    OIDC_CLIENT_ID: "client",
    OIDC_CLIENT_SECRET: "secret",
  } as never);

  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({
    status: "ok",
    service: "yurucommu",
    missingBindings: [],
  });
});

test("backend healthz can be strict after bootstrap", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/healthz"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
    YURUCOMMU_STRICT_READINESS: "1",
  } as never);

  expect(res.status).toEqual(503);
  expect(await res.json()).toEqual({
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
