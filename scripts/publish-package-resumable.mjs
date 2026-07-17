#!/usr/bin/env bun

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  hasMajorOverride,
  publishedVersions,
  validatePublishVersion,
} from "./check-publish-version-discipline.mjs";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}.` +
        (options.capture ? `\n${result.stderr || result.stdout}` : ""),
    );
  }
  return result;
}

function pack(packageRoot, destination) {
  const result = run(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", destination],
    { cwd: packageRoot, capture: true },
  );
  const reports = JSON.parse(result.stdout);
  if (!Array.isArray(reports) || reports.length !== 1) {
    throw new Error(`Unexpected npm pack report for ${packageRoot}.`);
  }
  const report = reports[0];
  if (
    typeof report.filename !== "string" ||
    typeof report.integrity !== "string"
  ) {
    throw new Error(`npm pack did not report a filename and integrity.`);
  }
  return {
    tarballPath: resolve(destination, report.filename),
    integrity: report.integrity,
  };
}

export function packageReleaseDecision(localIntegrity, publishedIntegrity) {
  if (publishedIntegrity === undefined) return "publish";
  if (publishedIntegrity === localIntegrity) return "skip";
  throw new Error(
    `published package integrity ${publishedIntegrity} does not match local tarball integrity ${localIntegrity}`,
  );
}

export async function publishedPackageIntegrity(packageName, version) {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
    { headers: { accept: "application/json" } },
  );
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new Error(
      `Could not read npm release metadata for ${packageName}@${version}: HTTP ${response.status}`,
    );
  }
  const metadata = await response.json();
  if (typeof metadata?.dist?.integrity !== "string") {
    throw new Error(
      `npm metadata for ${packageName}@${version} has no dist.integrity.`,
    );
  }
  return metadata.dist.integrity;
}

async function verifyPublishedIntegrity(
  packageName,
  version,
  localIntegrity,
  attempts = 5,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    }
    const publishedIntegrity = await publishedPackageIntegrity(
      packageName,
      version,
    );
    if (publishedIntegrity === undefined) continue;
    packageReleaseDecision(localIntegrity, publishedIntegrity);
    return;
  }
  throw new Error(
    `npm did not expose ${packageName}@${version} with the uploaded integrity after ${attempts} checks.`,
  );
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const checkOnly = argv.includes("--check-only");
  const positional = argv.filter((argument) => argument !== "--check-only");
  if (positional.length > 1) {
    throw new Error(
      "Usage: publish-package-resumable.mjs [package-directory] [--check-only]",
    );
  }
  const packageRoot = resolve(repoRoot, positional[0] ?? ".");
  const packageRelativePath = relative(repoRoot, packageRoot);
  if (
    packageRelativePath.startsWith("..") ||
    packageRelativePath.includes("/../")
  ) {
    throw new Error("Package directory must be inside yurucommu-core.");
  }
  const packageJson = JSON.parse(
    await readFile(resolve(packageRoot, "package.json"), "utf8"),
  );
  const registryVersions = await publishedVersions(packageJson.name);
  const versionResult = validatePublishVersion({
    packageName: packageJson.name,
    currentVersion: packageJson.version,
    registryVersions,
    githubRef: env.GITHUB_REF,
    allowMajor: hasMajorOverride(env),
    allowAlreadyPublished: true,
  });
  if (!versionResult.ok) {
    throw new Error(versionResult.errors.join("\n"));
  }

  const tempRoot = await mkdtemp(join(tmpdir(), "yurucommu-npm-release-"));
  try {
    const localPackage = pack(packageRoot, tempRoot);
    const publishedIntegrity = await publishedPackageIntegrity(
      packageJson.name,
      packageJson.version,
    );
    const decision = packageReleaseDecision(
      localPackage.integrity,
      publishedIntegrity,
    );
    if (decision === "skip") {
      console.log(
        `${packageJson.name}@${packageJson.version} is already published with the exact local tarball integrity; safe to skip.`,
      );
      return 0;
    }
    if (checkOnly) {
      console.log(
        `${packageJson.name}@${packageJson.version} is unpublished and ready for the resumable publish step.`,
      );
      return 0;
    }

    const publishResult = run(
      "npm",
      [
        "publish",
        localPackage.tarballPath,
        "--access",
        "public",
        "--ignore-scripts",
      ],
      { cwd: packageRoot, capture: true, allowFailure: true },
    );
    if (publishResult.status !== 0) {
      const racedIntegrity = await publishedPackageIntegrity(
        packageJson.name,
        packageJson.version,
      );
      if (racedIntegrity === localPackage.integrity) {
        console.log(
          `${packageJson.name}@${packageJson.version} was concurrently published with the exact local tarball integrity; safe to continue.`,
        );
        return 0;
      }
      throw new Error(
        `npm publish failed for ${packageJson.name}@${packageJson.version}.\n${publishResult.stderr || publishResult.stdout}`,
      );
    }

    await verifyPublishedIntegrity(
      packageJson.name,
      packageJson.version,
      localPackage.integrity,
    );
    console.log(
      `Published and verified ${packageJson.name}@${packageJson.version} (${localPackage.integrity}).`,
    );
    return 0;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
