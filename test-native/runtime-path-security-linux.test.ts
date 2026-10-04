import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BunStorage } from "../src/backend/runtime/bun.ts";

// These real kernel probes run through bun run check:native:linux-procfs,
// whose prerequisites must pass before this unconditional suite starts.

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

test("BunStorage retains a live sibling PID namespace owner", async () => {
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

    const reopenedWhileForeignOwnerLives = await BunStorage.create(storagePath);
    expect(
      await objectText(await reopenedWhileForeignOwnerLives.get(key)),
    ).toBe("current");
    expect(await pathExists(leasePath)).toBe(true);
    expect(
      await pathExists(path.join(objectPath, `generation-${generation}.body`)),
    ).toBe(true);

    // Foreign namespace death remains unknowable from this namespace. Even
    // after the probe exits, only an operator with external authority may
    // remove the retained lease and its generation.
    await siblingOwner.close();
    siblingOwner = undefined;
    const reopenedAfterForeignOwnerExit = await BunStorage.create(storagePath);
    expect(await objectText(await reopenedAfterForeignOwnerExit.get(key))).toBe(
      "current",
    );
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
});

test("Linux hidepid=2 reports a live same-namespace different-UID owner as ENOENT and EPERM", () => {
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
});
