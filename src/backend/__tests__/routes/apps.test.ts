import { expect, test } from "bun:test";

import { stub } from "jsr:@std/testing/mock";
import { createYurucommuBackendApp } from "../../index.ts";

class MemoryR2ObjectBody {
  readonly httpEtag = "mock-etag";
  readonly httpMetadata?: { contentType?: string };

  constructor(
    private readonly bytes: Uint8Array,
    contentType?: string,
  ) {
    this.httpMetadata = contentType ? { contentType } : undefined;
  }

  get body(): ReadableStream<Uint8Array> {
    const body = new Response(this.bytes.slice()).body;
    if (!body) throw new Error("missing response body");
    return body;
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes.slice().buffer;
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<
    string,
    { bytes: Uint8Array; contentType?: string }
  >();

  async put(
    key: string,
    value: ArrayBuffer | string | ReadableStream<Uint8Array>,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void> {
    let bytes: Uint8Array;
    if (typeof value === "string") {
      bytes = new TextEncoder().encode(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = new Uint8Array(value);
    } else {
      const chunks: Uint8Array[] = [];
      const reader = value.getReader();
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        chunks.push(chunk.value);
      }
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    }

    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType,
    });
  }

  async get(key: string): Promise<MemoryR2ObjectBody | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return new MemoryR2ObjectBody(object.bytes, object.contentType);
  }
}

function createEnv(media: MemoryR2Bucket) {
  return {
    APP_URL: "https://test.local",
    DB_INSTANCE: {},
    MEDIA: media,
    OIDC_ISSUER_URL: "https://accounts.example.com",
    OIDC_CLIENT_ID: "takos-client",
    OIDC_CLIENT_SECRET: "takos-secret",
  } as never;
}

test("apps deploy accepts cookie-less bearer requests without Origin", async () => {
  const app = createYurucommuBackendApp();
  const media = new MemoryR2Bucket();
  const fetchStub = stub(
    globalThis,
    "fetch",
    () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            active: true,
            scope: "apps:deploy",
            sub: "client-1",
            client_id: "takos-client",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
  );

  try {
    const res = await app.fetch(
      new Request("https://test.local/api/apps/demo/deploy", {
        method: "POST",
        headers: {
          Authorization: "Bearer service-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          files: [
            {
              path: "index.html",
              content: btoa("<!doctype html><script src='/api/x'></script>"),
              contentType: "text/html; charset=utf-8",
            },
          ],
        }),
      }),
      createEnv(media),
    );

    expect(res.status).toEqual(200);
    expect(await res.json()).toEqual({
      url: "https://test.local/hosted/client-1/demo/",
      files: 1,
    });
    expect(await media.get("hosted/client-1/demo/index.html")).toBeTruthy();
  } finally {
    fetchStub.restore();
  }
});

test("hosted HTML responses use sandbox CSP instead of the backend app CSP", async () => {
  const app = createYurucommuBackendApp();
  const media = new MemoryR2Bucket();
  await media.put("hosted/client-1/demo/index.html", "<!doctype html>", {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  const res = await app.fetch(
    new Request("https://test.local/hosted/client-1/demo/"),
    createEnv(media),
  );

  expect(res.status).toEqual(200);
  expect(res.headers.get("Content-Type")).toEqual("text/html; charset=utf-8");
  expect(res.headers.get("Referrer-Policy")).toEqual("no-referrer");
  const csp = res.headers.get("Content-Security-Policy");
  expect(csp).toBeTruthy();
  expect(csp).toContain("sandbox allow-scripts allow-downloads");
  expect(csp).toContain("form-action 'none'");
  expect(!csp.includes("allow-same-origin")).toBeTruthy();
  expect(!csp.includes("https://unpkg.com")).toBeTruthy();
});

test("hosted SPA fallback inherits the sandbox CSP", async () => {
  const app = createYurucommuBackendApp();
  const media = new MemoryR2Bucket();
  await media.put("hosted/client-1/demo/index.html", "<!doctype html>", {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });

  const res = await app.fetch(
    new Request("https://test.local/hosted/client-1/demo/dashboard"),
    createEnv(media),
  );

  expect(res.status).toEqual(200);
  expect(res.headers.get("Cache-Control")).toEqual("no-cache");
  const csp = res.headers.get("Content-Security-Policy");
  expect(csp).toBeTruthy();
  expect(csp).toContain("sandbox allow-scripts allow-downloads");
  expect(!csp.includes("allow-same-origin")).toBeTruthy();
});

test("hosted static assets preserve content type and cache headers", async () => {
  const app = createYurucommuBackendApp();
  const media = new MemoryR2Bucket();
  await media.put("hosted/client-1/demo/assets/main.js", "export default 1", {
    httpMetadata: { contentType: "application/javascript; charset=utf-8" },
  });

  const res = await app.fetch(
    new Request("https://test.local/hosted/client-1/demo/assets/main.js"),
    createEnv(media),
  );

  expect(res.status).toEqual(200);
  expect(res.headers.get("Content-Type")).toEqual("application/javascript; charset=utf-8");
  expect(res.headers.get("Cache-Control")).toEqual("public, max-age=3600");
});
