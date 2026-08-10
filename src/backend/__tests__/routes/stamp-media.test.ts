import { expect, test } from "bun:test";
import { Hono } from "hono";

import mediaRoutes from "../../routes/media.ts";
import type { Env, Variables } from "../../types.ts";

const APP_URL = "https://yuru.test";
const SHA256 = "a".repeat(64);
const KEY = `stamps/sha256/aa/${SHA256}.webp`;

function appAndEnv() {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.route("/media", mediaRoutes);
  const env = {
    APP_URL,
    MEDIA: {
      async get(key: string) {
        if (key !== KEY) return null;
        return {
          body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
          httpMetadata: { contentType: "image/webp" },
          httpEtag: '"r2-etag"',
        };
      },
    },
  } as unknown as Env;
  return { app, env };
}

test("content-addressed Stamp assets are publicly immutable and conditional", async () => {
  const { app, env } = appAndEnv();
  const url = `${APP_URL}/media/stamps/${SHA256}.webp`;

  const response = await app.fetch(new Request(url), env);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("image/webp");
  expect(response.headers.get("Cache-Control")).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(response.headers.get("ETag")).toBe(`"sha256-${SHA256}"`);
  expect(await response.arrayBuffer()).toEqual(
    new Uint8Array([1, 2, 3]).buffer,
  );

  const conditional = await app.fetch(
    new Request(url, {
      headers: { "If-None-Match": `"sha256-${SHA256}"` },
    }),
    env,
  );
  expect(conditional.status).toBe(304);
  expect(await conditional.text()).toBe("");
});

test("Stamp media path rejects non-digest and mismatched extensions", async () => {
  const { app, env } = appAndEnv();
  expect(
    (
      await app.fetch(
        new Request(`${APP_URL}/media/stamps/not-a-digest.webp`),
        env,
      )
    ).status,
  ).toBe(404);
  expect(
    (await app.fetch(new Request(`${APP_URL}/media/stamps/${SHA256}.svg`), env))
      .status,
  ).toBe(404);
});
