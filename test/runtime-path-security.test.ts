import { expect, test } from "bun:test";
import { assertRejects, assertThrows } from "#test/assert";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  link,
  readFile,
  readlink,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
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

type LeaseProcessIdentityFixture = {
  bootId: string;
  pidNamespaceId: string;
  processStartToken: string;
};

type LeaseOwnerFixture = {
  version?: number;
  pid: number;
  token: string;
  processIdentity?: LeaseProcessIdentityFixture | null;
};

const siblingPidNamespaceCapability = Bun.spawnSync({
  cmd: ["unshare", "--pid", "--fork", "--mount-proc", "true"],
  stdout: "pipe",
  stderr: "pipe",
});
const siblingPidNamespaceSkipReason =
  siblingPidNamespaceCapability.exitCode === 0
    ? undefined
    : new TextDecoder()
        .decode(siblingPidNamespaceCapability.stderr)
        .trim()
        .replace(/\s+/gu, " ")
        .slice(0, 160) || "unshare PID namespace capability unavailable";
const siblingPidNamespaceTest = siblingPidNamespaceSkipReason
  ? test.skip
  : test;

const hidePidCapability = Bun.spawnSync({
  cmd: [
    "unshare",
    "--mount",
    "--fork",
    "sh",
    "-c",
    'mount -t proc proc /proc -o hidepid=2 && cd /tmp && setpriv --reuid=65534 --regid=65534 --clear-groups "$1" -e "process.exit(0)"',
    "hidepid-capability",
    process.execPath,
  ],
  stdout: "pipe",
  stderr: "pipe",
});
const hidePidSkipReason =
  hidePidCapability.exitCode === 0
    ? undefined
    : new TextDecoder()
        .decode(hidePidCapability.stderr)
        .trim()
        .replace(/\s+/gu, " ")
        .slice(0, 160) || "hidepid=2 mount capability unavailable";
const hidePidTest = hidePidSkipReason ? test.skip : test;

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

const hiddenLiveLeaseProcessProbe = {
  async readPidNamespace(): Promise<string> {
    throw errno("ENOENT");
  },
  async readPidStat(): Promise<string> {
    throw new Error("stat must not be read after a hidden namespace entry");
  },
  signal0(): void {
    throw errno("EPERM");
  },
};

const absentLeaseProcessProbe = {
  async readPidNamespace(): Promise<string> {
    throw errno("ENOENT");
  },
  async readPidStat(): Promise<string> {
    throw new Error("stat must not be read after a missing namespace entry");
  },
  signal0(): void {
    throw errno("ESRCH");
  },
};

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function objectText(
  object: { body: ReadableStream<Uint8Array> | null } | null,
): Promise<string> {
  if (!object?.body) return "";
  return await new Response(object.body).text();
}

async function objectBytes(
  object: { body: ReadableStream<Uint8Array> | null } | null,
): Promise<Uint8Array> {
  if (!object?.body) return new Uint8Array();
  return new Uint8Array(await new Response(object.body).arrayBuffer());
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

function processStartToken(statText: string): string {
  const commandEnd = statText.lastIndexOf(")");
  if (commandEnd < 0) throw new Error("invalid proc stat fixture");
  const fields = statText
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/u);
  const token = fields[19];
  if (!token || !/^\d+$/u.test(token)) {
    throw new Error("invalid proc start token fixture");
  }
  return token;
}

async function currentLeaseProcessIdentity(): Promise<LeaseProcessIdentityFixture> {
  return {
    bootId: (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
    pidNamespaceId: await readlink("/proc/self/ns/pid"),
    processStartToken: processStartToken(
      await readFile("/proc/self/stat", "utf8"),
    ),
  };
}

async function materializeLeasedOrphanGeneration(
  storagePath: string,
  key: string,
  generation: string,
  owner: LeaseOwnerFixture,
): Promise<{ objectPath: string; leasePath: string }> {
  const objectPath = internalObjectPathFor(storagePath, key);
  await writeFile(
    path.join(objectPath, `generation-${generation}.body`),
    `orphan-${generation}`,
  );
  await writeFile(
    path.join(objectPath, `generation-${generation}.meta.json`),
    JSON.stringify({
      contentType: "application/x-orphan",
      httpMetadata: { contentType: "application/x-orphan" },
    }),
  );
  const leasePath = path.join(objectPath, `tmp-${generation}.lease`);
  await writeFile(leasePath, JSON.stringify(owner));
  return { objectPath, leasePath };
}

async function exitedSameNamespaceOwner(): Promise<{
  pid: number;
  processStartToken: string;
}> {
  const subprocess = Bun.spawn({
    cmd: ["sleep", "300"],
    stdout: "ignore",
    stderr: "ignore",
  });
  const pid = subprocess.pid;
  const startToken = processStartToken(
    await readFile(`/proc/${pid}/stat`, "utf8"),
  );
  subprocess.kill();
  await subprocess.exited;
  return { pid, processStartToken: startToken };
}

function firstOuterNamespacePidGap(): number {
  for (let pid = 2; pid <= 128; pid += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === "ESRCH"
      ) {
        return pid;
      }
    }
  }
  throw new Error("no bounded outer PID gap for sibling namespace probe");
}

