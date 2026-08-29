#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareSemver,
  parseSemver,
} from "./check-publish-version-discipline.mjs";
import {
  preparePackageCandidate,
  publishPreparedPackage,
} from "./publish-package-resumable.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = resolve(repo, "packages/api");
const SURFACE = "yurucommu-package-family";

const CONTRACT = {
  kind: "takos.deploy-contract@v2",
  surfaces: [
    {
      surface: SURFACE,
      target: "npm:@takosjp/yurucommu-core+@takosjp/yurucommu-api",
      triggers: ["published-identity"],
      requiresScripts: ["check", "check:packed-consumer"],
      requiresTools: ["git", "bun", "npm"],
      obligations: {
        provenance:
          "refuses a dirty worktree, requires one v<version> tag on the exact source commit, runs the complete owner gate, packs core and API exactly once, records both npm sha512 integrities, and installs those exact tarballs into a throwaway consumer before publication",
        "post-conditions":
          "reads both package versions back from the npm registry, requires their published integrity to match the prepared tarballs, then installs the exact version of both packages from npm into a fresh consumer and imports their public runtime surfaces",
        reversal:
          "npm identities are immutable and cannot be rolled back in place; the entrypoint records the previous core/API versions so consumers can pin them, while a bad publication is repaired only with a new patch version",
        "failure-handling":
          "prints raw npm diagnostics, distinguishes failure before the first publish from an indeterminate partial family publication, never blindly retries, and requires an exact registry-integrity reconciliation before its resumable path can skip an existing version",
        "no-overwrite":
          "reads npm before each mutation and publishes only an absent version; an existing version is accepted only when its registry integrity exactly matches the one prepared tarball, otherwise publication stops",
      },
    },
  ],
};

if (process.argv.includes("--contract")) {
  process.stdout.write(`${JSON.stringify(CONTRACT, null, 2)}\n`);
  process.exit(0);
}

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
if (requested.length !== 1 || requested[0] !== SURFACE) {
  process.stderr.write(
    `usage: bun run deploy -- ${SURFACE}\nknown surfaces: ${SURFACE}\n`,
  );
  process.exit(1);
}

function die(message, details = []) {
  process.stderr.write(`deploy blocked before publication: ${message}\n`);
  for (const detail of details) process.stderr.write(`- ${detail}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd ?? repo,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function previousVersion(candidate) {
  return candidate.registryVersions
    .filter((version) => version !== candidate.version)
    .flatMap((version) => {
      try {
        return [parseSemver(version)];
      } catch {
        return [];
      }
    })
    .sort(compareSemver)
    .at(-1)?.raw;
}

function assertSafePackageFiles(candidate) {
  const unsafe = candidate.files.filter((path) =>
    /(^|\/)\.env(?:\.|$)|\.(?:pem|key|crt|cer|p12|pfx)$/iu.test(path),
  );
  if (unsafe.length > 0) {
    throw new Error(
      `${candidate.packageName} tarball contains credential-shaped files:\n${unsafe.join("\n")}`,
    );
  }
}

const dirty = git("status", "--porcelain");
if (dirty !== "") {
  die(
    "the worktree is not clean; immutable package bytes must belong to one commit",
    dirty.split("\n").slice(0, 30),
  );
}

const [coreManifest, apiManifest] = await Promise.all([
  readFile(resolve(repo, "package.json"), "utf8").then(JSON.parse),
  readFile(resolve(apiRoot, "package.json"), "utf8").then(JSON.parse),
]);
if (coreManifest.version !== apiManifest.version) {
  die(
    `core ${coreManifest.version} and API ${apiManifest.version} versions differ`,
  );
}
const version = coreManifest.version;
const requiredTag = `v${version}`;
const tags = git("tag", "--points-at", "HEAD").split("\n").filter(Boolean);
if (!tags.includes(requiredTag)) {
  die(`source commit is missing required release tag ${requiredTag}`);
}

const commit = git("rev-parse", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
process.stdout.write(`source ${commit} (${branch}, ${requiredTag})\n`);

process.stdout.write("\n==> bun run check\n");
run("bun", ["run", "check"]);

const tempRoot = await mkdtemp(join(tmpdir(), "yurucommu-package-family-"));
let targetTouched = false;
let candidateRecord = null;
const actions = [];
try {
  const [core, api] = await Promise.all([
    preparePackageCandidate(repo, tempRoot),
    preparePackageCandidate(apiRoot, tempRoot),
  ]);
  assertSafePackageFiles(core);
  assertSafePackageFiles(api);

  candidateRecord = {
    kind: "takos.package-candidate@v1",
    commit,
    tag: requiredTag,
    version,
    packages: [
      {
        name: core.packageName,
        integrity: core.integrity,
        decision: core.decision,
        previousVersion: previousVersion(core) ?? null,
      },
      {
        name: api.packageName,
        integrity: api.integrity,
        decision: api.decision,
        previousVersion: previousVersion(api) ?? null,
      },
    ],
  };
  process.stdout.write(`\n${JSON.stringify(candidateRecord, null, 2)}\n`);

  process.stdout.write("\n==> exact-tarball consumer check\n");
  run("bun", [
    "run",
    "check:packed-consumer",
    "--",
    "--core-tarball",
    core.tarballPath,
    "--api-tarball",
    api.tarballPath,
  ]);

  // Authentication is checked only after every non-mutating gate succeeds.
  try {
    run("npm", ["whoami"], { capture: true });
  } catch (error) {
    throw new Error(
      `npm authentication preflight failed:\n${error.stderr || error.stdout || error.message}`,
    );
  }

  for (const packageCandidate of [core, api]) {
    process.stdout.write(
      `\n==> npm publication ${packageCandidate.packageName}@${version}\n`,
    );
    let result;
    try {
      result = await publishPreparedPackage(packageCandidate);
    } catch (error) {
      // publishPreparedPackage marks failures that crossed the npm mutation
      // boundary.  Preserve that state even when registry readback times out
      // or reports a mismatch after npm accepted the tarball.
      if (error?.targetTouched === true) targetTouched = true;
      throw error;
    }
    actions.push({ name: packageCandidate.packageName, ...result });
    if (result.action !== "skipped") targetTouched = true;
    process.stdout.write(
      `${packageCandidate.packageName}@${version}: ${result.action} (${result.integrity})\n`,
    );
  }

  process.stdout.write("\n==> registry consumer readback\n");
  run("bun", [
    "run",
    "check:packed-consumer",
    "--",
    "--registry-version",
    version,
  ]);

  process.stdout.write(
    `\n${JSON.stringify(
      {
        kind: "takos.deploy-result@v1",
        surface: SURFACE,
        target: CONTRACT.surfaces[0].target,
        commit,
        tag: requiredTag,
        version,
        packages: candidateRecord.packages,
        actions,
        registryConsumer: "PASSED",
        status: "PUBLISHED",
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stderr.write(
    targetTouched
      ? "deploy failed after the npm target changed; package-family state is indeterminate. Reconcile both registry integrities before using the explicit exact-byte resume path, and forward-fix with a new version if the published bytes are wrong.\n"
      : "deploy failed before the npm target changed; registry state is untouched by this run.\n",
  );
  if (candidateRecord) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ...candidateRecord,
          actions,
          status: targetTouched ? "INDETERMINATE" : "BLOCKED",
        },
        null,
        2,
      )}\n`,
    );
  }
  process.exitCode = 1;
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
