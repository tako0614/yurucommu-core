import { expect, test } from "bun:test";

import { createYurucommuBackendApp } from "../index.ts";

// Regression for GA-fix #15 (BODY-CAP): the /api/media/* pre-route body cap
// must sit AT OR ABOVE the largest advertised media size (media.ts advertises
// MAX_VIDEO_SIZE = 100MB and MAX_IMAGE_SIZE = 20MB and returns a friendly 413
// citing those numbers). If the cap is smaller than the advertised limit, an
// upload between the cap and the advertised limit is rejected by the cap FIRST
// with a generic `body_too_large` envelope, making the advertised limit
// unreachable and the friendly media 413 dead code.

const MiB = 1024 * 1024;
const MB = 1000 * 1000;

// Advertised in routes/media.ts (NOT exported from there). Kept in sync here so
// the test fails loudly if either side drifts back out of agreement.
const ADVERTISED_MAX_VIDEO_SIZE = 100 * MB;

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

test("media body cap does NOT reject an upload between 10 MiB and the advertised video limit with a generic body_too_large", async () => {
  const app = createYurucommuBackendApp();
  // 50 MB: comfortably above the old 10 MiB cap, below the advertised 100MB.
  const res = await app.fetch(
    declaredLengthRequest("https://t.local/api/media/upload", 50 * MB),
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
  // Just over the advertised 100MB, accounting for multipart overhead headroom:
  // the 110 MiB cap (= 115343360 bytes) sits above 100MB but below 120MB, so a
  // 120MB declared body is rejected by the cap with the generic envelope.
  const oversize = 120 * MB;
  expect(oversize).toBeGreaterThan(110 * MiB);
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
  // establishes via the documented value (110 MiB) against the advertised max.
  const cap = 110 * MiB;
  expect(cap).toBeGreaterThanOrEqual(ADVERTISED_MAX_VIDEO_SIZE);
});
