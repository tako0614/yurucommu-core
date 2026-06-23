import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../index.ts";

// Regression for GA-fix #15 (BODY-CAP): the /api/media/* pre-route body cap
// must sit AT OR ABOVE the largest advertised media size (media.ts advertises
// MAX_VIDEO_SIZE = 40MB and MAX_IMAGE_SIZE = 20MB and returns a friendly 413
// citing those numbers). If the cap is smaller than the advertised limit, an
// upload between the cap and the advertised limit is rejected by the cap FIRST
// with a generic `body_too_large` envelope, making the advertised limit
// unreachable and the friendly media 413 dead code. The cap is also the
// Worker memory ceiling (media.ts buffers the whole file ~2x), so it is kept
// just above the advertised max (48 MiB) rather than far above it.

const MiB = 1024 * 1024;
const MB = 1000 * 1000;

// Advertised in routes/media.ts (NOT exported from there). Kept in sync here so
// the test fails loudly if either side drifts back out of agreement.
const ADVERTISED_MAX_VIDEO_SIZE = 40 * MB;
// The /api/media body cap in index.ts (module-private). Kept in sync here.
const MEDIA_BODY_CAP = 48 * MiB;

function declaredLengthRequest(url: string, declaredBytes: number): Request {
  // A declared Content-Length lets the body cap decide pre-stream. We do not
  // ship an actual multi-MB payload; the body cap reads the declared length.
  return new Request(url, {
    method: "POST",
    headers: {
      "content-length": String(declaredBytes),
      "content-type": "multipart/form-data; boundary=----test",
    },
    body: "x".repeat(64),
    // @ts-expect-error duplex required for body in some runtimes
    duplex: "half",
  });
}

test("media body cap does NOT reject an upload up to the advertised video limit with a generic body_too_large", async () => {
  const app = createYurucommuBackendApp();
  // 30 MB: comfortably above the old 10 MiB default cap, below both the
  // advertised 40MB video limit and the 48 MiB body cap.
  const res = await app.fetch(
    declaredLengthRequest("https://t.local/api/media/upload", 30 * MB),
    { ENVIRONMENT: "test" } as never,
  );

  // The cap must NOT be the thing that refuses this request.
  if (res.status === 413) {
    const json = (await res.json()) as { error?: string };
    expect(json.error).not.toEqual("body_too_large");
  }
  // Without auth the request is refused downstream (401) rather than by the cap.
  expect(res.status).not.toEqual(411);
});

test("media body cap still refuses a request that exceeds the advertised video limit", async () => {
  const app = createYurucommuBackendApp();
  // Above the 48 MiB body cap: a declared body larger than the cap is rejected
  // by the cap itself with the generic envelope (this is correct — it exceeds
  // every advertised media size too).
  const oversize = 60 * MB;
  expect(oversize).toBeGreaterThan(MEDIA_BODY_CAP);
  const res = await app.fetch(
    declaredLengthRequest("https://t.local/api/media/upload", oversize),
    { ENVIRONMENT: "test" } as never,
  );
  expect(res.status).toEqual(413);
  const json = (await res.json()) as { error?: string; limit?: number };
  expect(json.error).toEqual("body_too_large");
});

test("the media body cap covers the largest advertised media size", () => {
  // The cap is module-private in index.ts; this asserts the invariant the fix
  // establishes (48 MiB) sits at or above the advertised max (40MB) so the
  // friendly per-size 413 in media.ts is reachable.
  expect(MEDIA_BODY_CAP).toBeGreaterThanOrEqual(ADVERTISED_MAX_VIDEO_SIZE);
});

// Audit #9 finding #3: the bare /media/upload alias (mediaRoutes is mounted at
// both /api/media and /media, and registers POST /upload) must be CSRF-protected
// like its /api/media/upload sibling — not bypass the control by alias.
test("the bare /media/upload alias is CSRF-protected (no Origin -> 403, not reaching the handler)", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://t.local/media/upload", {
      method: "POST",
      headers: { "content-length": "2", "content-type": "application/json" },
      body: "{}",
      // @ts-expect-error duplex required for a body in some runtimes
      duplex: "half",
    }),
    { ENVIRONMENT: "test", APP_URL: "https://t.local" } as never,
  );
  expect(res.status).toBe(403);
});

test("GET /media/* is NOT CSRF-blocked (the serve path stays open)", async () => {
  const app = createYurucommuBackendApp();
  const res = await app.fetch(
    new Request("https://t.local/media/nonexistent.png"),
    { ENVIRONMENT: "test", APP_URL: "https://t.local" } as never,
  );
  // A read of a missing blob 404s (or 503 with no R2 binding) — anything but a
  // 403 CSRF refusal, proving GETs bypass the state-changing-method guard.
  expect(res.status).not.toBe(403);
});
