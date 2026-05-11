import { Hono } from "hono";
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCalls, spy, stub } from "jsr:@std/testing/mock";
import { requireBearerAuth } from "../../middleware/bearer-auth.ts";

function createApp() {
  const app = new Hono();
  app.post("/deploy", requireBearerAuth("apps:deploy"), (c) => {
    const token = c.get("oauthToken");
    assert(token);
    return c.json({ sub: token.sub });
  });
  return app;
}

Deno.test("requireBearerAuth fails closed when Accounts OIDC config is missing", async () => {
  const app = createApp();
  const fetchSpy = spy(globalThis, "fetch");

  try {
    const res = await app.fetch(
      new Request("https://test.local/deploy", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      }),
      {
        CLIENT_ID: "takos-client",
        CLIENT_SECRET: "takos-secret",
      } as never,
    );

    assertEquals(res.status, 500);
    assertSpyCalls(fetchSpy, 0);
  } finally {
    fetchSpy.restore();
  }
});

Deno.test("requireBearerAuth introspects against the configured Accounts issuer", async () => {
  const app = createApp();
  const fetchImpl = spy((_input: string | URL | Request) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          active: true,
          scope: "apps:deploy repos:read",
          sub: "user-1",
          client_id: "takos-client",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    )
  );
  const fetchStub = stub(globalThis, "fetch", fetchImpl);

  try {
    const res = await app.fetch(
      new Request("https://test.local/deploy", {
        method: "POST",
        headers: { Authorization: "Bearer token" },
      }),
      {
        OIDC_ISSUER_URL: "https://accounts.example.com",
        CLIENT_ID: "takos-client",
        CLIENT_SECRET: "takos-secret",
      } as never,
    );

    assertEquals(res.status, 200);
    assertEquals(await res.json(), { sub: "user-1" });
    assertSpyCalls(fetchImpl, 1);
    assertStringIncludes(
      String(fetchImpl.calls[0].args[0]),
      "https://accounts.example.com/oauth/introspect",
    );
  } finally {
    fetchStub.restore();
  }
});
