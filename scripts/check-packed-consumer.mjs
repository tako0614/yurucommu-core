#!/usr/bin/env bun

import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiRoot = resolve(repoRoot, "packages/api");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.` +
        (options.capture ? `\n${result.stderr || result.stdout}` : ""),
    );
  }
  return result.stdout;
}

function pack(packageRoot, destination) {
  const output = run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: packageRoot, capture: true },
  );
  const reports = JSON.parse(output);
  if (!Array.isArray(reports) || reports.length !== 1) {
    throw new Error(`Unexpected npm pack report for ${packageRoot}.`);
  }
  return join(destination, reports[0].filename);
}

const tempRoot = await mkdtemp(join(tmpdir(), "yurucommu-packed-consumer-"));
try {
  const argv = process.argv.slice(2);
  const valueAfter = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  const coreTarballArg = valueAfter("--core-tarball");
  const apiTarballArg = valueAfter("--api-tarball");
  const registryVersion = valueAfter("--registry-version");
  const offline =
    argv.includes("--offline") ||
    process.env.YURUCOMMU_PACKED_CONSUMER_OFFLINE === "1";
  if (Boolean(coreTarballArg) !== Boolean(apiTarballArg)) {
    throw new Error(
      "--core-tarball and --api-tarball must be provided together.",
    );
  }
  if (registryVersion && coreTarballArg) {
    throw new Error(
      "--registry-version cannot be combined with tarball arguments.",
    );
  }
  if (offline && registryVersion) {
    throw new Error(
      "--offline requires local package tarballs, not a registry version.",
    );
  }

  const coreTarball = coreTarballArg
    ? resolve(coreTarballArg)
    : registryVersion
      ? undefined
      : pack(repoRoot, tempRoot);
  const apiTarball = apiTarballArg
    ? resolve(apiTarballArg)
    : registryVersion
      ? undefined
      : pack(apiRoot, tempRoot);
  const coreSpec = registryVersion ?? `file:${coreTarball}`;
  const apiSpec = registryVersion ?? `file:${apiTarball}`;
  const consumerRoot = join(tempRoot, "consumer");
  await mkdir(consumerRoot);
  await writeFile(
    join(consumerRoot, "package.json"),
    JSON.stringify(
      {
        name: "yurucommu-packed-consumer-check",
        private: true,
        type: "module",
        dependencies: {
          "@takosjp/yurucommu-api": apiSpec,
          "@takosjp/yurucommu-core": coreSpec,
        },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    join(consumerRoot, "verify.mjs"),
    `import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import {
  CallClient,
  clearBrowserNotificationPush,
  disableBrowserNotificationPush,
  enableBrowserNotificationPush,
  fetchNotificationPusherPublicConfig,
  getBrowserNotificationPushState,
  refreshBrowserNotificationPush,
} from "@takosjp/yurucommu-api";
import {
  CallSignalingActor,
  createCallDispatcherForCalls,
  createManagedRuntimeKeyValueStore,
  createManagedRuntimeObjectStorage,
  RealtimeStreamActor,
  runYurucommuRetention,
  deliverCallSignalThroughActor,
} from "@takosjp/yurucommu-core/server";
import yurucommuCoreWorker from "@takosjp/yurucommu-core/server";
import { applyMigrations } from "@takosjp/yurucommu-core/migrations";

const coreEntry = Bun.resolveSync("@takosjp/yurucommu-core", import.meta.dir);
const coreRoot = dirname(dirname(dirname(coreEntry)));
if (!existsSync(join(coreRoot, "migrations/0019_notification_push_delivery.sql"))) {
  throw new Error("packed core is missing migration 0019_notification_push_delivery.sql");
}
for (const [name, value] of Object.entries({
  CallClient,
  applyMigrations,
  clearBrowserNotificationPush,
  createManagedRuntimeKeyValueStore,
  createManagedRuntimeObjectStorage,
  runYurucommuRetention,
  RealtimeStreamActor,
  CallSignalingActor,
  createCallDispatcherForCalls,
  deliverCallSignalThroughActor,
  disableBrowserNotificationPush,
  enableBrowserNotificationPush,
  fetchNotificationPusherPublicConfig,
  getBrowserNotificationPushState,
  refreshBrowserNotificationPush,
})) {
  if (typeof value !== "function") throw new Error(name + " is not exported");
}
if (typeof yurucommuCoreWorker.scheduled !== "function") {
  throw new Error("core default export has no scheduled retention handler");
}

