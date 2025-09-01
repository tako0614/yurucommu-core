import { Hono } from "hono";

function base64ToUint8Array(b64: string): Uint8Array {
  try {
    // deno-lint-ignore no-explicit-any
    const atobFn = (globalThis as any).atob as ((s: string) => string) | undefined;
    if (atobFn) {
      const bin = atobFn(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes;
    }
  } catch { /* ignore */ }
  return new Uint8Array();
}

let DEFAULT_AVATAR: Uint8Array;
try {
    // Deno 環境ではローカルファイルから読み込み
    // deno-lint-ignore no-explicit-any
    if (typeof (globalThis as any).Deno !== "undefined") {
      // deno-lint-ignore no-explicit-any
      const D = (globalThis as any).Deno as typeof Deno;
      DEFAULT_AVATAR = await D.readFile(new URL("../image/people.png", import.meta.url));
    } else {
      throw new Error("no deno");
    }
} catch {
  // 1x1 transparent PNG
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YvWcWwAAAAASUVORK5CYII=";
  DEFAULT_AVATAR = base64ToUint8Array(b64);
}

const app = new Hono();

app.get("/image/people.png", (c) => {
  // Create a new Uint8Array copy (backed by a plain ArrayBuffer) so the type
  // matches Hono's accepted Data types and avoids SharedArrayBuffer issues.
  const out = new Uint8Array(DEFAULT_AVATAR);
  return c.body(out, 200, { "content-type": "image/png" });
});

export default app;
