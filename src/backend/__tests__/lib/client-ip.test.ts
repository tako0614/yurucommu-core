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

// Variant that passes an ExecutionContext whose props carry the server-stamped
// socket IP (as the Bun entrypoint does), to exercise the per-connection fallback.
async function whoamiCtx(
  env: Record<string, unknown>,
  headers: Record<string, string>,
  props: Record<string, unknown>,
): Promise<string> {
  const app = makeApp();
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props,
  } as unknown as ExecutionContext;
  const res = await app.fetch(
    new Request("https://test.local/whoami", { method: "GET", headers }),
    env,
    ctx,
  );
  return await res.text();
}

test("CF-Connecting-IP is ignored when TAKOS_TRUST_PROXY is unset", async () => {
  // Non-Cloudflare deployments do not strip a client-supplied
  // CF-Connecting-IP, so it must not be trusted without operator opt-in.
  expect(await whoami({}, { "CF-Connecting-IP": "203.0.113.10" })).toEqual(
    "unknown",
  );
});

test("CF-Connecting-IP is honoured when TAKOS_TRUST_PROXY=true", async () => {
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "true" },
      { "CF-Connecting-IP": "203.0.113.10" },
    ),
  ).toEqual("203.0.113.10");
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

test("legacy trust prefers the proxy-stamped XFF over a client-supplied CF-Connecting-IP", async () => {
  // SECURITY (#4): a generic proxy stamps XFF but neither sets nor strips the
  // Cloudflare-specific CF-Connecting-IP, so a client-supplied copy must NOT
  // override the trustworthy XFF. (Previously CF-Connecting-IP wrongly won.)
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "true" },
      {
        "CF-Connecting-IP": "203.0.113.40",
        "X-Forwarded-For": "203.0.113.41",
      },
    ),
  ).toEqual("203.0.113.41");
});

test("generic mode honours XFF and IGNORES a client-supplied CF-Connecting-IP", async () => {
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "generic" },
      {
        "CF-Connecting-IP": "203.0.113.40",
        "X-Forwarded-For": "203.0.113.41",
      },
    ),
  ).toEqual("203.0.113.41");
});

test("generic mode does NOT honour CF-Connecting-IP even when no XFF is present", async () => {
  // A generic reverse proxy that forwards no XFF still must not trust the
  // client-settable Cloudflare header — fall through to unknown instead.
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "generic" },
      { "CF-Connecting-IP": "203.0.113.40" },
    ),
  ).toEqual("unknown");
});

test("cf mode honours CF-Connecting-IP (cloudflared tunnel front)", async () => {
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "cf" },
      { "CF-Connecting-IP": "203.0.113.40" },
    ),
  ).toEqual("203.0.113.40");
});

test("Invalid IPs fall back to unknown", async () => {
  // Even with the edge/proxy trusted, a syntactically invalid header value
  // must not be returned verbatim.
  expect(
    await whoami(
      { TAKOS_TRUST_PROXY: "true" },
      { "CF-Connecting-IP": "not-an-ip" },
    ),
  ).toEqual("unknown");
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

test("server-stamped socket IP (props) is used as a last resort, no opt-in needed", async () => {
  expect(await whoamiCtx({}, {}, { socketIp: "198.51.100.7" })).toEqual(
    "198.51.100.7",
  );
});

test("socket IP comes ONLY from props, never a client-supplied header (unspoofable)", async () => {
  // A client setting a header cannot influence the bucket — the value is taken
  // from the server-side ExecutionContext props, not any request header.
  expect(await whoami({}, { "x-takos-socket-ip": "198.51.100.9" })).toEqual(
    "unknown",
  );
  expect(await whoamiCtx({}, { "x-takos-socket-ip": "1.1.1.1" }, {})).toEqual(
    "unknown",
  );
});

test("a trusted CF-Connecting-IP wins over the socket-IP fallback", async () => {
  expect(
    await whoamiCtx(
      { TAKOS_TRUST_PROXY: "true" },
      { "CF-Connecting-IP": "203.0.113.60" },
      { socketIp: "198.51.100.7" },
    ),
  ).toEqual("203.0.113.60");
});

test("an invalid socket IP in props falls back to unknown", async () => {
  expect(await whoamiCtx({}, {}, { socketIp: "not-an-ip" })).toEqual("unknown");
  expect(await whoamiCtx({}, {}, { socketIp: 12345 })).toEqual("unknown");
});
