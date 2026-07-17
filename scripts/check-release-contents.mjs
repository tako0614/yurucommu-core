#!/usr/bin/env bun

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expectedVersionForTag } from "./check-publish-version-discipline.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const apiRoot = resolve(repoRoot, "packages/api");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function dryRunPackFiles(cwd) {
  const result = spawnSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `npm pack --dry-run failed in ${cwd}:\n${result.stderr || result.stdout}`,
    );
  }
  const reports = JSON.parse(result.stdout);
  if (!Array.isArray(reports) || reports.length !== 1) {
    throw new Error(`Unexpected npm pack report in ${cwd}.`);
  }
  return new Set((reports[0].files ?? []).map((file) => file.path));
}

function requireFiles(label, files, required, errors) {
  for (const path of required) {
    if (!files.has(path)) errors.push(`${label} package is missing ${path}.`);
  }
}

const corePackage = readJson(resolve(repoRoot, "package.json"));
const apiPackage = readJson(resolve(apiRoot, "package.json"));
const errors = [];

for (const packageJson of [corePackage, apiPackage]) {
  const expectedVersion = expectedVersionForTag(
    packageJson.name,
    process.env.GITHUB_REF,
  );
  if (
    expectedVersion !== undefined &&
    packageJson.version !== expectedVersion
  ) {
    errors.push(
      `Git tag ${process.env.GITHUB_REF} requires ${packageJson.name}@${expectedVersion}, not ${packageJson.version}.`,
    );
  }
}

const migrationFiles = readdirSync(resolve(repoRoot, "migrations"))
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const latestMigration = migrationFiles.at(-1);
if (latestMigration === undefined) {
  errors.push("No yurucommu-core SQL migration was found.");
}

const coreFiles = dryRunPackFiles(repoRoot);
const apiFiles = dryRunPackFiles(apiRoot);
requireFiles(
  "Core",
  coreFiles,
  [
    latestMigration ? `migrations/${latestMigration}` : undefined,
    "migrations/0019_notification_push_delivery.sql",
    "packages/api/src/lib/api/browser-push.ts",
    "src/backend/lib/notification-push.ts",
    "src/backend/lib/notification-pusher-contract.ts",
    "src/backend/routes/notification-pushers.ts",
  ].filter(Boolean),
  errors,
);
requireFiles(
  "API",
  apiFiles,
  [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/lib/api.d.ts",
    "dist/lib/api/browser-push.d.ts",
  ],
  errors,
);

const apiBundle = readFileSync(resolve(apiRoot, "dist/index.js"), "utf8");
for (const exportedName of [
  "fetchNotificationPusherPublicConfig",
  "getBrowserNotificationPushState",
  "enableBrowserNotificationPush",
  "refreshBrowserNotificationPush",
  "disableBrowserNotificationPush",
  "clearBrowserNotificationPush",
]) {
  if (!apiBundle.includes(exportedName)) {
    errors.push(`Built API bundle does not export ${exportedName}.`);
  }
}

const apiDeclarations = readFileSync(
  resolve(apiRoot, "dist/lib/api.d.ts"),
  "utf8",
);
if (!apiDeclarations.includes('export * from "./api/browser-push.js";')) {
  errors.push("Built API declarations do not export browser-push types.");
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Release contents ready: core ${corePackage.version}, API ${apiPackage.version}, latest migration ${latestMigration}, notification push exports present.`,
  );
}
