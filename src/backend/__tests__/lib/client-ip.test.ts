import { assertEquals } from "jsr:@std/assert";
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

Deno.test("CF-Connecting-IP is always honoured (set by the edge)", async () => {
  assertEquals(
    await whoami({}, { "CF-Connecting-IP": "203.0.113.10" }),
    "203.0.113.10",
  );
});

Deno.test(
  "X-Forwarded-For is ignored when TAKOS_TRUST_PROXY is unset",
  async () => {
    assertEquals(
      await whoami({}, { "X-Forwarded-For": "203.0.113.20" }),
      "unknown",
    );
    assertEquals(
      await whoami({}, { "X-Real-IP": "203.0.113.21" }),
      "unknown",
    );
  },
);

Deno.test(
  "X-Forwarded-For / X-Real-IP are honoured when TAKOS_TRUST_PROXY=true",
  async () => {
    assertEquals(
      await whoami(
        { TAKOS_TRUST_PROXY: "true" },
        { "X-Forwarded-For": "203.0.113.30, 10.0.0.1" },
      ),
      "203.0.113.30",
    );
    assertEquals(
      await whoami(
        { TAKOS_TRUST_PROXY: "true" },
        { "X-Real-IP": "203.0.113.31" },
      ),
      "203.0.113.31",
    );
  },
);

Deno.test(
  "CF-Connecting-IP wins even when proxy headers are trusted",
  async () => {
    assertEquals(
      await whoami(
        { TAKOS_TRUST_PROXY: "true" },
        {
          "CF-Connecting-IP": "203.0.113.40",
          "X-Forwarded-For": "203.0.113.41",
        },
      ),
      "203.0.113.40",
    );
  },
);

Deno.test("Invalid IPs fall back to unknown", async () => {
  assertEquals(
    await whoami({}, { "CF-Connecting-IP": "not-an-ip" }),
    "unknown",
  );
});

Deno.test(
  "TAKOS_TRUST_PROXY=false / 0 / unset all reject proxy headers",
  async () => {
    assertEquals(
      await whoami(
        { TAKOS_TRUST_PROXY: "false" },
        { "X-Forwarded-For": "203.0.113.50" },
      ),
      "unknown",
    );
    assertEquals(
      await whoami(
        { TAKOS_TRUST_PROXY: "0" },
        { "X-Forwarded-For": "203.0.113.51" },
      ),
      "unknown",
    );
  },
);
