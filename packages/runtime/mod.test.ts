import { assert, assertEquals, assertRejects } from "./test_deps.ts";
import { TakoPack } from "./mod.ts";

Deno.test("load takopack and call server function", async () => {
  const pack = {
    manifest: JSON.stringify({
      name: "test",
      identifier: "com.example.test",
      version: "0.1.0",
      icon: "./icon.png",
    }),
    server: `export function hello(name){ return 'Hello '+name; }`,
  };

  const takopack = new TakoPack([pack]);
  await takopack.init();
  const result = await takopack.callServer("com.example.test", "hello", [
    "world",
  ]);
  assertEquals(result, "Hello world");
  assert((globalThis as any).takos);
  // cleanup
  delete (globalThis as Record<string, unknown>).takos;
});

Deno.test("override takos APIs via options", async () => {
  const pack = {
    manifest: JSON.stringify({
      name: "test2",
      identifier: "com.example.test2",
      version: "0.1.0",
      icon: "./icon.png",
    }),
    server:
      `export async function check(){ return await globalThis.takos.kv.read('foo'); }`,
  };

  const takopack = new TakoPack([pack], {
    kv: { read: async (key: string) => `value:${key}` },
  });
  await takopack.init();
  const result = await takopack.callServer("com.example.test2", "check");
  assertEquals(result, "value:foo");
  delete (globalThis as Record<string, unknown>).takos;
});

Deno.test("override new event APIs", async () => {
  const pack = {
    manifest: JSON.stringify({
      name: "test3",
      identifier: "com.example.test3",
      version: "0.1.0",
      icon: "./icon.png",
    }),
    server:
      `export async function send(){ await globalThis.takos.events.publish('ev', {}); return 1; }`,
  };

  let called = false;
  const takopack = new TakoPack([pack], {
    events: {
      publish: async () => {
        called = true;
        return undefined;
      },
    },
  });
  await takopack.init();
  await takopack.callServer("com.example.test3", "send");
  assert(called);
  delete (globalThis as Record<string, unknown>).takos;
});

Deno.test("extensions API activation", async () => {
  const pack = {
    manifest: JSON.stringify({
      name: "lib",
      identifier: "com.example.lib",
      version: "0.1.0",
      icon: "./icon.png",
      exports: { server: ["add"] },
    }),
    server: `export function add(a,b){return a+b;}`,
  };
  const takopack = new TakoPack([pack]);
  await takopack.init();
  const ext = (globalThis as any).takos.extensions.get("com.example.lib");
  assert(ext);
  const api = await ext.activate();
  const res = await (api as any).add(1, 2);
  assertEquals(res, 3);
  const all = (globalThis as any).takos.extensions.all;
  assert(Array.isArray(all));
  assertEquals(all.length, 1);
  delete (globalThis as Record<string, unknown>).takos;
});

Deno.test("callServer throws on undefined event", async () => {
  const pack = {
    manifest: JSON.stringify({
      name: "test4",
      identifier: "com.example.test4",
      version: "0.1.0",
      icon: "./icon.png",
      eventDefinitions: {
        defined: { source: "ui", handler: "defined" },
      },
    }),
    server: `export function defined(){ return 1; }`,
  };
  const takopack = new TakoPack([pack]);
  await takopack.init();
  await assertRejects(
    () => takopack.callServer("com.example.test4", "other"),
    Error,
    "manifest.eventDefinitions",
  );
  delete (globalThis as Record<string, unknown>).takos;
});
