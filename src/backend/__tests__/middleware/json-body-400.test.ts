import { expect, test } from "bun:test";
import { Hono } from "hono";

import { createErrorMiddleware } from "../../middleware/error-handler.ts";

// A malformed / empty JSON request body must surface as a 400 (client error),
// not a 500. `c.req.json()` throws a SyntaxError on bad input; the centralized
// error middleware maps any SyntaxError reaching it to BadRequestError (400),
// which fixes every handler that calls `await c.req.json()` without its own
// try/catch in one place. (Internal JSON parsing uses safeJsonParse, which
// never throws, so a SyntaxError here is always a request-body parse failure.)

function appWithJsonRoute() {
  const app = new Hono();
  app.onError(createErrorMiddleware({ logger: () => {} }));
  app.post("/echo", async (c) => {
    const body = await c.req.json<{ x?: number }>();
    return c.json({ ok: true, x: body.x });
  });
  return app;
}

async function post(
  app: Hono,
  body: string | undefined,
  contentType = "application/json",
) {
  const res = await app.fetch(
    new Request("https://test.local/echo", {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    }),
  );
  return res;
}

test("empty body → 400, not 500", async () => {
  const res = await post(appWithJsonRoute(), undefined);
  expect(res.status).toEqual(400);
});

test("non-JSON body → 400, not 500", async () => {
  const res = await post(appWithJsonRoute(), "this is not json");
  expect(res.status).toEqual(400);
});

test("truncated JSON → 400, not 500", async () => {
  const res = await post(appWithJsonRoute(), '{"x": 1');
  expect(res.status).toEqual(400);
});

test("valid JSON still works → 200", async () => {
  const res = await post(appWithJsonRoute(), '{"x": 5}');
  expect(res.status).toEqual(200);
  expect(await res.json()).toEqual({ ok: true, x: 5 });
});
