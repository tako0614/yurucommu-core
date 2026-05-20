import { Hono } from "hono";
import { assertEquals } from "jsr:@std/assert";
import { csrfProtection } from "../../middleware/csrf.ts";
import type { Env, Variables } from "../../types.ts";

function createApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("/api/*", csrfProtection());
  app.post("/api/resource", (c) => c.json({ ok: true }));
  return app;
}

Deno.test("csrfProtection permits cookie-less bearer API requests without browser origin", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://test.local/api/resource", {
      method: "POST",
      headers: { Authorization: "Bearer service-token" },
    }),
    { APP_URL: "https://test.local" } as never,
  );

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("csrfProtection keeps Origin checks for cookie-backed requests with Authorization", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://test.local/api/resource", {
      method: "POST",
      headers: {
        Authorization: "Bearer attacker-controlled",
        Cookie: "session=session-id",
      },
    }),
    { APP_URL: "https://test.local" } as never,
  );

  assertEquals(res.status, 403);
  assertEquals(await res.json(), {
    error: "CSRF validation failed: missing Origin header",
  });
});

Deno.test("csrfProtection still rejects state-changing API requests missing Origin", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://test.local/api/resource", { method: "POST" }),
    { APP_URL: "https://test.local" } as never,
  );

  assertEquals(res.status, 403);
  assertEquals(await res.json(), {
    error: "CSRF validation failed: missing Origin header",
  });
});

// Wave M-D: CSRF_ALLOWED_ORIGINS env で dev hostname を allowlist に append。
// APP_URL の origin と CSRF_ALLOWED_ORIGINS の comma-separated entries の union
// が allowed origin set。 既存 production 動作は CSRF_ALLOWED_ORIGINS 未設定で
// 維持される (= 下の 2 test と上の existing test で確認)。

Deno.test("csrfProtection (backward compat): CSRF_ALLOWED_ORIGINS 未設定なら APP_URL の origin のみ accept", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://test.local/api/resource", {
      method: "POST",
      headers: {
        Origin: "https://yurucommu.test",
        Cookie: "session=session-id",
      },
    }),
    { APP_URL: "https://test.local" } as never,
  );

  // APP_URL=https://test.local のみが allowlist、 dev hostname は reject。
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "CSRF validation failed" });
});

Deno.test("csrfProtection (Wave M-D multi-origin): CSRF_ALLOWED_ORIGINS で追加 origin を accept", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://test.local/api/resource", {
      method: "POST",
      headers: {
        Origin: "https://yurucommu.test",
        Cookie: "session=session-id",
      },
    }),
    {
      APP_URL: "https://test.local",
      CSRF_ALLOWED_ORIGINS: "https://yurucommu.test, https://other.example",
    } as never,
  );

  // dev hostname が allowlist に append されたので accept。
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("csrfProtection (Wave M-D multi-origin): allowlist 外の origin は reject 継続", async () => {
  const app = createApp();
  const res = await app.fetch(
    new Request("https://test.local/api/resource", {
      method: "POST",
      headers: {
        Origin: "https://attacker.example",
        Cookie: "session=session-id",
      },
    }),
    {
      APP_URL: "https://test.local",
      CSRF_ALLOWED_ORIGINS: "https://yurucommu.test",
    } as never,
  );

  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "CSRF validation failed" });
});
