import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

import {
  assertPackageRepository,
  assertPackedPackageRepository,
} from "./npm-provenance.mjs";

const repository = {
  type: "git",
  url: "https://github.com/tako0614/yurucommu-core",
};

describe("npm package provenance metadata", () => {
  test("accepts the exact repository URL from the packed manifest", () => {
    expect(() =>
      assertPackageRepository(
        { name: "@takosjp/yurucommu-core", repository },
        "@takosjp/yurucommu-core",
      ),
    ).not.toThrow();
  });

  test("blocks a packed manifest with no repository URL", () => {
    expect(() =>
      assertPackageRepository(
        { name: "@takosjp/yurucommu-core" },
        "@takosjp/yurucommu-core",
      ),
    ).toThrow("repository.url must be exactly");
  });

  test("blocks a packed manifest that points at another repository", () => {
    expect(() =>
      assertPackageRepository(
        {
          name: "@takosjp/yurucommu-api",
          repository: {
            type: "git",
            url: "https://github.com/someone/another-repo",
          },
        },
        "@takosjp/yurucommu-api",
      ),
    ).toThrow("repository.url must be exactly");
  });

  test("blocks an unexpected packed package identity", () => {
    expect(() =>
      assertPackageRepository(
        { name: "@takosjp/not-yurucommu", repository },
        "@takosjp/yurucommu-core",
      ),
    ).toThrow("packed manifest must be @takosjp/yurucommu-core");
  });

  test("validates repository metadata from the exact package tarball", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "npm-provenance-test-"));
    const packageRoot = join(tempRoot, "package");
    const tarballPath = join(tempRoot, "package.tgz");
    try {
      await mkdir(packageRoot);
      await writeFile(
        join(packageRoot, "package.json"),
        JSON.stringify({ name: "@takosjp/yurucommu-core", repository }),
      );
      const packed = spawnSync(
        "tar",
        ["-czf", tarballPath, "-C", tempRoot, "package"],
        { encoding: "utf8" },
      );
      if (packed.status !== 0) {
        throw new Error(packed.stderr || `tar exited ${packed.status}`);
      }

      expect(() =>
        assertPackedPackageRepository(tarballPath, "@takosjp/yurucommu-core"),
      ).not.toThrow();
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
