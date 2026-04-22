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
