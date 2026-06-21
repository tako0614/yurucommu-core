import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../index.ts";

function parseFields(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

test("security.txt is RFC 9116 compliant (real Contact, future Expires, non-circular Policy)", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/.well-known/security.txt"),
    { APP_URL: "https://test.local" } as never,
  );

  expect(res.status).toEqual(200);
  expect(res.headers.get("content-type")).toContain("text/plain");

  const body = await res.text();
  const fields = parseFields(body);

  // Contact is REQUIRED and must be a usable channel — never the .invalid stub.
  expect(fields.Contact).toBeTruthy();
  expect(fields.Contact).not.toContain(".invalid");

  // Expires is REQUIRED and must be a future ISO 8601 instant.
  expect(fields.Expires).toBeTruthy();
  const expiresMs = Date.parse(fields.Expires);
  expect(Number.isNaN(expiresMs)).toBe(false);
  expect(expiresMs).toBeGreaterThan(Date.now());

  // Policy must not point circularly back at security.txt itself.
  expect(fields.Policy ?? "").not.toContain("/.well-known/security.txt");
});

test("security.txt Contact honours the SECURITY_CONTACT operator override", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://test.local/.well-known/security.txt"),
    {
      APP_URL: "https://test.local",
      SECURITY_CONTACT: "mailto:abuse@test.local",
    } as never,
  );
  const fields = parseFields(await res.text());
  expect(fields.Contact).toEqual("mailto:abuse@test.local");
});
