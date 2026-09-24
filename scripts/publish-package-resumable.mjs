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

export const PUBLICATION_WAIT_BUDGET_MS = 20 * 60 * 1_000;
export const PUBLICATION_POLL_INTERVAL_MS = 30 * 1_000;
export const PUBLICATION_READ_TIMEOUT_MS = 15 * 1_000;

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

export function pack(packageRoot, destination) {
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
    files: Array.isArray(report.files)
      ? report.files
          .map((entry) => entry?.path)
          .filter((path) => typeof path === "string")
      : [],
  };
}

export function packageReleaseDecision(localIntegrity, publishedIntegrity) {
  if (publishedIntegrity === undefined) return "publish";
  if (publishedIntegrity === localIntegrity) return "skip";
  throw new Error(
    `published package integrity ${publishedIntegrity} does not match local tarball integrity ${localIntegrity}`,
  );
}

/**
 * An npm publish has crossed the mutation boundary once the command returns
 * success (and may have crossed it even when the CLI reports an error).  Keep
 * that fact attached to failures so the owning deploy entrypoint can report
 * INDETERMINATE rather than claiming the registry was untouched.
 */
export class PublishMutationError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PublishMutationError";
    this.targetTouched = true;
  }
}

export async function publishedPackageIntegrity(
  packageName,
  version,
  options = {},
) {
  const { timeoutMs = PUBLICATION_READ_TIMEOUT_MS, fetchImpl = fetch } =
    options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
      {
        headers: { accept: "application/json" },
        signal: controller.signal,
      },
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
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        `Timed out reading npm release metadata for ${packageName}@${version} after ${timeoutMs}ms.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function publicationDeadlineError(packageName, version, budgetMs, checks) {
  return new Error(
    `npm did not expose ${packageName}@${version} with the uploaded integrity within ${Math.ceil(budgetMs / 1_000)}s after ${checks} checks.`,
  );
}

function defaultPublicationProgress(message) {
  console.log(message);
}

export async function verifyPublishedIntegrity(
  packageName,
  version,
  localIntegrity,
  options = {},
) {
  const {
    maxWaitMs = PUBLICATION_WAIT_BUDGET_MS,
    pollIntervalMs = PUBLICATION_POLL_INTERVAL_MS,
    readTimeoutMs = PUBLICATION_READ_TIMEOUT_MS,
    now = Date.now,
    sleep = (delayMs) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs)),
    readIntegrity = (name, releaseVersion, readOptions) =>
      publishedPackageIntegrity(name, releaseVersion, readOptions),
    onProgress = defaultPublicationProgress,
  } = options;
  const deadline = now() + maxWaitMs;
  let checks = 0;

  while (now() < deadline) {
    checks += 1;
    const remainingMs = deadline - now();
    const publishedIntegrity = await readIntegrity(packageName, version, {
      timeoutMs: Math.max(1, Math.min(readTimeoutMs, remainingMs)),
    });
    if (publishedIntegrity !== undefined) {
      if (now() > deadline) {
        throw publicationDeadlineError(packageName, version, maxWaitMs, checks);
      }
      // A mismatch is terminal. The npm version is immutable and polling
      // cannot make a wrong tarball become the local tarball.
      packageReleaseDecision(localIntegrity, publishedIntegrity);
      return;
    }

    const waitMs = Math.min(pollIntervalMs, deadline - now());
    if (waitMs <= 0) break;
    onProgress(
      `waiting for npm publication ${packageName}@${version} (check ${checks}; next check in ${Math.ceil(waitMs / 1_000)}s)`,
    );
    await sleep(waitMs);
  }

  throw publicationDeadlineError(packageName, version, maxWaitMs, checks);
}

export async function preparePackageCandidate(
  packageRoot,
  destination,
  env = process.env,
) {
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
  if (!versionResult.ok) throw new Error(versionResult.errors.join("\n"));

  const localPackage = pack(packageRoot, destination);
  const publishedIntegrity = await publishedPackageIntegrity(
    packageJson.name,
    packageJson.version,
  );
  return {
    packageRoot,
    packageName: packageJson.name,
    version: packageJson.version,
    registryVersions,
    ...localPackage,
    decision: packageReleaseDecision(
      localPackage.integrity,
      publishedIntegrity,
    ),
  };
}

export async function publishPreparedPackage(candidate, dependencies = {}) {
  const readIntegrity =
    dependencies.publishedPackageIntegrity ?? publishedPackageIntegrity;
  const runCommand = dependencies.runCommand ?? run;
  const verifyIntegrity =
    dependencies.verifyPublishedIntegrity ?? verifyPublishedIntegrity;
  // Re-read immediately before the mutation. A concurrent publisher may have
  // created this version since preparation; only exact bytes are resumable.
  const currentIntegrity = await readIntegrity(
    candidate.packageName,
    candidate.version,
  );
  const decision = packageReleaseDecision(
    candidate.integrity,
    currentIntegrity,
  );
  if (decision === "skip") {
    return { action: "skipped", integrity: candidate.integrity };
  }

  const publishResult = runCommand(
    "npm",
    [
      "publish",
      candidate.tarballPath,
      "--access",
      "public",
      "--ignore-scripts",
    ],
    { cwd: candidate.packageRoot, capture: true, allowFailure: true },
  );
  if (publishResult.status !== 0) {
    const racedIntegrity = await readIntegrity(
      candidate.packageName,
      candidate.version,
    );
    if (racedIntegrity === candidate.integrity) {
      return { action: "concurrent-exact", integrity: candidate.integrity };
    }
    throw new PublishMutationError(
      `npm publish failed for ${candidate.packageName}@${candidate.version}.\n${publishResult.stderr || publishResult.stdout}`,
    );
  }

  try {
    await verifyIntegrity(
      candidate.packageName,
      candidate.version,
      candidate.integrity,
    );
  } catch (error) {
    throw new PublishMutationError(
      `npm publish completed for ${candidate.packageName}@${candidate.version}, but registry integrity readback failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  return { action: "published", integrity: candidate.integrity };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const checkOnly = argv.includes("--check-only");
  if (!checkOnly) {
    throw new Error(
      "standalone publisher is check-only; use `bun run deploy -- yurucommu-package-family` for publication",
    );
  }
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
  const tempRoot = await mkdtemp(join(tmpdir(), "yurucommu-npm-release-"));
  try {
    const candidate = await preparePackageCandidate(packageRoot, tempRoot, env);
    if (candidate.decision === "skip") {
      console.log(
        `${candidate.packageName}@${candidate.version} is already published with the exact local tarball integrity; safe to skip.`,
      );
      return 0;
    }
    console.log(
      `${candidate.packageName}@${candidate.version} is unpublished and ready for the resumable publish step.`,
    );
    return 0;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    // Publication is an owning-deploy concern.  This helper remains useful as
    // a read-only candidate/integrity checker, but invoking it directly must
    // never mutate the registry (or accidentally bypass deploy's clean-tag
    // and package-family gates).
    process.exitCode = await main(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
