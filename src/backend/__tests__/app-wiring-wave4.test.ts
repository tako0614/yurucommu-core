import { expect, test } from "bun:test";
import { createYurucommuBackendApp } from "../index.ts";
import { getAuthConfig } from "../lib/oauth-providers.ts";

// Wave-4 WIRING cluster regression coverage for src/backend/index.ts.

const freshInstallEnv = {
  // A correctly-provisioned fresh install: required preconditions satisfied,
  // optional media / federation-delivery capabilities not yet bound.
  APP_URL: "https://test.local",
  DB_INSTANCE: {},
  KV: {},
  ENCRYPTION_KEY: "test-encryption-key",
  AUTH_PASSWORD_HASH: "argon2-hash",
} as never;

test("readyz passes for a fresh install without MEDIA / delivery queues", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/readyz"),
    freshInstallEnv,
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    status: string;
    missingBindings: string[];
  };
  expect(body.status).toEqual("ok");
  // Optional capabilities are still surfaced for visibility, but they do not
  // flip the worker to not-ready.
  expect(body.missingBindings).toEqual([
    "MEDIA",
    "DELIVERY_QUEUE",
    "DELIVERY_DLQ",
  ]);
});

test("readyz treats a PUBLIC OIDC client (issuer + client_id, no secret) as a valid auth method", async () => {
  const app = createYurucommuBackendApp();
  // No password / Google / X — only a Takosumi PUBLIC OIDC client (PKCE-only,
  // no client secret), as auto-materialized for a Capsule. It must satisfy the
  // AUTH_METHOD readiness gate so an auto-provisioned install comes up ready.
  const res = await app.fetch(new Request("https://test.local/readyz"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
    KV: {},
    ENCRYPTION_KEY: "test-encryption-key",
    TAKOSUMI_ACCOUNTS_ISSUER_URL: "https://app.takosumi.test",
    TAKOSUMI_ACCOUNTS_CLIENT_ID: "toc_public_client",
  } as never);
  expect(res.status).toEqual(200);
});

test("getAuthConfig offers the Takosumi provider for a secret-less public client", () => {
  const config = getAuthConfig({
    TAKOSUMI_ACCOUNTS_ISSUER_URL: "https://app.takosumi.test",
    TAKOSUMI_ACCOUNTS_CLIENT_ID: "toc_public_client",
    // no TAKOSUMI_ACCOUNTS_CLIENT_SECRET
  } as never);
  const takos = config.providers.find((p) => p.id === "takos");
  expect(takos).toBeDefined();
  expect(takos!.issuer).toEqual("https://app.takosumi.test");
  expect(takos!.jwksUrl).toEqual("https://app.takosumi.test/oauth/jwks");
});

test("readyz still 503s when a required precondition is missing", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(new Request("https://test.local/readyz"), {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
    KV: {},
    ENCRYPTION_KEY: "test-encryption-key",
    // No auth method configured -> AUTH_METHOD missing -> not ready.
  } as never);
  expect(res.status).toEqual(503);
});

test("robots.txt disallows api/ap surface and answers before payload validation", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/robots.txt"),
    freshInstallEnv,
  );
  expect(res.status).toEqual(200);
  expect(res.headers.get("Content-Type")).toContain("text/plain");
  const text = await res.text();
  expect(text).toContain("User-agent: *");
  expect(text).toContain("Disallow: /api/");
  expect(text).toContain("Disallow: /ap/");
});

test("security.txt exposes a contact line", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/.well-known/security.txt"),
    freshInstallEnv,
  );
  expect(res.status).toEqual(200);
  expect(res.headers.get("Content-Type")).toContain("text/plain");
  const text = await res.text();
  expect(text).toMatch(/^Contact:/m);
  // RFC 9116: Expires is required; Policy must not point circularly at this file.
  expect(text).toMatch(/^Expires:/m);
  expect(text).not.toContain(
    "Policy: https://test.local/.well-known/security.txt",
  );
});

test("a >1MiB body to /media/upload is NOT rejected by the default 1MiB cap", async () => {
  // The bare /media mount must share the larger media body cap so that an
  // advertised-size upload posted to /media/upload is not killed by the 1 MiB
  // default cap before media.ts can run its own per-size validation.
  const app = createYurucommuBackendApp();
  const oversizedForDefaultCap = new Uint8Array(2 * 1024 * 1024); // 2 MiB
  const res = await app.fetch(
    new Request("https://test.local/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: oversizedForDefaultCap,
    }),
    freshInstallEnv,
  );
  // It must not be the generic body-cap 413 from the default 1 MiB limit.
  // (Downstream it may be rejected for auth/format reasons, but not 413.)
  expect(res.status).not.toEqual(413);
});
