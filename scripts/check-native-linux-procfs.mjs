#!/usr/bin/env bun

import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const prerequisiteTimeoutMs = 10_000;
const nativeSuiteTimeoutMs = 60_000;

function refuse(message) {
  console.error(message);
  process.exit(1);
}

function commandStatus(result) {
  if (result.error) {
    // Keep the original ENOENT, ETIMEDOUT, or other host diagnostic intact.
    console.error(result.error);
    return 1;
  }
  if (result.status !== null) return result.status;
  if (result.signal) return 128 + (constants.signals[result.signal] ?? 0);
  return 1;
}

function requireProbe(label, command, args, quiet = false) {
  console.log("Linux procfs prerequisite: " + label);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: ["ignore", quiet ? "ignore" : "inherit", "inherit"],
    timeout: prerequisiteTimeoutMs,
    killSignal: "SIGKILL",
  });
  const status = commandStatus(result);
  if (status !== 0) {
    console.error("Linux procfs native check refused: " + label);
    process.exit(status);
  }
}

if (process.platform !== "linux") {
  refuse("Linux procfs native check requires Linux; found " + process.platform);
}
if (typeof Bun === "undefined") {
  refuse("Linux procfs native check must run with the current Bun executable.");
}

for (const command of ["unshare", "mount", "setpriv"]) {
  requireProbe(command + " is available", command, ["--version"], true);
}

requireProbe("PID namespace and procfs mount", "unshare", [
  "--pid",
  "--fork",
  "--kill-child=SIGKILL",
  "--mount-proc",
  "true",
]);

requireProbe("hidepid=2 mount and both probe UIDs", "unshare", [
  "--mount",
  "--fork",
  "--kill-child=SIGKILL",
  "sh",
  "-c",
  'mount -t proc proc /proc -o hidepid=2 && cd /tmp && setpriv --reuid=65534 --regid=65534 --clear-groups "$1" -e "process.exit(0)" && setpriv --reuid=65533 --regid=65533 --clear-groups "$1" -e "process.exit(0)"',
  "hidepid-capability",
  process.execPath,
]);

process.exitCode = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    ["test", "test-native/runtime-path-security-linux.test.ts"],
    // Linux detached children lead a new process group. Cleanup below can
    // therefore reach this suite's unshare/shell descendants without touching
    // the caller's process group.
    { cwd: repoRoot, stdio: "inherit", detached: true },
  );
  let settled = false;

  function killSuiteProcessGroup() {
    if (!child.pid) return true;
    try {
      process.kill(-child.pid, "SIGKILL");
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      console.error(error);
      return false;
    }
  }

  function settle(status) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve(status);
  }

  const timeout = setTimeout(() => {
    console.error("Linux procfs native suite timed out after 60 seconds.");
    killSuiteProcessGroup();
    // Do not let a child that cannot complete keep the refusing CLI alive.
    // The bounded cleanup attempt targets only its own process group.
    child.unref();
    settle(124);
  }, nativeSuiteTimeoutMs);

  child.once("error", (error) => {
    if (settled) return;
    console.error(error);
    killSuiteProcessGroup();
    child.unref();
    settle(1);
  });
  child.once("exit", (status, signal) => {
    if (settled) return;
    const cleanupSucceeded = killSuiteProcessGroup();
    const suiteStatus = commandStatus({ status, signal });
    settle(suiteStatus !== 0 ? suiteStatus : cleanupSucceeded ? 0 : 1);
  });
});
