import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;

function repositoryFiles(
  root: string,
  include: (name: string) => boolean,
): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const filePath = join(root, entry);
    if (statSync(filePath).isDirectory()) {
      files.push(...repositoryFiles(filePath, include));
    } else if (include(entry)) {
      files.push(filePath);
    }
  }
  return files;
}

test("package-family deploy entrypoint exposes a side-effect-free contract", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "scripts/deploy.mjs", "--contract"],
    cwd: new URL("..", import.meta.url).pathname,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toBe("");

  const contract = JSON.parse(new TextDecoder().decode(result.stdout)) as {
    kind: string;
    surfaces: Array<{
      surface: string;
      triggers: string[];
      requiresScripts: string[];
      obligations: Record<string, string>;
    }>;
  };
  expect(contract.kind).toBe("takos.deploy-contract@v2");
  expect(contract.surfaces).toHaveLength(1);
  expect(contract.surfaces[0]?.surface).toBe("yurucommu-package-family");
  expect(contract.surfaces[0]?.triggers).toEqual(["published-identity"]);
  expect(contract.surfaces[0]?.requiresScripts).toEqual([
    "check",
    "check:packed-consumer",
  ]);
  expect(contract.surfaces[0]?.obligations["no-overwrite"]).toBeTruthy();
});

test("package publication has one owning deploy entrypoint", () => {
  const forbidden =
    /npm\s+publish|publishPreparedPackage|publish-package-resumable\.mjs|(?:NODE_AUTH_TOKEN|NPM_TOKEN|inputs\.publish)/u;

  for (const workflowPath of repositoryFiles(
    join(repoRoot, ".github/workflows"),
    (name) => /\.(?:yml|yaml)$/u.test(name),
  )) {
    expect(readFileSync(workflowPath, "utf8"), workflowPath).not.toMatch(
      forbidden,
    );
  }

  for (const manifestPath of [
    join(repoRoot, "package.json"),
    join(repoRoot, "packages/api/package.json"),
  ]) {
    expect(readFileSync(manifestPath, "utf8"), manifestPath).not.toMatch(
      forbidden,
    );
  }

  const allowed = new Set(["deploy.mjs", "publish-package-resumable.mjs"]);
  for (const filePath of repositoryFiles(join(repoRoot, "scripts"), (name) =>
    /\.(?:mjs|ts)$/u.test(name),
  )) {
    if (allowed.has(basename(filePath)) || filePath.endsWith(".test.ts")) {
      continue;
    }
    expect(readFileSync(filePath, "utf8"), filePath).not.toMatch(forbidden);
  }

  const publisherSource = readFileSync(
    join(repoRoot, "scripts/publish-package-resumable.mjs"),
    "utf8",
  );
  expect(publisherSource).toMatch(/if\s*\(import\.meta\.main\)/u);
  expect(publisherSource).toMatch(
    /const\s+checkOnly\s*=\s*argv\.includes\("--check-only"\)[\s\S]*if\s*\(!checkOnly\)/u,
  );
  expect(publisherSource).toMatch(/standalone publisher is check-only/u);
});

test("standalone publisher refuses mutation without check-only", () => {
  const result = Bun.spawnSync({
    cmd: ["bun", "scripts/publish-package-resumable.mjs"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(result.exitCode).not.toBe(0);
  expect(new TextDecoder().decode(result.stderr)).toContain(
    "standalone publisher is check-only",
  );
});

test("deploy preserves indeterminate state after publish readback failure", () => {
  const source = readFileSync(join(repoRoot, "scripts/deploy.mjs"), "utf8");
  expect(source).toMatch(
    /catch\s*\(error\)[\s\S]*?error\?\.targetTouched\s*===\s*true[\s\S]*?targetTouched\s*=\s*true/u,
  );
  expect(source).toMatch(
    /targetTouched\s*\?[\s\S]*?status:\s*targetTouched\s*\?\s*"INDETERMINATE"/u,
  );
});
