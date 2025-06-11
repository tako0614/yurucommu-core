import { assert, assertEquals } from "jsr:@std/assert";
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
