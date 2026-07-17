import { expect, test } from "bun:test";
import { Hono } from "hono";
import { rawSessionCredential } from "../../lib/session-actor.ts";
import type { Env, Variables } from "../../types.ts";

function app() {
  const instance = new Hono<{ Bindings: Env; Variables: Variables }>();
  instance.get("/credential", (c) =>
    c.json({ credential: rawSessionCredential(c) ?? null }),
  );
  return instance;
}

test("native bearer is a host session credential", async () => {
  const response = await app().request("/credential", {
    headers: { authorization: "Bearer native-session" },
  });
  expect(await response.json()).toEqual({ credential: "native-session" });
});

test("browser cookie wins over an added Authorization header", async () => {
  const response = await app().request("/credential", {
    headers: {
      cookie: "session=browser-session",
      authorization: "Bearer attacker-controlled",
    },
  });
  expect(await response.json()).toEqual({ credential: "browser-session" });
});