const workerEntry = join(import.meta.dir, "worker-entry.ts");
await writeFile(
  workerEntry,
  [
    "export {",
    "  RealtimeStreamActor,",
    "  CallSignalingActor,",
    "  createCallDispatcherForCalls,",
    "  deliverCallSignalThroughActor,",
    '} from "@takosjp/yurucommu-core/server";',
    "",
  ].join("\\n"),
);
const builtWorker = await Bun.build({
  entrypoints: [workerEntry],
  target: "browser",
  format: "esm",
  conditions: ["workerd", "worker"],
  external: ["node:*", "cloudflare:*"],
});
if (!builtWorker.success || builtWorker.outputs.length !== 1) {
  throw new Error("packed Actor consumer did not bundle");
}
const workerBundle = await builtWorker.outputs[0].text();
for (const exportedName of [
  "RealtimeStreamActor",
  "CallSignalingActor",
  "createCallDispatcherForCalls",
  "deliverCallSignalThroughActor",
]) {
  if (!workerBundle.includes(exportedName)) {
    throw new Error("packed Worker bundle omitted " + exportedName);
  }
}
for (const match of workerBundle.matchAll(
  /["']((?:node|cloudflare):[^"']+)["']/g,
)) {
  const before = workerBundle.slice(Math.max(0, match.index - 16), match.index);
  const lazyImport = /\\bimport\\s*\\(\\s*$/.test(before);
  if (!lazyImport || match[1] !== "node:dns/promises") {
    throw new Error(
      "packed Worker bundle has non-portable import " + match[1],
    );
  }
}
console.log("packed core/API consumer verified");
`,
  );

  if (offline) {
    const installedModules = join(consumerRoot, "node_modules");
    const sharedModules = resolve(
      process.env.YURUCOMMU_PACKED_CONSUMER_MODULES ??
        join(repoRoot, "node_modules"),
    );
    await mkdir(join(installedModules, "@takosjp"), { recursive: true });
    for (const entry of await readdir(sharedModules, { withFileTypes: true })) {
      if (entry.name === ".bin" || entry.name === "@takosjp") continue;
      await symlink(
        join(sharedModules, entry.name),
        join(installedModules, entry.name),
        entry.isDirectory() ? "dir" : "file",
      );
    }
    const sharedTakosjp = join(sharedModules, "@takosjp");
    for (const entry of await readdir(sharedTakosjp, { withFileTypes: true })) {
      if (entry.name === "yurucommu-core" || entry.name === "yurucommu-api")
        continue;
      await symlink(
        join(sharedTakosjp, entry.name),
        join(installedModules, "@takosjp", entry.name),
        entry.isDirectory() ? "dir" : "file",
      );
    }
    for (const [name, tarball] of [
      ["yurucommu-core", coreTarball],
      ["yurucommu-api", apiTarball],
    ]) {
      if (!tarball) throw new Error(`Missing packed tarball for ${name}.`);
      const extractRoot = join(tempRoot, `packed-${name}`);
      await mkdir(extractRoot);
      run("tar", ["-xzf", tarball, "-C", extractRoot]);
      await symlink(
        installedModules,
        join(extractRoot, "package", "node_modules"),
        "dir",
      );
      await symlink(
        join(extractRoot, "package"),
        join(installedModules, "@takosjp", name),
        "dir",
      );
    }
  } else {
    run("bun", ["install", "--ignore-scripts"], { cwd: consumerRoot });
    run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
      cwd: consumerRoot,
    });
  }
  run("bun", ["verify.mjs"], { cwd: consumerRoot });

  const corePackageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  );
  const apiPackageJson = JSON.parse(
    await readFile(join(apiRoot, "package.json"), "utf8"),
  );
  console.log(
    registryVersion
      ? `Registry consumer verified core/API ${registryVersion}.`
      : `Packed consumer ready for core ${corePackageJson.version} and API ${apiPackageJson.version}.`,
  );
} finally {
  if (process.env.YURUCOMMU_KEEP_PACKED_CONSUMER !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Packed consumer kept at ${tempRoot}.`);
  }
}
