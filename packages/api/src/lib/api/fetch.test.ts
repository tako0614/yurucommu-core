import { expect, test } from "bun:test";

import { ApiError, assertOk } from "./fetch.ts";

test("assertOk preserves structured failure code and retry authority", async () => {
  const response = new Response(
    JSON.stringify({
      error: "Remote actor is temporarily unavailable",
      code: "ACTOR_UNAVAILABLE",
      retry_after: 120,
    }),
    {
      status: 503,
      headers: {
        "content-type": "application/json",
        "retry-after": "120",
      },
    },
  );

  let caught: unknown;
  try {
    await assertOk(response, "Actor not found");
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ApiError);
  expect(caught).toMatchObject({
    status: 503,
    message: "Remote actor is temporarily unavailable",
    code: "ACTOR_UNAVAILABLE",
    retryAfterSeconds: 120,
  });
});

test("assertOk ignores malformed public error metadata", async () => {
  const response = new Response(
    JSON.stringify({
      error: "safe message",
      code: { nested: "not a code" },
      retry_after: -50,
    }),
    { status: 502 },
  );

  await expect(assertOk(response, "fallback")).rejects.toMatchObject({
    status: 502,
    message: "safe message",
    code: null,
    retryAfterSeconds: null,
  });
});
