import { spawnSync } from "node:child_process";

const EXPECTED_REPOSITORY_URL = "https://github.com/tako0614/yurucommu-core";

export function assertPackageRepository(manifest, expectedPackageName) {
  if (manifest?.name !== expectedPackageName) {
    throw new Error(
      `packed manifest must be ${expectedPackageName}; received ${String(manifest?.name)}.`,
    );
  }

  const repositoryUrl = manifest?.repository?.url;
  if (repositoryUrl !== EXPECTED_REPOSITORY_URL) {
    const actual =
      typeof repositoryUrl === "string" ? repositoryUrl : "missing";
    throw new Error(
      `${expectedPackageName} packed manifest repository.url must be exactly ${EXPECTED_REPOSITORY_URL}; received ${actual}.`,
    );
  }
}

export function assertPackedPackageRepository(
  tarballPath,
  expectedPackageName,
) {
  const result = spawnSync(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `could not read packed package.json from ${tarballPath}: ${result.error?.message ?? result.stderr ?? `tar exited ${result.status}`}`,
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(
      `packed package.json for ${expectedPackageName} is invalid JSON.`,
      { cause: error },
    );
  }
  assertPackageRepository(manifest, expectedPackageName);
}
