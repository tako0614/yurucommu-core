import { expect, test } from "bun:test";

import { Hono } from "hono";

import { getClientIP } from "../../lib/client-ip.ts";
import type { Env, Variables } from "../../types.ts";

function makeApp() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.get("/whoami", (c) => c.text(getClientIP(c)));
  return app;
}

async function whoami(
  env: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<string> {
  const app = makeApp();
  const res = await app.fetch(
    new Request("https://test.local/whoami", { method: "GET", headers }),
    env,
  );
  return await res.text();
}

test("CF-Connecting-IP is always honoured (set by the edge)", async () => {
  expect(await whoami({}, { "CF-Connecting-IP": "203.0.113.10" })).toEqual(
    "203.0.113.10",
  );
});

test("X-Forwarded-For is ignored when TAKOS_TRUST_PROXY is unset", async () => {
  expect(await whoami({}, { "X-Forwarded-For": "203.0.113.20" })).toEqual(
    "unknown",
  );
  expect(await whoami({}, { "X-Real-IP": "203.0.113.21" })).toEqual("unknown");
});

test("X-Forwarded-For / X-Real-IP are honoured when TAKOS_TRUST_PROXY=true", async () => {
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "true" },
      { "X-Forwarded-For": "203.0.113.30, 10.0.0.1" },
    ),
  ).toEqual("203.0.113.30");
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "true" },
      { "X-Real-IP": "203.0.113.31" },
    ),
  ).toEqual("203.0.113.31");
});

test("CF-Connecting-IP wins even when proxy headers are trusted", async () => {
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "true" },
      {
        "CF-Connecting-IP": "203.0.113.40",
        "X-Forwarded-For": "203.0.113.41",
      },
    ),
  ).toEqual("203.0.113.40");
});

test("Invalid IPs fall back to unknown", async () => {
  expect(await whoami({}, { "CF-Connecting-IP": "not-an-ip" })).toEqual(
    "unknown",
  );
});

test("TAKOS_TRUST_PROXY=false / 0 / unset all reject proxy headers", async () => {
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "false" },
      { "X-Forwarded-For": "203.0.113.50" },
    ),
  ).toEqual("unknown");
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "0" },
      { "X-Forwarded-For": "203.0.113.51" },
    ),
  ).toEqual("unknown");
});
