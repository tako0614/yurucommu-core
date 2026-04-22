import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import path from "node:path";
import { DenoAssets, DenoStorage } from "../src/backend/runtime/deno.ts";
import { resolvePathWithinBasePath } from "../src/backend/runtime/shared.ts";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await Deno.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

Deno.test("resolvePathWithinBasePath rejects traversal and absolute paths", () => {
  const basePath = path.resolve(Deno.cwd(), "takos-path-security");

  assertEquals(
    resolvePathWithinBasePath(basePath, "nested/file.txt"),
    path.resolve(basePath, "nested/file.txt"),
  );
  assertThrows(() => resolvePathWithinBasePath(basePath, "../escape.txt"));
  assertThrows(() => resolvePathWithinBasePath(basePath, "/etc/passwd"));
  assertThrows(() => resolvePathWithinBasePath(basePath, "nested\0file.txt"));
});

Deno.test("DenoStorage blocks symlink escapes", async () => {
  if (Deno.build.os === "windows") return;

  const root = await Deno.makeTempDir();
  const storagePath = path.join(root, "storage");
  const outsidePath = path.join(root, "outside");
  const linkPath = path.join(storagePath, "link");

  try {
    await Deno.mkdir(storagePath, { recursive: true });
    await Deno.mkdir(outsidePath, { recursive: true });
    await Deno.writeTextFile(path.join(outsidePath, "keep.txt"), "keep");
    await Deno.symlink(outsidePath, linkPath);

    const storage = await DenoStorage.create(storagePath);
    await assertRejects(() => storage.put("link/evil.txt", "payload"));
    assertEquals(await pathExists(path.join(outsidePath, "evil.txt")), false);
    assertEquals(await storage.get("link/evil.txt"), null);

    await storage.delete("link/keep.txt");
    await storage.delete("../outside/keep.txt");
    assertEquals(await pathExists(path.join(outsidePath, "keep.txt")), true);

    const listedKeys = (await storage.list()).objects.map((object) =>
      object.key
    );
    assertEquals(listedKeys.includes("link"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("DenoAssets blocks symlink escapes and still serves normal files", async () => {
  if (Deno.build.os === "windows") return;

  const root = await Deno.makeTempDir();
  const assetsPath = path.join(root, "assets");
  const outsidePath = path.join(root, "outside");
  const linkPath = path.join(assetsPath, "link");

  try {
    await Deno.mkdir(assetsPath, { recursive: true });
    await Deno.mkdir(outsidePath, { recursive: true });
    await Deno.writeTextFile(path.join(assetsPath, "index.html"), "home");
    await Deno.writeTextFile(path.join(assetsPath, "app.txt"), "ok");
    await Deno.writeTextFile(path.join(outsidePath, "secret.txt"), "secret");
    await Deno.symlink(outsidePath, linkPath);

    const assets = DenoAssets.create(assetsPath);
    const okResponse = await assets.fetch(
      new Request("https://example.test/app.txt"),
    );
    assertEquals(okResponse.status, 200);
    assertEquals(await okResponse.text(), "ok");

    const forbiddenResponse = await assets.fetch(
      new Request("https://example.test/link/secret.txt"),
    );
    assertEquals(forbiddenResponse.status, 403);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