async function startSiblingPidNamespaceOwner(): Promise<{
  owner: LeaseOwnerFixture;
  close(): Promise<void>;
}> {
  // Create an owner whose namespace-local PID is definitely absent from this
  // process's sibling namespace. This reproduces the exact case where
  // kill(pid, 0) reports ESRCH even though the foreign writer is still live.
  const targetPid = firstOuterNamespacePidGap();
  const script = `
    target=$1
    current=1
    while [ "$current" -lt "$target" ]; do
      sleep 300 &
      owner=$!
      current=$owner
    done
    boot=$(tr -d '\\n' </proc/sys/kernel/random/boot_id)
    namespace=$(readlink /proc/$owner/ns/pid)
    start=$(awk '{print $22}' /proc/$owner/stat)
    printf '%s|%s|%s|%s\\n' "$owner" "$boot" "$namespace" "$start"
    wait "$owner"
  `;
  const subprocess = Bun.spawn({
    cmd: [
      "unshare",
      "--pid",
      "--kill-child=SIGKILL",
      "--mount-proc",
      "sh",
      "-c",
      script,
      "sibling-owner",
      String(targetPid),
    ],
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = subprocess.stdout.getReader();
  let output = "";
  try {
    while (!output.includes("\n")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      output += new TextDecoder().decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  const [pidText, bootId, pidNamespaceId, startToken] = output
    .trim()
    .split("|");
  if (
    !pidText ||
    !/^\d+$/u.test(pidText) ||
    Number(pidText) !== targetPid ||
    !bootId ||
    !pidNamespaceId ||
    !startToken
  ) {
    subprocess.kill("SIGKILL");
    await subprocess.exited;
    throw new Error("sibling PID namespace probe produced invalid identity");
  }
  return {
    owner: {
      version: 2,
      pid: Number(pidText),
      token: "sibling-live-owner",
      processIdentity: {
        bootId,
        pidNamespaceId,
        processStartToken: startToken,
      },
    },
    async close() {
      subprocess.kill("SIGKILL");
      await subprocess.exited;
    },
  };
}

async function readAsV3Generation(
  storagePath: string,
  key: string,
): Promise<{
  body: Uint8Array;
  contentType?: string;
  flatContentType?: string;
}> {
  const objectPath = internalObjectPathFor(storagePath, key);
  const marker = JSON.parse(
    await Bun.file(path.join(objectPath, "commit.json")).text(),
  ) as { generation: string };
  const metadata = JSON.parse(
    await Bun.file(
      path.join(objectPath, `generation-${marker.generation}.meta.json`),
    ).text(),
  ) as {
    contentType?: string;
    httpMetadata?: { contentType?: string };
  };
  return {
    body: new Uint8Array(
      await Bun.file(
        path.join(objectPath, `generation-${marker.generation}.body`),
      ).arrayBuffer(),
    ),
    contentType: metadata.httpMetadata?.contentType,
    flatContentType: metadata.contentType,
  };
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

    expect(await storage.get("link")).toEqual(null);
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
    expect(await objectBytes(object)).toEqual(
      new Uint8Array([...firstChunk, ...secondChunk]),
    );
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
    expect(await objectText(oldObject)).toBe("old");
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
    expect(await objectText(existingObject)).toBe("old");
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
    await storage.put("clip.webm", body, { contentType: body.type });

    const object = await storage.get("clip.webm");
    expect(object).not.toBeNull();
    expect(await objectBytes(object)).toEqual(bytes);
    expect(object?.byteLength).toBe(body.size);
    expect(object?.contentType).toBe(body.type);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage reads v3 generation metadata after the v4 upgrade", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-v3-metadata-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "legacy/avatar.png";
  const generation = "0123456789abcdef";
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  try {
    // Materialize the real v3 on-disk generation layout and metadata envelope,
    // then open it through a fresh v4 adapter. This exercises the filesystem
    // compatibility path rather than a parser-only mock.
    await BunStorage.create(storagePath);
    const objectPath = internalObjectPathFor(storagePath, key);
    const keyDigest = path.basename(objectPath);
    await mkdir(objectPath, { recursive: true });
    await writeFile(
      path.join(objectPath, `generation-${generation}.body`),
      bytes,
    );
    await writeFile(
      path.join(objectPath, `generation-${generation}.meta.json`),
      JSON.stringify({
        httpMetadata: { contentType: "image/png" },
        customMetadata: { writer: "v3" },
      }),
    );
    await writeFile(
      path.join(objectPath, "commit.json"),
      JSON.stringify({
        version: 1,
        key,
        keyHash: keyDigest,
        state: "committed",
        generation,
      }),
    );

    const upgradedStorage = await BunStorage.create(storagePath);
    const object = await upgradedStorage.get(key);
    expect(object).not.toBeNull();
    expect(await objectBytes(object)).toEqual(bytes);
    expect(object?.contentType).toBe("image/png");
    expect(object?.byteLength).toBe(bytes.byteLength);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage v4 writes remain readable by a v3 generation reader", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-v3-rollback-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "rollback/avatar.png";
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, bytes.buffer, { contentType: "image/png" });

    const legacyRead = await readAsV3Generation(storagePath, key);
    expect(legacyRead.body).toEqual(bytes);
    expect(legacyRead.contentType).toBe("image/png");
    expect(legacyRead.flatContentType).toBe("image/png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage releases a lazy read lease when the body is cancelled", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-cancel-"));
  const storagePath = path.join(root, "storage");
  const key = "cancelled.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "old", { contentType: "application/x-old" });
    const object = await storage.get(key);
    expect(object?.body).not.toBeNull();
    const reader = object!.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    await reader.cancel("caller stopped reading");

    await storage.put(key, "new", { contentType: "application/x-new" });
    expect(await objectText(await storage.get(key))).toBe("new");
    const generations = (await internalStorageEntries(storagePath)).filter(
      (entry) =>
        entry.name.startsWith("generation-") && entry.name.endsWith(".body"),
    );
    expect(generations).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage bounds generations while a lazy body remains undrained", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-undrained-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "undrained.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "old");
    const object = await storage.get(key);
    expect(object?.body).not.toBeNull();

    for (let index = 0; index < 20; index += 1) {
      await storage.put(key, `new-${index}`);
    }

    // The already-open descriptor, not a pathname lease, keeps the selected
    // bytes stable. Superseded pathname generations and lease files must
    // stay bounded even if the caller has not started consuming the body.
    const generationsWhileOpen = (
      await internalStorageEntries(storagePath)
    ).filter(
      (entry) =>
        entry.name.startsWith("generation-") && entry.name.endsWith(".body"),
    );
    expect(generationsWhileOpen).toHaveLength(1);
    expect(
      (await internalStorageEntries(storagePath)).filter((entry) =>
        entry.name.endsWith(".lease"),
      ),
    ).toHaveLength(0);
    expect(await objectText(object)).toBe("old");
    expect(await objectText(await storage.get(key))).toBe("new-19");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage fences a live writer across recovery in the assert-to-rename gap", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-writer-fence-live-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "writer-fence.bin";
  const objectPath = internalObjectPathFor(storagePath, key);
  let pauseWriter = false;
  let releaseWriter: (() => void) | undefined;
  let markWriterPaused: (() => void) | undefined;
  const reachedPublicationFence = new Promise<void>((resolve) => {
    markWriterPaused = resolve;
  });
  const writerRelease = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });

  try {
    const storage = await BunStorage.create(storagePath, {
      async beforeCommitRename(commitPath) {
        if (!pauseWriter || commitPath !== path.join(objectPath, "commit.json"))
          return;
        // This hook is invoked after assertOwned() and immediately before the
        // marker rename, reproducing the former expired-writer publication
        // gap without scheduler timing or retry loops.
        markWriterPaused?.();
        await writerRelease;
      },
    });
    await storage.put(key, "old");
    pauseWriter = true;
    const writing = storage.put(key, "new", {
      contentType: "application/x-new",
    });
    await reachedPublicationFence;

    const lease = (await readdir(objectPath)).find((name) =>
      /^tmp-[0-9a-f-]{16,}\.lease$/u.test(name),
    );
    expect(lease).toBeDefined();
    const leasePath = path.join(objectPath, lease!);
    const leaseOwner = JSON.parse(await readFile(leasePath, "utf8")) as {
      version?: unknown;
      pid?: unknown;
      token?: unknown;
      processIdentity?: unknown;
    };
    expect(leaseOwner.version).toBe(2);
    expect(leaseOwner.pid).toBe(process.pid);
    expect(leaseOwner.token).toBeString();
    expect(leaseOwner.processIdentity).toEqual(
      await currentLeaseProcessIdentity(),
    );
    // Age is not liveness authority: a stopped-but-live process can resume.
    await utimes(leasePath, new Date(0), new Date(0));

    const reopenedWhilePaused = await BunStorage.create(storagePath);
    expect(await objectText(await reopenedWhilePaused.get(key))).toBe("old");
    expect(await pathExists(leasePath)).toBe(true);
    const generation = lease!.slice("tmp-".length, -".lease".length);
    expect(
      await pathExists(path.join(objectPath, `generation-${generation}.body`)),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(objectPath, `generation-${generation}.meta.json`),
      ),
    ).toBe(true);

    releaseWriter?.();
    await writing;
    expect(await objectText(await storage.get(key))).toBe("new");
    expect(await objectText(await reopenedWhilePaused.get(key))).toBe("new");
  } finally {
    releaseWriter?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage refuses publication after writer lease ownership is lost", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-writer-fence-lost-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "writer-fence-lost.bin";
  const objectPath = internalObjectPathFor(storagePath, key);
  let objectDirectorySyncs = 0;
  let pauseWriter = false;
  let markWriterPaused: (() => void) | undefined;
  const writerPaused = new Promise<void>((resolve) => {
    markWriterPaused = resolve;
  });
  let releaseWriter: (() => void) | undefined;
  const writerRelease = new Promise<void>((resolve) => {
    releaseWriter = resolve;
  });

  try {
    const storage = await BunStorage.create(storagePath, {
      async syncDirectory(directoryPath) {
        if (!pauseWriter || directoryPath !== objectPath) return;
        objectDirectorySyncs += 1;
        if (objectDirectorySyncs === 2) {
          markWriterPaused?.();
          await writerRelease;
        }
      },
    });
    await storage.put(key, "old");
    pauseWriter = true;
    objectDirectorySyncs = 0;
    const writing = storage.put(key, "must-not-publish");
    await writerPaused;

    const lease = (await readdir(objectPath)).find((name) =>
      /^tmp-[0-9a-f-]{16,}\.lease$/u.test(name),
    );
    expect(lease).toBeDefined();
    await rm(path.join(objectPath, lease!));

    releaseWriter?.();
    await expect(writing).rejects.toThrow(/writer lease/u);
    expect(await objectText(await storage.get(key))).toBe("old");
    const reopened = await BunStorage.create(storagePath);
    expect(await objectText(await reopened.get(key))).toBe("old");
  } finally {
    releaseWriter?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage retains legacy, malformed, and unavailable-proc owners as unknown", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-lease-legacy-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "legacy-owner.bin";
  const generation = "1111111111111111";
  const malformedGeneration = "1111111111111112";
  const unavailableProcGeneration = "1111111111111113";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "current");
    const exitedOwner = await exitedSameNamespaceOwner();
    const { objectPath, leasePath } = await materializeLeasedOrphanGeneration(
      storagePath,
      key,
      generation,
      {
        pid: exitedOwner.pid,
        token: "legacy-owner-without-durable-identity",
      },
    );
    const malformed = await materializeLeasedOrphanGeneration(
      storagePath,
      key,
      malformedGeneration,
      {
        pid: exitedOwner.pid,
        token: "malformed-owner",
      },
    );
    await writeFile(malformed.leasePath, '{"version":2');
    const unavailableProc = await materializeLeasedOrphanGeneration(
      storagePath,
      key,
      unavailableProcGeneration,
      {
        version: 2,
        pid: exitedOwner.pid,
        token: "proc-identity-unavailable-owner",
        processIdentity: null,
      },
    );

    const warnings: string[] = [];
    const originalWarn = console.warn;
    try {
      console.warn = (...values: unknown[]) => {
        warnings.push(values.map(String).join(" "));
      };
      const reopened = await BunStorage.create(storagePath);
      expect(await objectText(await reopened.get(key))).toBe("current");
      // A second recovery observes the same unknown owner but must not flood
      // logs. The one diagnostic is fixed, bounded, and gives only the manual
      // cleanup boundary—not the key, path, PID, token, or /proc values.
      await BunStorage.create(storagePath);
    } finally {
      console.warn = originalWarn;
    }
    expect(warnings).toEqual([
      "BunStorage retained an unverifiable lease; automatic reclaim is disabled. Confirm that no writer is active before operator cleanup (lease-owner-unknown).",
    ]);
    expect(warnings[0]!.length).toBeLessThanOrEqual(200);
    const diagnostics = JSON.stringify(warnings);
    for (const privateValue of [
      root,
      key,
      String(exitedOwner.pid),
      exitedOwner.processStartToken,
      "legacy-owner-without-durable-identity",
      "proc-identity-unavailable-owner",
    ]) {
      expect(diagnostics).not.toContain(privateValue);
    }
    expect(await pathExists(leasePath)).toBe(true);
    expect(
      await pathExists(path.join(objectPath, `generation-${generation}.body`)),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(objectPath, `generation-${generation}.meta.json`),
      ),
    ).toBe(true);
    expect(await pathExists(malformed.leasePath)).toBe(true);
    expect(
      await pathExists(
        path.join(
          malformed.objectPath,
          `generation-${malformedGeneration}.body`,
        ),
      ),
    ).toBe(true);
    expect(await pathExists(unavailableProc.leasePath)).toBe(true);
    expect(
      await pathExists(
        path.join(
          unavailableProc.objectPath,
          `generation-${unavailableProcGeneration}.body`,
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          unavailableProc.objectPath,
          `generation-${unavailableProcGeneration}.meta.json`,
        ),
      ),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(
          malformed.objectPath,
          `generation-${malformedGeneration}.meta.json`,
        ),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage retains a same-namespace owner hidden by procfs", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-lease-hidden-proc-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "hidden-proc-owner.bin";
  const generation = "2111111111111111";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "current");
    const processIdentity = await currentLeaseProcessIdentity();
    const exitedOwner = await exitedSameNamespaceOwner();
    const { objectPath, leasePath } = await materializeLeasedOrphanGeneration(
      storagePath,
      key,
      generation,
      {
        version: 2,
        pid: exitedOwner.pid,
        token: "hidden-live-owner",
        processIdentity: {
          ...processIdentity,
          processStartToken: exitedOwner.processStartToken,
        },
      },
    );

    const reopened = await BunStorage.create(storagePath, {
      leaseProcessProbe: hiddenLiveLeaseProcessProbe,
    });
    expect(await objectText(await reopened.get(key))).toBe("current");
    expect(await pathExists(leasePath)).toBe(true);
    expect(
      await pathExists(path.join(objectPath, `generation-${generation}.body`)),
    ).toBe(true);
    expect(
      await pathExists(
        path.join(objectPath, `generation-${generation}.meta.json`),
      ),
    ).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage reclaims an orphan from a proved-dead same-namespace process", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-lease-dead-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "dead-owner.bin";
  const generation = "2222222222222222";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "current");
    const processIdentity = await currentLeaseProcessIdentity();
    const exitedOwner = await exitedSameNamespaceOwner();
    const { objectPath, leasePath } = await materializeLeasedOrphanGeneration(
      storagePath,
      key,
      generation,
      {
        version: 2,
        pid: exitedOwner.pid,
        token: "proved-dead-owner",
        processIdentity: {
          ...processIdentity,
          processStartToken: exitedOwner.processStartToken,
        },
      },
    );

    const reopened = await BunStorage.create(storagePath, {
      // An ENOENT /proc lookup becomes death authority only when the already
      // same-boot/same-namespace PID is also absent from signal 0.
      leaseProcessProbe: absentLeaseProcessProbe,
    });
    expect(await objectText(await reopened.get(key))).toBe("current");
    expect(await pathExists(leasePath)).toBe(false);
    expect(
      await pathExists(path.join(objectPath, `generation-${generation}.body`)),
    ).toBe(false);
    expect(
      await pathExists(
        path.join(objectPath, `generation-${generation}.meta.json`),
      ),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage reclaims an orphan after same-namespace PID incarnation mismatch", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-lease-pid-reuse-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "pid-reuse-owner.bin";
  const generation = "3333333333333333";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "current");
    const processIdentity = await currentLeaseProcessIdentity();
    const { objectPath, leasePath } = await materializeLeasedOrphanGeneration(
      storagePath,
      key,
      generation,
      {
        version: 2,
        pid: process.pid,
        token: "old-incarnation-owner",
        processIdentity: {
          ...processIdentity,
          processStartToken: (
            BigInt(processIdentity.processStartToken) + 1n
          ).toString(),
        },
      },
    );

    const reopened = await BunStorage.create(storagePath);
    expect(await objectText(await reopened.get(key))).toBe("current");
    expect(await pathExists(leasePath)).toBe(false);
    expect(
      await pathExists(path.join(objectPath, `generation-${generation}.body`)),
    ).toBe(false);
    expect(
      await pathExists(
        path.join(objectPath, `generation-${generation}.meta.json`),
      ),
    ).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

siblingPidNamespaceTest(
  `BunStorage retains a live sibling PID namespace owner${
    siblingPidNamespaceSkipReason
      ? ` (skipped: ${siblingPidNamespaceSkipReason})`
      : ""
  }`,
  async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "yurucommu-storage-lease-sibling-namespace-"),
    );
    const storagePath = path.join(root, "storage");
    const key = "sibling-namespace-owner.bin";
    const generation = "4444444444444444";
    let siblingOwner:
      Awaited<ReturnType<typeof startSiblingPidNamespaceOwner>> | undefined;

    try {
      const storage = await BunStorage.create(storagePath);
      await storage.put(key, "current");
      siblingOwner = await startSiblingPidNamespaceOwner();
      const { objectPath, leasePath } = await materializeLeasedOrphanGeneration(
        storagePath,
        key,
        generation,
        siblingOwner.owner,
      );

      const reopenedWhileForeignOwnerLives =
        await BunStorage.create(storagePath);
      expect(
        await objectText(await reopenedWhileForeignOwnerLives.get(key)),
      ).toBe("current");
      expect(await pathExists(leasePath)).toBe(true);
      expect(
        await pathExists(
          path.join(objectPath, `generation-${generation}.body`),
        ),
      ).toBe(true);

      // Foreign namespace death remains unknowable from this namespace. Even
      // after the probe exits, only an operator with external authority may
      // remove the retained lease and its generation.
      await siblingOwner.close();
      siblingOwner = undefined;
      const reopenedAfterForeignOwnerExit =
        await BunStorage.create(storagePath);
      expect(
        await objectText(await reopenedAfterForeignOwnerExit.get(key)),
      ).toBe("current");
      expect(await pathExists(leasePath)).toBe(true);
      expect(
        await pathExists(
          path.join(objectPath, `generation-${generation}.meta.json`),
        ),
      ).toBe(true);
    } finally {
      await siblingOwner?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

hidePidTest(
  `Linux hidepid=2 reports a live same-namespace different-UID owner as ENOENT and EPERM${
    hidePidSkipReason ? ` (skipped: ${hidePidSkipReason})` : ""
  }`,
  () => {
    const script = `
      mount -t proc proc /proc -o hidepid=2
      setpriv --reuid=65534 --regid=65534 --clear-groups sleep 30 &
      owner=$!
      sleep 0.05
      proc_code=$(cd /tmp && OWNER_PID="$owner" setpriv --reuid=65533 --regid=65533 --clear-groups "$1" -e '
        import { readlink } from "node:fs/promises";
        try {
          await readlink("/proc/" + process.env.OWNER_PID + "/ns/pid");
          console.log("visible");
        } catch (error) {
          console.log(error.code);
        }
      ')
      signal_code=$(cd /tmp && OWNER_PID="$owner" setpriv --reuid=65533 --regid=65533 --clear-groups "$1" -e '
        try {
          process.kill(Number(process.env.OWNER_PID), 0);
          console.log("visible");
        } catch (error) {
          console.log(error.code);
        }
      ')
      kill -0 "$owner"
      printf '%s|%s\\n' "$proc_code" "$signal_code"
      kill "$owner"
      wait "$owner" 2>/dev/null || true
    `;
    const result = Bun.spawnSync({
      cmd: [
        "unshare",
        "--mount",
        "--fork",
        "sh",
        "-c",
        script,
        "hidepid-probe",
        process.execPath,
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe("ENOENT|EPERM");
  },
);

test("BunStorage refuses internal hardlinks and symlink swaps", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-owned-files-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "owned.bin";

  try {
    const storage = await BunStorage.create(storagePath);
    await storage.put(key, "safe", { contentType: "application/octet-stream" });
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
      JSON.stringify({ contentType: "application/octet-stream" }),
    );
    await rm(metaPath);
    await link(outsideMeta, metaPath);
    expect(await storage.get(key)).toBeNull();

    // A symlink at the final marker component is rejected by O_NOFOLLOW and
    // the lstat/fstat identity checks, even when the target stays in-root.
    await rm(metaPath);
    await writeFile(
      metaPath,
      JSON.stringify({ contentType: "application/octet-stream" }),
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
      contentType: "application/x-generation-old",
    });
    const circular = {} as { self?: unknown };
    circular.self = circular;

    await assertRejects(() =>
      storage.put("stable.bin", "new", {
        contentType: circular as unknown as string,
      }),
    );
    const object = await storage.get("stable.bin");
    expect(object).not.toBeNull();
    expect(await objectText(object)).toBe("old");
    expect(object?.contentType).toBe("application/x-generation-old");

    await assertRejects(() =>
      storage.put("empty.bin", "new", {
        contentType: circular as unknown as string,
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
    await storage.put(key, "old", { contentType: "application/x-old" });

    failMarkerSync = true;
    objectDirectorySyncs = 0;
    await expect(
      storage.put(key, "new", { contentType: "application/x-new" }),
    ).rejects.toThrow(/simulated marker directory fsync failure/u);

    // Rename has already published the new complete generation. A durability
    // error must reject the writer without deleting the generation named by
    // commit.json or allowing a null/corrupt read.
    const visible = await storage.get(key);
    expect(visible).not.toBeNull();
    expect(await objectText(visible)).toBe("new");
    expect(visible?.contentType).toBe("application/x-new");

    // A fresh adapter must recover the same marker/generation pair and clean
    // the superseded generation without treating the failed fsync as a
    // partially-published object.
    const recovered = await BunStorage.create(storagePath);
    const recoveredObject = await recovered.get(key);
    expect(recoveredObject).not.toBeNull();
    expect(await objectText(recoveredObject)).toBe("new");
    expect(recoveredObject?.contentType).toBe("application/x-new");
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
      contentType: "application/x-writer-a",
    });
    const writeB = storage.put("race.bin", new File(["writer-b"], "b"), {
      contentType: "application/x-writer-b",
    });
    await Promise.all([writeA, writeB]);

    const object = await storage.get("race.bin");
    expect(object).not.toBeNull();
    const body = await objectText(object);
    expect(["writer-a", "writer-b"]).toContain(body);
    expect(object?.contentType).toBe(
      body === "writer-a" ? "application/x-writer-a" : "application/x-writer-b",
    );
    expect(object?.byteLength).toBe(body.length);

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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage cross-instance writers keep one committed generation readable after reopen", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "yurucommu-storage-cross-instance-"),
  );
  const storagePath = path.join(root, "storage");
  const key = "cross-instance-race.bin";

  try {
    const first = await BunStorage.create(storagePath);
    const second = await BunStorage.create(storagePath);
    await first.put(key, "seed", { contentType: "application/x-seed" });

    let committedBody = "seed";
    let committedContentType = "application/x-seed";
    for (let index = 0; index < 12; index += 1) {
      const firstBody = `first-${index}`;
      const secondBody = `second-${index}`;
      const firstContentType = `application/x-first-${index}`;
      const secondContentType = `application/x-second-${index}`;

      await Promise.all([
        first.put(key, firstBody, { contentType: firstContentType }),
        second.put(key, secondBody, { contentType: secondContentType }),
      ]);

      const [fromFirst, fromSecond] = await Promise.all([
        first.get(key),
        second.get(key),
      ]);
      expect(fromFirst).not.toBeNull();
      expect(fromSecond).not.toBeNull();
      const [bodyFromFirst, bodyFromSecond] = await Promise.all([
        objectText(fromFirst),
        objectText(fromSecond),
      ]);
      expect(bodyFromSecond).toBe(bodyFromFirst);
      expect([firstBody, secondBody]).toContain(bodyFromFirst);
      committedBody = bodyFromFirst;
      committedContentType =
        bodyFromFirst === firstBody ? firstContentType : secondContentType;
      expect(fromFirst?.contentType).toBe(committedContentType);
      expect(fromSecond?.contentType).toBe(committedContentType);
      expect(fromFirst?.byteLength).toBe(committedBody.length);
      expect(fromSecond?.byteLength).toBe(committedBody.length);
    }

    // A newly-created adapter models a rolling-process reopen. It must follow
    // the same committed marker and must not reclaim that generation while
    // recovering leftovers from either concurrent writer.
    const reopened = await BunStorage.create(storagePath);
    const afterReopen = await reopened.get(key);
    expect(afterReopen).not.toBeNull();
    expect(await objectText(afterReopen)).toBe(committedBody);
    expect(afterReopen?.contentType).toBe(committedContentType);
    expect(afterReopen?.byteLength).toBe(committedBody.length);
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
      await storage.put(key, key, { contentType: "application/x-key" });
    }
    for (const key of keys) {
      const object = await storage.get(key);
      expect(object).not.toBeNull();
      expect(await objectText(object)).toBe(key);
      expect(object?.contentType).toBe("application/x-key");
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
    expect(await objectText(legacyRoot)).toBe("legacy-root");
    await fileStorage.put(".yurucommu-objects", "rewritten-root", {
      contentType: "application/x-legacy",
    });
    expect(await objectText(await fileStorage.get(".yurucommu-objects"))).toBe(
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
      await objectText(
        await directoryStorage.get(".yurucommu-objects/child.bin"),
      ),
    ).toBe("legacy-child");
    await directoryStorage.put(
      ".yurucommu-objects/child.bin",
      "rewritten-child",
    );
    expect(
      await objectText(
        await directoryStorage.get(".yurucommu-objects/child.bin"),
      ),
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
        contentType: `application/x-generation-${index}`,
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
      contentType: "application/x-live",
    });

    await storage.delete("bounded.bin");
    expect(await storage.get("bounded.bin")).toBeNull();
    expect(
      (await internalStorageEntries(storagePath)).filter(
        (entry) =>
          entry.path.startsWith(boundedObjectPrefix) &&
          entry.name.startsWith("generation-"),
      ),
    ).toHaveLength(0);
    expect(await objectText(await storage.get("live.bin"))).toBe("live");
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
    expect(await objectText(await storage.get(key))).toBe("next");
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
      contentType: "application/x-old",
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
      contentType: "application/x-new",
    });
    await secondPullStarted;

    const during = await storage.get("reader.bin");
    expect(during).not.toBeNull();
    expect(await objectText(during)).toBe("old");
    expect(during?.contentType).toBe("application/x-old");

    releaseSecondPull?.();
    await writing;
    const after = await storage.get("reader.bin");
    expect(after).not.toBeNull();
    expect(await objectText(after)).toBe("new");
    expect(after?.contentType).toBe("application/x-new");
  } finally {
    releaseSecondPull?.();
    await rm(root, { recursive: true, force: true });
  }
});

