#!/usr/bin/env bun

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
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
  const coreTarball = pack(repoRoot, tempRoot);
  const apiTarball = pack(apiRoot, tempRoot);
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
          "@takosjp/yurucommu-api": `file:../${basename(apiTarball)}`,
          "@takosjp/yurucommu-core": `file:../${basename(coreTarball)}`,
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
import {
  clearBrowserNotificationPush,
  disableBrowserNotificationPush,
  enableBrowserNotificationPush,
  fetchNotificationPusherPublicConfig,
  getBrowserNotificationPushState,
  refreshBrowserNotificationPush,
} from "@takosjp/yurucommu-api";
import { applyMigrations } from "@takosjp/yurucommu-core/migrations";

const coreEntry = Bun.resolveSync("@takosjp/yurucommu-core", import.meta.dir);
const coreRoot = dirname(dirname(dirname(coreEntry)));
if (!existsSync(join(coreRoot, "migrations/0019_notification_push_delivery.sql"))) {
  throw new Error("packed core is missing migration 0019_notification_push_delivery.sql");
}
for (const [name, value] of Object.entries({
  applyMigrations,
  clearBrowserNotificationPush,
  disableBrowserNotificationPush,
  enableBrowserNotificationPush,
  fetchNotificationPusherPublicConfig,
  getBrowserNotificationPushState,
  refreshBrowserNotificationPush,
})) {
  if (typeof value !== "function") throw new Error(name + " is not exported");
}
console.log("packed core/API consumer verified");
`,
  );

  run("bun", ["install", "--ignore-scripts"], { cwd: consumerRoot });
  run("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: consumerRoot,
  });
  run("bun", ["verify.mjs"], { cwd: consumerRoot });

  const corePackageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  );
  const apiPackageJson = JSON.parse(
    await readFile(join(apiRoot, "package.json"), "utf8"),
  );
  console.log(
    `Packed consumer ready for core ${corePackageJson.version} and API ${apiPackageJson.version}.`,
  );
} finally {
  if (process.env.YURUCOMMU_KEEP_PACKED_CONSUMER !== "1") {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Packed consumer kept at ${tempRoot}.`);
  }
}
