import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { legacyRedirectMiddleware } from "./legacy-redirect";

const makeApp = () => {
  const app = new Hono();
  app.use("*", legacyRedirectMiddleware);
  app.get("*", (c) => c.text("ok"));
  app.post("*", (c) => c.text("ok"));
  return app;
};

describe("legacyRedirectMiddleware", () => {
  it("redirects /friends -> /connections", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/friends"));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.test/connections");
  });

  it("redirects /friend-requests -> /follow-requests and preserves query", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/friend-requests?x=1"));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.test/follow-requests?x=1");
  });

  it("redirects /dm -> /chat", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/dm"));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.test/chat");
  });

  it("redirects /dm/:id -> /chat/dm/:id", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/dm/abc"));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.test/chat/dm/abc");
  });

  it("redirects /c/:id/chat -> /chat/community/:id", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/c/123/chat"));
    expect(res.status).toBe(308);
    expect(res.headers.get("Location")).toBe("https://example.test/chat/community/123");
  });

  it("ignores non-GET methods", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/friends", { method: "POST" }));
    expect(res.status).toBe(200);
  });

  it("passes through non-legacy paths", async () => {
    const app = makeApp();
    const res = await app.fetch(new Request("https://example.test/chat"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

