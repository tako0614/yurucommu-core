import { assertEquals } from "jsr:@std/assert";
import { BlobWriter, TextReader, ZipWriter } from "jsr:@zip-js/zip-js@^2.7.62";
import { unpackTakoPack } from "./mod.ts";

Deno.test("unpack takopack archive", async () => {
  const writer = new BlobWriter("application/zip");
  const zip = new ZipWriter(writer);
  await zip.add(
    "takos/manifest.json",
    new TextReader('{"name":"test","identifier":"id","version":"0.1.0","icon":"./icon.png"}'),
  );
  await zip.add("takos/server.js", new TextReader("console.log('server');"));
  await zip.add("takos/client.js", new TextReader("console.log('client');"));
  await zip.add("takos/index.html", new TextReader("<html></html>"));
  await zip.close();
  const blob = await writer.getData();
  const buffer = new Uint8Array(await blob.arrayBuffer());

  const result = await unpackTakoPack(buffer);

  assertEquals(typeof result.manifest, "string");
  assertEquals(result.server, "console.log('server');");
  assertEquals(result.client, "console.log('client');");
  assertEquals(result.index, "<html></html>");
});
