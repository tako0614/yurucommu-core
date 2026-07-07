#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  if (!match) {
    throw new Error(`Expected a semver version, got ${JSON.stringify(value)}.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    raw: value,
  };
}

async function publishedVersions(packageName) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
    { headers: { accept: "application/json" } },
  );
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(
      `Could not read npm metadata for ${packageName}: HTTP ${response.status}`,
    );
  }
  const metadata = await response.json();
  return Object.keys(metadata.versions ?? {});
}

function hasMajorOverride() {
  const allow =
    process.env.YURUCOMMU_ALLOW_MAJOR_VERSION_BUMP ??
    process.env.ALLOW_MAJOR_VERSION_BUMP;
  const reason =
    process.env.YURUCOMMU_MAJOR_VERSION_REASON ??
    process.env.VERSION_BUMP_REASON ??
    "";
  return allow === "1" && reason.trim().length >= 12;
}

const packageDir = resolve(process.cwd(), process.argv[2] ?? ".");
const packageJsonPath = resolve(packageDir, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const current = parseSemver(packageJson.version);
const versions = (await publishedVersions(packageJson.name))
  .map((version) => {
    try {
      return parseSemver(version);
    } catch {
      return null;
    }
  })
  .filter(Boolean);

const highestPublishedMajor =
  versions.length > 0
    ? Math.max(...versions.map((version) => version.major))
    : -1;
const isFirstPublish = highestPublishedMajor === -1;
const startsAboveOne = isFirstPublish && current.major > 1;
const raisesMajor = !isFirstPublish && current.major > highestPublishedMajor;

if ((startsAboveOne || raisesMajor) && !hasMajorOverride()) {
  const previous =
    highestPublishedMajor === -1
      ? "no published version"
      : `published major ${highestPublishedMajor}`;
  console.error(
    [
      `${packageJson.name}@${packageJson.version} is a major-version publish from ${previous}.`,
      "Set YURUCOMMU_ALLOW_MAJOR_VERSION_BUMP=1 and YURUCOMMU_MAJOR_VERSION_REASON with a concrete release reason to publish a major bump.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(
  `Version discipline ok: ${packageJson.name}@${packageJson.version} (published major ${highestPublishedMajor === -1 ? "none" : highestPublishedMajor}).`,
);
