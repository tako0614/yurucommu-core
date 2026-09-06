import { expect, test } from "bun:test";
import { Hono } from "hono";

import { withCache } from "../../middleware/cache.ts";

test("a public actor response remains available when the runtime has no cache configured", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      get default() {
        throw new Error("No Cache was configured");
      },
    },
  });

  try {
    const app = new Hono();
    app.onError(() => new Response("Internal error", { status: 500 }));
    const actor = { id: "https://yuru.test/ap/users/cache-unconfigured" };
    app.get("/ap/users/cache-unconfigured", withCache({ ttl: 60 }), (c) =>
      c.json(actor),
    );

    const first = await app.request(actor.id);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual(actor);
    expect(first.headers.get("X-Cache")).toBe("MISS");

    const second = await app.request(actor.id);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(actor);
    expect(second.headers.get("X-Cache")).toBe("HIT");
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else Reflect.deleteProperty(globalThis, "caches");
  }
});

test("an unrelated cache getter failure is not disguised as an unavailable cache", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "caches");
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      get default() {
        throw new Error("Unexpected cache state");
      },
    },
  });

  try {
    const app = new Hono();
    app.onError(() => new Response("Internal error", { status: 500 }));
    app.get("/cache-unexpected-error", withCache({ ttl: 60 }), (c) =>
      c.json({ ok: true }),
    );
    const res = await app.request("https://yuru.test/cache-unexpected-error");
    expect(res.status).toBe(500);
    expect(res.headers.get("X-Cache")).toBeNull();
  } finally {
    if (original) Object.defineProperty(globalThis, "caches", original);
    else Reflect.deleteProperty(globalThis, "caches");
  }
});
