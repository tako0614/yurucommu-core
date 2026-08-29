import { expect, test } from "bun:test";
import { assertRejects, assertThrows } from "#test/assert";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  link,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";
import {
  BunAssets,
  BunStorage,
  writeBufferFully as writeBufferFullyForTest,
} from "../src/backend/runtime/bun.ts";
import { resolvePathWithinBasePath } from "../src/backend/runtime/shared.ts";

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function internalRootFor(storagePath: string): string {
  const publicRoot = path.resolve(storagePath);
  return path.join(
    path.dirname(publicRoot),
    `.${path.basename(publicRoot) || "root"}.yurucommu-objects`,
  );
}

function internalObjectPathFor(storagePath: string, key: string): string {
  return path.join(
    internalRootFor(storagePath),
    createHash("sha256").update(key, "utf8").digest("hex"),
  );
}

async function internalStorageEntries(
  storagePath: string,
): Promise<Array<{ name: string; path: string }>> {
  const internalRoot = internalRootFor(storagePath);
  const objectDirs = await readdir(internalRoot, { withFileTypes: true });
  const entries: Array<{ name: string; path: string }> = [];
  for (const objectDir of objectDirs) {
    if (!objectDir.isDirectory()) continue;
    for (const entry of await readdir(path.join(internalRoot, objectDir.name), {
      withFileTypes: true,
    })) {
      entries.push({
        name: entry.name,
        path: path.join(internalRoot, objectDir.name, entry.name),
      });
    }
  }
  return entries;
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

test("BunStorage rejects a sibling internal root symlink even within its parent", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-internal-root-link-"),
  );
  const storagePath = path.join(root, "storage");
  const internalRoot = internalRootFor(storagePath);
  const target = path.join(root, "internal-target");

  try {
    await mkdir(storagePath, { recursive: true });
    await mkdir(target, { recursive: true });
    await symlinkDirectory(target, internalRoot);
    // The target is still under the trusted sibling parent. It must not be
    // accepted as the metadata root merely because realpath stays in-bounds.
    await assertRejects(() => BunStorage.create(storagePath));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage materializes the sibling root and first digest directory before publication", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-internal-root-"));
  const storagePath = path.join(root, "storage");
  const key = "first-key.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    const internalRoot = internalRootFor(storagePath);
    expect(await pathExists(internalRoot)).toBe(true);
    expect(
      (await readdir(internalRoot)).filter((name) => name !== ".DS_Store"),
    ).toHaveLength(0);

    await storage.put(key, "first");
    const objectPath = internalObjectPathFor(storagePath, key);
    expect(await pathExists(objectPath)).toBe(true);
    expect(
      (await readdir(objectPath)).some((name) => name === "commit.json"),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage writes multi-chunk streams incrementally before atomic commit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-stream-"));
  const storagePath = path.join(root, "storage");
  const firstChunk = new Uint8Array([1, 2, 3]);
  const secondChunk = new Uint8Array([4, 5, 6]);
  let pulls = 0;
  let releaseSecondPull: (() => void) | undefined;
  let secondPullStartedResolve: (() => void) | undefined;
  const secondPullStarted = new Promise<void>((resolve) => {
    secondPullStartedResolve = resolve;
  });

  try {
    const storage = await BunStorage.create(storagePath);
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(firstChunk);
          return;
        }
        if (pulls === 2) {
          secondPullStartedResolve?.();
          return new Promise<void>((resolve) => {
            releaseSecondPull = () => {
              controller.enqueue(secondChunk);
              controller.close();
              resolve();
            };
          });
        }
      },
    });

    const write = storage.put("multi.bin", source);
    await secondPullStarted;

    expect(await pathExists(path.join(storagePath, "multi.bin"))).toBe(false);
    const temporaryEntries = (await internalStorageEntries(storagePath)).filter(
      (entry) =>
        entry.name.startsWith("tmp-") && !entry.name.endsWith(".lease"),
    );
    expect(temporaryEntries).toHaveLength(1);
    expect((await stat(temporaryEntries[0]!.path)).size).toBe(
      firstChunk.byteLength,
    );
    const rollingStorage = await BunStorage.create(storagePath);
    expect(
      (await internalStorageEntries(storagePath)).some((entry) =>
        entry.name.endsWith(".lease"),
      ),
    ).toBe(true);

    releaseSecondPull?.();
    await write;
    const object = await rollingStorage.get("multi.bin");
    expect(object).not.toBeNull();
    expect(
      new Uint8Array((await object!.arrayBuffer()) as ArrayBuffer),
    ).toEqual(new Uint8Array([...firstChunk, ...secondChunk]));
    expect(
      (await internalStorageEntries(storagePath)).filter(
        (entry) =>
          entry.name.startsWith("tmp-") && !entry.name.endsWith(".lease"),
      ),
    ).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage cleans failed stream writes without exposing partial data", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-failure-"));
  const storagePath = path.join(root, "storage");

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put("existing.bin", "old");
    const oldObject = await storage.get("existing.bin");
    expect(oldObject).not.toBeNull();
    expect(await oldObject!.text()).toBe("old");
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new Uint8Array([9, 8, 7]));
          return;
        }
        controller.error(new Error("simulated stream failure"));
      },
    });

    await assertRejects(() => storage.put("existing.bin", source));
    const existingObject = await storage.get("existing.bin");
    expect(existingObject).not.toBeNull();
    expect(await existingObject!.text()).toBe("old");
    expect(
      (await internalStorageEntries(storagePath)).filter(
        (entry) =>
          entry.name.startsWith("tmp-") && !entry.name.endsWith(".lease"),
      ),
    ).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage accepts Blob/File bodies without changing their bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-blob-"));
  const storagePath = path.join(root, "storage");
  const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]);

  try {
    const storage = await BunStorage.create(storagePath);
    const body = new File([bytes], "clip.webm", { type: "video/webm" });
    await storage.put("clip.webm", body, {
      httpMetadata: { contentType: body.type },
    });

    const object = await storage.get("clip.webm");
    expect(object).not.toBeNull();
    expect(
      new Uint8Array((await object!.arrayBuffer()) as ArrayBuffer),
    ).toEqual(bytes);
    expect(await storage.head("clip.webm")).toMatchObject({
      contentLength: body.size,
      httpMetadata: { contentType: body.type },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage refuses internal hardlinks and symlink swaps", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-owned-files-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "owned.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "safe", { customMetadata: { owner: "adapter" } });
    const objectPath = internalObjectPathFor(storagePath, key);
    const markerPath = path.join(objectPath, "commit.json");
    const marker = JSON.parse(await Bun.file(markerPath).text()) as {
      generation: string;
    };
    const bodyPath = path.join(
      objectPath,
      `generation-${marker.generation}.body`,
    );
    const metaPath = path.join(
      objectPath,
      `generation-${marker.generation}.meta.json`,
    );

    const outsideBody = path.join(root, "outside-body");
    await writeFile(outsideBody, "secret-body");
    await rm(bodyPath);
    await link(outsideBody, bodyPath);
    // A hardlink must never make an external inode an adapter generation.
    expect(await storage.get(key)).toBeNull();
    expect(await Bun.file(outsideBody).text()).toBe("secret-body");

    // Restore a valid body, then replace the marker with an external hardlink.
    await rm(bodyPath);
    await writeFile(bodyPath, "safe");
    const outsideMarker = path.join(root, "outside-marker");
    await writeFile(outsideMarker, await Bun.file(markerPath).text());
    await rm(markerPath);
    await link(outsideMarker, markerPath);
    expect(await storage.get(key)).toBeNull();
    expect(await Bun.file(outsideMarker).text()).toContain(
      '"state":"committed"',
    );

    // Restore marker, then make metadata a hardlink and verify it is rejected.
    await rm(markerPath);
    await writeFile(markerPath, await Bun.file(outsideMarker).text());
    const outsideMeta = path.join(root, "outside-meta");
    await writeFile(
      outsideMeta,
      JSON.stringify({ customMetadata: { leaked: "no" } }),
    );
    await rm(metaPath);
    await link(outsideMeta, metaPath);
    expect(await storage.get(key)).toBeNull();

    // A symlink at the final marker component is rejected by O_NOFOLLOW and
    // the lstat/fstat identity checks, even when the target stays in-root.
    await rm(metaPath);
    await writeFile(
      metaPath,
      JSON.stringify({ customMetadata: { owner: "adapter" } }),
    );
    await rm(markerPath);
    await symlink(outsideMarker, markerPath);
    expect(await storage.get(key)).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage loops short writes and rejects zero-byte writes", async () => {
  const chunks: Uint8Array[] = [];
  let calls = 0;
  const shortWriter = {
    async write(chunk: Uint8Array) {
      calls += 1;
      const bytesWritten = calls === 1 ? 2 : chunk.byteLength;
      chunks.push(chunk.slice(0, bytesWritten));
      return { bytesWritten };
    },
  } as unknown as FileHandle;

  await writeBufferFullyForTest(shortWriter, new Uint8Array([1, 2, 3, 4, 5]));
  expect(calls).toBe(2);
  expect(new Uint8Array(chunks.flatMap((chunk) => [...chunk]))).toEqual(
    new Uint8Array([1, 2, 3, 4, 5]),
  );

  const zeroWriter = {
    async write() {
      return { bytesWritten: 0 };
    },
  } as unknown as FileHandle;
  await assertRejects(() =>
    writeBufferFullyForTest(zeroWriter, new Uint8Array([1])),
  );
});