test("BunStorage keeps reads non-null during deterministic same- and cross-instance publication overlap", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "yurucommu-storage-stress-"));
  const storagePath = path.join(root, "storage");
  const key = "stress.bin";
  const objectPath = internalObjectPathFor(storagePath, key);
  let objectDirectorySyncs = 0;
  let publicationPause:
    | {
        reached: () => void;
        release: Promise<void>;
      }
    | undefined;

  try {
    const storage = await BunStorage.create(storagePath, {
      async syncDirectory(directoryPath) {
        if (!publicationPause || directoryPath !== objectPath) return;
        objectDirectorySyncs += 1;
        // put() syncs after renaming the body, then the metadata, then the
        // commit marker. Pause after the complete new generation exists but
        // before its marker is published, which deterministically overlaps
        // readers with the exact publication/GC boundary under test.
        if (objectDirectorySyncs === 2) {
          publicationPause.reached();
          await publicationPause.release;
        }
      },
    });
    const rollingStorage = await BunStorage.create(storagePath);
    await storage.put(key, "seed", {
      contentType: "application/x-seed",
    });

    let reopenedDuringPublication: BunStorage | undefined;
    let previousBody = "seed";
    let previousContentType = "application/x-seed";
    for (let writeIndex = 0; writeIndex < 12; writeIndex += 1) {
      objectDirectorySyncs = 0;
      let markPublicationReached: (() => void) | undefined;
      const publicationReached = new Promise<void>((resolve) => {
        markPublicationReached = resolve;
      });
      let releasePublication: (() => void) | undefined;
      const release = new Promise<void>((resolve) => {
        releasePublication = resolve;
      });
      publicationPause = {
        reached: () => markPublicationReached?.(),
        release,
      };

      const nextBody = `value-${writeIndex}`;
      const nextContentType = `application/x-value-${writeIndex}`;
      const writing = storage.put(key, nextBody, {
        contentType: `application/x-value-${writeIndex}`,
      });
      await publicationReached;

      try {
        const overlappingReads = await Promise.all(
          Array.from({ length: 8 }, (_, readerIndex) =>
            (readerIndex % 2 === 0 ? storage : rollingStorage).get(key),
          ),
        );
        expect(overlappingReads.every((object) => object !== null)).toBe(true);
        expect(
          await Promise.all(
            overlappingReads.map((object) => objectText(object)),
          ),
        ).toEqual(Array.from({ length: 8 }, () => previousBody));
        expect(overlappingReads.map((object) => object?.contentType)).toEqual(
          Array.from({ length: 8 }, () => previousContentType),
        );
        if (writeIndex === 0) {
          // Model a rolling process opening the store while the next complete
          // generation exists but its marker has not been published. Startup
          // recovery must preserve the leased generation and still expose the
          // previously committed object.
          reopenedDuringPublication = await BunStorage.create(storagePath);
          const reopenedBeforePublication =
            await reopenedDuringPublication.get(key);
          expect(await objectText(reopenedBeforePublication)).toBe(
            previousBody,
          );
          expect(reopenedBeforePublication?.contentType).toBe(
            previousContentType,
          );
        }
      } finally {
        releasePublication?.();
        await writing;
        publicationPause = undefined;
      }

      const [sameInstance, crossInstance] = await Promise.all([
        storage.get(key),
        rollingStorage.get(key),
      ]);
      expect(await objectText(sameInstance)).toBe(nextBody);
      expect(await objectText(crossInstance)).toBe(nextBody);
      expect(sameInstance?.contentType).toBe(nextContentType);
      expect(crossInstance?.contentType).toBe(nextContentType);
      if (reopenedDuringPublication) {
        const reopenedAfterPublication =
          await reopenedDuringPublication.get(key);
        expect(await objectText(reopenedAfterPublication)).toBe(nextBody);
        expect(reopenedAfterPublication?.contentType).toBe(nextContentType);
      }
      previousBody = nextBody;
      previousContentType = nextContentType;
    }
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
    await storage.put(key, "stable", { contentType: "application/x-stable" });
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
        if ((await objectText(object)) !== "stable") {
          failures.push(`reader-${readerIndex}: mismatched body`);
        }
      }
    });
    await Promise.all([churn, ...readers]);
    expect(failures).toEqual([]);
    expect(await objectText(await storage.get(key))).toBe("stable");
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
