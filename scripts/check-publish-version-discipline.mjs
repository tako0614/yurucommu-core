#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseSemver(value) {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value,
    );
  if (!match) {
    throw new Error(`Expected a semver version, got ${JSON.stringify(value)}.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split(".") ?? [],
    raw: value,
  };
}

export function compareSemver(left, right) {
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) < Number(rightPart) ? -1 : 1;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export async function publishedVersions(packageName) {
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

export function hasMajorOverride(env = process.env) {
  const allow =
    env.YURUCOMMU_ALLOW_MAJOR_VERSION_BUMP ?? env.ALLOW_MAJOR_VERSION_BUMP;
  const reason =
    env.YURUCOMMU_MAJOR_VERSION_REASON ?? env.VERSION_BUMP_REASON ?? "";
  return allow === "1" && reason.trim().length >= 12;
}

export function expectedVersionForTag(packageName, githubRef) {
  if (typeof githubRef !== "string") return undefined;
  const apiTag = /^refs\/tags\/api-v(.+)$/.exec(githubRef);
  if (apiTag) {
    return packageName === "@takosjp/yurucommu-api" ? apiTag[1] : undefined;
  }
  return /^refs\/tags\/v(.+)$/.exec(githubRef)?.[1];
}

export function validatePublishVersion({
  packageName,
  currentVersion,
  registryVersions,
  githubRef,
  allowMajor = false,
  allowAlreadyPublished = false,
}) {
  const current = parseSemver(currentVersion);
  const versions = registryVersions.flatMap((version) => {
    try {
      return [parseSemver(version)];
    } catch {
      return [];
    }
  });
  const errors = [];
  const expectedTagVersion = expectedVersionForTag(packageName, githubRef);
  if (expectedTagVersion !== undefined) {
    try {
      parseSemver(expectedTagVersion);
      if (expectedTagVersion !== currentVersion) {
        errors.push(
          `Git tag ${githubRef} requires ${packageName}@${expectedTagVersion}, not ${currentVersion}.`,
        );
      }
    } catch {
      errors.push(
        `Git tag ${githubRef} does not contain a valid SemVer version.`,
      );
    }
  }

  const alreadyPublished = registryVersions.includes(currentVersion);
  if (alreadyPublished && !allowAlreadyPublished) {
    errors.push(
      `${packageName}@${currentVersion} is already published; choose a new package version before publishing.`,
    );
  }

  const highest = versions.reduce(
    (selected, version) =>
      selected === undefined || compareSemver(version, selected) > 0
        ? version
        : selected,
    undefined,
  );
  if (
    highest !== undefined &&
    !alreadyPublished &&
    compareSemver(current, highest) <= 0
  ) {
    errors.push(
      `${packageName}@${currentVersion} must be newer than the highest published version ${highest.raw}.`,
    );
  }

  const isFirstPublish = highest === undefined;
  const startsAboveOne = isFirstPublish && current.major > 1;
  const raisesMajor = !isFirstPublish && current.major > highest.major;
  if ((startsAboveOne || raisesMajor) && !allowMajor) {
    const previous = isFirstPublish
      ? "no published version"
      : `published major ${highest.major}`;
    errors.push(
      `${packageName}@${currentVersion} is a major-version publish from ${previous}.`,
    );
    errors.push(
      "Set YURUCOMMU_ALLOW_MAJOR_VERSION_BUMP=1 and YURUCOMMU_MAJOR_VERSION_REASON with a concrete release reason to publish a major bump.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    current,
    highest,
    expectedTagVersion,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const packageDir = resolve(process.cwd(), argv[0] ?? ".");
  const packageJsonPath = resolve(packageDir, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const registryVersions = await publishedVersions(packageJson.name);
  const result = validatePublishVersion({
    packageName: packageJson.name,
    currentVersion: packageJson.version,
    registryVersions,
    githubRef: env.GITHUB_REF,
    allowMajor: hasMajorOverride(env),
  });
  if (!result.ok) {
    console.error(result.errors.join("\n"));
    return 1;
  }
  console.log(
    `Version discipline ok: ${packageJson.name}@${packageJson.version} (highest published ${result.highest?.raw ?? "none"}).`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await main();
}
