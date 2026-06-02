import { expect, test } from "bun:test";
import { assertRejects, assertThrows } from "#test/assert";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BunAssets, BunStorage } from "../src/backend/runtime/bun.ts";
import { resolvePathWithinBasePath } from "../src/backend/runtime/shared.ts";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function symlinkDirectory(target: string, link: string): Promise<void> {
  await symlink(target, link, "dir");
}

test("resolvePathWithinBasePath rejects traversal and absolute paths", () => {
  const basePath = path.resolve(process.cwd(), "takos-path-security");

  expect(resolvePathWithinBasePath(basePath, "nested/file.txt")).toEqual(
    path.resolve(basePath, "nested/file.txt"),
  );
  assertThrows(() => resolvePathWithinBasePath(basePath, "../escape.txt"));
  assertThrows(() => resolvePathWithinBasePath(basePath, "/etc/passwd"));
  assertThrows(() => resolvePathWithinBasePath(basePath, "nested\0file.txt"));
});

test("BunStorage blocks symlink escapes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-path-"));
  const storagePath = path.join(root, "storage");
  const outsidePath = path.join(root, "outside");
  const linkPath = path.join(storagePath, "link");

  try {
    await mkdir(storagePath, { recursive: true });
    await mkdir(outsidePath, { recursive: true });
    await writeFile(path.join(outsidePath, "keep.txt"), "keep");
    await symlinkDirectory(outsidePath, linkPath);

    const storage = await BunStorage.create(storagePath);
    await assertRejects(() => storage.put("link/evil.txt", "payload"));
    expect(await pathExists(path.join(outsidePath, "evil.txt"))).toEqual(false);
    expect(await storage.get("link/evil.txt")).toEqual(null);

    await storage.delete("link/keep.txt");
    await storage.delete("../outside/keep.txt");
    expect(await pathExists(path.join(outsidePath, "keep.txt"))).toEqual(true);

    const listedKeys = (await storage.list()).objects.map(
      (object) => object.key,
    );
    expect(listedKeys.includes("link")).toEqual(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunAssets blocks symlink escapes and still serves normal files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-assets-"));
  const assetsPath = path.join(root, "assets");
  const outsidePath = path.join(root, "outside");
  const linkPath = path.join(assetsPath, "link");

  try {
    await mkdir(assetsPath, { recursive: true });
    await mkdir(outsidePath, { recursive: true });
    await writeFile(path.join(assetsPath, "index.html"), "home");
    await writeFile(path.join(assetsPath, "app.txt"), "ok");
    await writeFile(path.join(outsidePath, "secret.txt"), "secret");
    await symlinkDirectory(outsidePath, linkPath);

    const assets = BunAssets.create(assetsPath);
    const okResponse = await assets.fetch(
      new Request("https://example.test/app.txt"),
    );
    expect(okResponse.status).toEqual(200);
    expect(await okResponse.text()).toEqual("ok");

    const forbiddenResponse = await assets.fetch(
      new Request("https://example.test/link/secret.txt"),
    );
    expect(forbiddenResponse.status).toEqual(403);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
