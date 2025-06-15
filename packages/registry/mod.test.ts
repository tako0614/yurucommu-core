import { assertEquals } from "jsr:@std/assert@1.0.13";
import { BlobWriter, TextReader, ZipWriter } from "jsr:@zip-js/zip-js@2.7.62";
import { serve } from "jsr:@std/http@1.0.6";
import {
  downloadAndUnpack,
  fetchPackageInfo,
  fetchRegistryIndex,
  searchRegistry,
} from "./mod.ts";

Deno.test("fetch index and download", async () => {
  // Build simple takopack archive in memory
  const writer = new BlobWriter("application/zip");
  const zip = new ZipWriter(writer);
  await zip.add(
    "takos/manifest.json",
    new TextReader(
      '{"name":"test","identifier":"com.test","version":"0.1.0","icon":"./icon.png","server":{"entry":"./server.js"},"client":{"entryBackground":"./client.js","entryUI":"./index.html"}}',
    ),
  );
  await zip.add(
    "takos/server.js",
    new TextReader("export function ping(){return 1;}"),
  );
  await zip.add("takos/client.js", new TextReader(""));
  await zip.add("takos/index.html", new TextReader(""));
  await zip.add("takos/icon.png", new TextReader("icon"));
  await zip.close();
  const blob = await writer.getData();
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = Array.from(new Uint8Array(digest)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  const controller = new AbortController();
  const { signal } = controller;
  const handler = (req: Request): Response => {
    const url = new URL(req.url);
    if (url.pathname === "/_takopack/index.json") {
      return new Response(JSON.stringify({
        packages: [
          {
            identifier: "com.test",
            name: "Test",
            version: "0.1.0",
            downloadUrl: `http://localhost:${
              (server.listener.addr as Deno.NetAddr).port
            }/test.takopack`,
            sha256: sha,
          },
        ],
      }));
    }
    if (url.pathname === "/test.takopack") {
      return new Response(bytes);
    }
    return new Response("Not found", { status: 404 });
  };
  const server = serve(handler, { port: 0, signal });
  const port = (server.listener.addr as Deno.NetAddr).port;

  const { index, etag } = await fetchRegistryIndex(
    `http://localhost:${port}/_takopack/index.json`,
  );
  if (!index) throw new Error("index should not be null");
  assertEquals(index.packages.length, 1);
  const pkg = index.packages[0];
  const result = await downloadAndUnpack(pkg);
  assertEquals(result.manifest.name, "test");

  // second call with If-None-Match should return null
  const cached = await fetchRegistryIndex(
    `http://localhost:${port}/_takopack/index.json`,
    {
      etag,
    },
  );
  assertEquals(cached.index, null);

  controller.abort();
  await server.finished;
});

Deno.test("search registry", async () => {
  const controller = new AbortController();
  const { signal } = controller;
  const handler = (req: Request): Response => {
    const url = new URL(req.url);
    if (url.pathname === "/_takopack/search") {
      const q = url.searchParams.get("q") ?? "";
      const list = [
        { identifier: "com.foo", name: "Foo", version: "1" },
        { identifier: "com.bar", name: "Bar", version: "1" },
      ];
      const result = list.filter((p) =>
        (p.name + p.identifier).toLowerCase().includes(q.toLowerCase())
      );
      return new Response(JSON.stringify({ packages: result }));
    }
    return new Response("Not found", { status: 404 });
  };
  const server = serve(handler, { port: 0, signal });
  const port = (server.listener.addr as Deno.NetAddr).port;

  const { index, etag } = await searchRegistry(
    `http://localhost:${port}/_takopack/search`,
    { q: "Foo" },
  );
  if (!index) throw new Error("index should not be null");
  assertEquals(index.packages.length, 1);
  assertEquals(index.packages[0].identifier, "com.foo");

  const cached = await searchRegistry(`http://localhost:${port}/_takopack/search`, {
    q: "Foo",
    etag,
  });
  assertEquals(cached.index, null);

  controller.abort();
  await server.finished;
});

Deno.test("fetch package info", async () => {
  const controller = new AbortController();
  const { signal } = controller;
  const handler = (req: Request): Response => {
    const url = new URL(req.url);
    if (url.pathname === "/_takopack/packages/com.test") {
      return new Response(
        JSON.stringify({ identifier: "com.test", version: "1" }),
      );
    }
    return new Response("Not found", { status: 404 });
  };
  const server = serve(handler, { port: 0, signal });
  const port = (server.listener.addr as Deno.NetAddr).port;

  const { pkg, etag } = await fetchPackageInfo(
    `http://localhost:${port}/_takopack`,
    "com.test",
  );
  if (!pkg) throw new Error("pkg should not be null");
  assertEquals(pkg.identifier, "com.test");

  const cached = await fetchPackageInfo(
    `http://localhost:${port}/_takopack`,
    "com.test",
    {
      etag,
    },
  );
  assertEquals(cached.pkg, null);

  controller.abort();
  await server.finished;
});