test("BunStorage keeps the committed generation on metadata failure", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-metadata-"),
  );
  const storagePath = path.join(root, "storage");

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put("stable.bin", "old", {
      customMetadata: { generation: "old" },
    });
    const circular = {} as { self?: unknown };
    circular.self = circular;

    await assertRejects(() =>
      storage.put("stable.bin", "new", {
        customMetadata: circular as Record<string, string>,
      }),
    );
    const object = await storage.get("stable.bin");
    expect(object).not.toBeNull();
    expect(await object!.text()).toBe("old");
    expect(await storage.head("stable.bin")).toMatchObject({
      contentLength: 3,
      customMetadata: { generation: "old" },
    });

    await assertRejects(() =>
      storage.put("empty.bin", "new", {
        customMetadata: circular as Record<string, string>,
      }),
    );
    expect(await storage.get("empty.bin")).toBeNull();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage keeps a renamed generation when marker directory fsync fails", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-marker-fsync-failure-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "marker-fsync.bin";
  let failMarkerSync = false;
  let objectDirectorySyncs = 0;

  try {
    const storage = await BunStorage.create(storagePath, {
      syncDirectory: async (directoryPath) => {
        const objectPath = internalObjectPathFor(storagePath, key);
        if (failMarkerSync && directoryPath === objectPath) {
          objectDirectorySyncs += 1;
          // put() syncs the object directory after body rename, metadata
          // rename, then marker rename. Inject the failure at that final
          // publication sync, after commit.json is already authoritative.
          if (objectDirectorySyncs === 3) {
            throw new Error("simulated marker directory fsync failure");
          }
        }
      },
    });
    await storage.put(key, "old", { customMetadata: { generation: "old" } });

    failMarkerSync = true;
    objectDirectorySyncs = 0;
    await expect(
      storage.put(key, "new", { customMetadata: { generation: "new" } }),
    ).rejects.toThrow(/simulated marker directory fsync failure/u);

    // Rename has already published the new complete generation. A durability
    // error must reject the writer without deleting the generation named by
    // commit.json or allowing a null/corrupt read.
    const visible = await storage.get(key);
    expect(visible).not.toBeNull();
    expect(await visible!.text()).toBe("new");
    expect(await storage.head(key)).toMatchObject({
      contentLength: 3,
      customMetadata: { generation: "new" },
    });

    // A fresh adapter must recover the same marker/generation pair and clean
    // the superseded generation without treating the failed fsync as a
    // partially-published object.
    const recovered = await BunStorage.create(storagePath);
    const recoveredObject = await recovered.get(key);
    expect(recoveredObject).not.toBeNull();
    expect(await recoveredObject!.text()).toBe("new");
    expect(await recovered.head(key)).toMatchObject({
      contentLength: 3,
      customMetadata: { generation: "new" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage concurrent writers keep body and metadata from one generation", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-concurrent-"),
  );
  const storagePath = path.join(root, "storage");

  try {
    const storage = await BunStorage.create(storagePath);
    const writeA = storage.put("race.bin", new File(["writer-a"], "a"), {
      customMetadata: { writer: "a" },
    });
    const writeB = storage.put("race.bin", new File(["writer-b"], "b"), {
      customMetadata: { writer: "b" },
    });
    await Promise.all([writeA, writeB]);

    const object = await storage.get("race.bin");
    const head = await storage.head("race.bin");
    expect(object).not.toBeNull();
    expect(head).not.toBeNull();
    const body = await object!.text();
    expect(["writer-a", "writer-b"]).toContain(body);
    const writer = head!.customMetadata?.writer;
    expect(writer).toBe(body === "writer-a" ? "a" : "b");
    expect(head!.contentLength).toBe(body.length);

    const digest = createHash("sha256")
      .update("race.bin", "utf8")
      .digest("hex");
    const generationFiles = (await internalStorageEntries(storagePath)).filter(
      (entry) =>
        entry.path.startsWith(
          path.join(internalRootFor(storagePath), digest),
        ) && entry.name.startsWith("generation-"),
    );
    // The winning commit is the only generation retained after concurrent
    // publication; body and metadata remain a paired generation.
    expect(generationFiles).toHaveLength(2);

    const listed = await storage.list();
    expect(
      listed.objects.filter((entry) => entry.key === "race.bin"),
    ).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage hides crash leftovers and incomplete generations from list", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-crash-"));
  const storagePath = path.join(root, "storage");

  try {
    await BunStorage.create(storagePath);
    const key = "orphan";
    const digest = createHash("sha256").update(key, "utf8").digest("hex");
    const objectPath = path.join(internalRootFor(storagePath), digest);
    await mkdir(objectPath, { recursive: true });
    await writeFile(path.join(objectPath, "tmp-crash.body"), "partial");
    await writeFile(
      path.join(objectPath, "generation-0123456789abcdef.body"),
      "partial",
    );
    await writeFile(
      path.join(objectPath, "generation-0123456789abcdef.meta.json"),
      "{}",
    );

    const storage = await BunStorage.create(storagePath);
    const listed = await storage.list();
    expect(listed.objects).toHaveLength(0);
    expect(await storage.get(key)).toBeNull();
    expect(await internalStorageEntries(storagePath)).toHaveLength(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage keeps internal-looking user keys disjoint from its store", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-keys-"));
  const storagePath = path.join(root, "storage");
  const keys = [
    ".yurucommu-objects/user-key",
    "name.yurucommu-commit.json",
    "payload.tmp-crash.body",
    "nested/.yurucommu-objects/inner.tmp-1",
  ];

  try {
    const storage = await BunStorage.create(storagePath);
    for (const key of keys) {
      await storage.put(key, key, { customMetadata: { key } });
    }
    const listedKeys = (await storage.list()).objects.map((entry) => entry.key);
    expect(listedKeys.sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const object = await storage.get(key);
      expect(object).not.toBeNull();
      expect(await object!.text()).toBe(key);
      expect((await storage.head(key))?.customMetadata?.key).toBe(key);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage upgrades legacy .yurucommu-objects keys without reserving them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-upgrade-"));
  const fileStoragePath = path.join(root, "file-storage");
  const directoryStoragePath = path.join(root, "directory-storage");

  try {
    // A pre-3.4.5 installation may have a literal user file at the former
    // in-root marker name. It must remain readable and replaceable.
    await mkdir(fileStoragePath, { recursive: true });
    await writeFile(
      path.join(fileStoragePath, ".yurucommu-objects"),
      "legacy-root",
    );
    await writeFile(
      path.join(fileStoragePath, ".yurucommu-objects.meta.json"),
      JSON.stringify({ customMetadata: { source: "legacy" } }),
    );
    const fileStorage = await BunStorage.create(fileStoragePath);
    const legacyRoot = await fileStorage.get(".yurucommu-objects");
    expect(legacyRoot).not.toBeNull();
    expect(await legacyRoot!.text()).toBe("legacy-root");
    expect(
      (await fileStorage.list()).objects.map((object) => object.key),
    ).toContain(".yurucommu-objects");
    await fileStorage.put(".yurucommu-objects", "rewritten-root", {
      customMetadata: { source: "new" },
    });
    expect(await (await fileStorage.get(".yurucommu-objects"))!.text()).toBe(
      "rewritten-root",
    );

    // A separate legacy installation may have descendants below that name;
    // the upgrade must recurse them as ordinary user keys rather than trying
    // to treat the directory as the new metadata store.
    await mkdir(path.join(directoryStoragePath, ".yurucommu-objects"), {
      recursive: true,
    });
    await writeFile(
      path.join(directoryStoragePath, ".yurucommu-objects", "child.bin"),
      "legacy-child",
    );
    const directoryStorage = await BunStorage.create(directoryStoragePath);
    expect(
      (await directoryStorage.list()).objects.map((object) => object.key),
    ).toContain(".yurucommu-objects/child.bin");
    expect(
      await (await directoryStorage.get(
        ".yurucommu-objects/child.bin",
      ))!.text(),
    ).toBe("legacy-child");
    await directoryStorage.put(
      ".yurucommu-objects/child.bin",
      "rewritten-child",
    );
    expect(
      await (await directoryStorage.get(
        ".yurucommu-objects/child.bin",
      ))!.text(),
    ).toBe("rewritten-child");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage physically reclaims prior generations after overwrite and delete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-gc-"));
  const storagePath = path.join(root, "storage");
  const boundedDigest = createHash("sha256")
    .update("bounded.bin", "utf8")
    .digest("hex");
  const boundedObjectPrefix = path.join(
    internalRootFor(storagePath),
    boundedDigest,
  );

  try {
    const storage = await BunStorage.create(storagePath);
    for (let index = 0; index < 5; index += 1) {
      await storage.put("bounded.bin", `generation-${index}`, {
        customMetadata: { generation: String(index) },
      });
      const generationFiles = (
        await internalStorageEntries(storagePath)
      ).filter(
        (entry) =>
          entry.path.startsWith(boundedObjectPrefix) &&
          entry.name.startsWith("generation-"),
      );
      expect(generationFiles).toHaveLength(2);
    }
    await storage.put("live.bin", "live", {
      customMetadata: { generation: "live" },
    });

    await storage.delete("bounded.bin");
    expect(await storage.get("bounded.bin")).toBeNull();
    expect(await storage.head("bounded.bin")).toBeNull();
    expect(
      (await internalStorageEntries(storagePath)).filter(
        (entry) =>
          entry.path.startsWith(boundedObjectPrefix) &&
          entry.name.startsWith("generation-"),
      ),
    ).toHaveLength(0);
    expect((await storage.list()).objects.map((entry) => entry.key)).toEqual([
      "live.bin",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage reclaims stale temp artifacts during steady-state GC", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-stale-temp-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "stale-temp.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "seed");
    const objectPath = internalObjectPathFor(storagePath, key);
    const staleGeneration = "0123456789abcdef";
    await writeFile(
      path.join(objectPath, `tmp-${staleGeneration}.body`),
      "partial",
    );
    await writeFile(
      path.join(objectPath, `tmp-${staleGeneration}.meta.json`),
      "{}",
    );
    await writeFile(
      path.join(objectPath, `tmp-${staleGeneration}.commit.json`),
      "{}",
    );

    await storage.put(key, "next");
    const names = await readdir(objectPath);
    expect(
      names.filter((name) => name.startsWith(`tmp-${staleGeneration}.`)),
    ).toEqual([]);
    expect(await (await storage.get(key))!.text()).toBe("next");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage keeps the old generation visible while a new writer is incomplete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-reader-"));
  const storagePath = path.join(root, "storage");
  let releaseSecondPull: (() => void) | undefined;
  let released = false;
  let secondPullStartedResolve: (() => void) | undefined;
  const secondPullStarted = new Promise<void>((resolve) => {
    secondPullStartedResolve = resolve;
  });

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put("reader.bin", "old", {
      customMetadata: { generation: "old" },
    });
    let pulls = 0;
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(new TextEncoder().encode("new"));
          return;
        }
        secondPullStartedResolve?.();
        return new Promise<void>((resolve) => {
          releaseSecondPull = () => {
            if (released) return;
            released = true;
            controller.close();
            resolve();
          };
        });
      },
    });
    const writing = storage.put("reader.bin", source, {
      customMetadata: { generation: "new" },
    });
    await secondPullStarted;

    const during = await storage.get("reader.bin");
    expect(during).not.toBeNull();
    expect(await during!.text()).toBe("old");
    expect((await storage.head("reader.bin"))?.customMetadata?.generation).toBe(
      "old",
    );

    releaseSecondPull?.();
    await writing;
    const after = await storage.get("reader.bin");
    expect(after).not.toBeNull();
    expect(await after!.text()).toBe("new");
    expect((await storage.head("reader.bin"))?.customMetadata?.generation).toBe(
      "new",
    );
  } finally {
    releaseSecondPull?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage keeps reads non-null during continuous same- and cross-instance overlap", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-stress-"));
  const storagePath = path.join(root, "storage");

  try {
    const storage = await BunStorage.create(storagePath);
    const rollingStorage = await BunStorage.create(storagePath);
    await storage.put("stress.bin", "seed", {
      customMetadata: { generation: "seed" },
    });

    const failures: string[] = [];
    const readerCount = 24;
    let readersStarted = 0;
    let resolveReadersStarted: (() => void) | undefined;
    const allReadersStarted = new Promise<void>((resolve) => {
      resolveReadersStarted = resolve;
    });
    let writesFinished = false;
    let totalReads = 0;
    const readers = Array.from({ length: readerCount }, (_, readerIndex) =>
      (async () => {
        readersStarted += 1;
        if (readersStarted === readerCount) resolveReadersStarted?.();
        while (!writesFinished) {
          const adapter = readerIndex % 2 === 0 ? storage : rollingStorage;
          const object = await adapter.get("stress.bin");
          totalReads += 1;
          if (!object) {
            failures.push(`reader-${readerIndex}: null`);
            continue;
          }
          const body = await object.text();
          if (!/^value-\d+$/u.test(body) && body !== "seed") {
            failures.push(`reader-${readerIndex}: ${body}`);
          }
          // Keep all readers scheduled while publication and GC overlap.
          await Promise.resolve();
        }
      })(),
    );
    await allReadersStarted;

    for (let writeIndex = 0; writeIndex < 200; writeIndex += 1) {
      await storage.put("stress.bin", `value-${writeIndex}`, {
        customMetadata: { generation: String(writeIndex) },
      });
      await Promise.resolve();
    }
    writesFinished = true;
    await Promise.all(readers);
    expect(failures).toEqual([]);
    expect(totalReads).toBeGreaterThan(0);
    expect(await (await storage.get("stress.bin"))!.text()).toBe("value-199");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage rereads a marker during deterministic atomic rename churn", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-marker-race-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "marker-race.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "stable", { customMetadata: { marker: "stable" } });
    const objectPath = internalObjectPathFor(storagePath, key);
    const markerPath = path.join(objectPath, "commit.json");
    const markerPayload = await Bun.file(markerPath).text();
    let firstRenameResolve: (() => void) | undefined;
    const firstRename = new Promise<void>((resolve) => {
      firstRenameResolve = resolve;
    });
    let churnFinished = false;
    const churn = (async () => {
      for (let index = 0; index < 300; index += 1) {
        const temporaryMarker = path.join(
          objectPath,
          `tmp-marker-race-${index}.commit.json`,
        );
        await writeFile(temporaryMarker, markerPayload);
        await rename(temporaryMarker, markerPath);
        if (index === 0) firstRenameResolve?.();
        await Promise.resolve();
      }
      churnFinished = true;
    })();
    await firstRename;

    const failures: string[] = [];
    const readers = Array.from({ length: 12 }, async (_, readerIndex) => {
      while (!churnFinished) {
        const object = await storage.get(key);
        if (!object) {
          failures.push(`reader-${readerIndex}: null`);
          continue;
        }
        if ((await object.text()) !== "stable") {
          failures.push(`reader-${readerIndex}: mismatched body`);
        }
      }
    });
    await Promise.all([churn, ...readers]);
    expect(failures).toEqual([]);
    expect(await (await storage.get(key))!.text()).toBe("stable");
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
