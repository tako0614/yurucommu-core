import { describe, expect, test } from "bun:test";

import {
  compareSemver,
  expectedVersionForTag,
  parseSemver,
  validatePublishVersion,
} from "./check-publish-version-discipline.mjs";

describe("publish version discipline", () => {
  test("orders stable and prerelease SemVer values", () => {
    expect(compareSemver(parseSemver("3.0.4"), parseSemver("3.0.3"))).toBe(1);
    expect(compareSemver(parseSemver("3.0.4"), parseSemver("3.0.4-rc.1"))).toBe(
      1,
    );
    expect(
      compareSemver(parseSemver("3.0.4-rc.2"), parseSemver("3.0.4-rc.10")),
    ).toBe(-1);
  });

  test("rejects an already-published or regressive version", () => {
    const duplicate = validatePublishVersion({
      packageName: "@takosjp/yurucommu-core",
      currentVersion: "3.0.3",
      registryVersions: ["3.0.2", "3.0.3"],
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.join("\n")).toContain("already published");
    expect(
      validatePublishVersion({
        packageName: "@takosjp/yurucommu-core",
        currentVersion: "3.0.3",
        registryVersions: ["3.0.2", "3.0.3"],
        allowAlreadyPublished: true,
      }).ok,
    ).toBe(true);

    const regressive = validatePublishVersion({
      packageName: "@takosjp/yurucommu-api",
      currentVersion: "3.0.2",
      registryVersions: ["3.0.3"],
    });
    expect(regressive.ok).toBe(false);
    expect(regressive.errors.join("\n")).toContain(
      "must be newer than the highest published version 3.0.3",
    );
  });

  test("accepts the next patch and guards major releases", () => {
    expect(
      validatePublishVersion({
        packageName: "@takosjp/yurucommu-core",
        currentVersion: "3.0.4",
        registryVersions: ["3.0.3"],
      }).ok,
    ).toBe(true);

    const major = validatePublishVersion({
      packageName: "@takosjp/yurucommu-core",
      currentVersion: "4.0.0",
      registryVersions: ["3.0.3"],
    });
    expect(major.ok).toBe(false);
    expect(major.errors.join("\n")).toContain("major-version publish");
    expect(
      validatePublishVersion({
        packageName: "@takosjp/yurucommu-core",
        currentVersion: "4.0.0",
        registryVersions: ["3.0.3"],
        allowMajor: true,
      }).ok,
    ).toBe(true);
  });

  test("requires package versions to match release tags", () => {
    const mismatch = validatePublishVersion({
      packageName: "@takosjp/yurucommu-core",
      currentVersion: "3.0.4",
      registryVersions: ["3.0.3"],
      githubRef: "refs/tags/v3.0.5",
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.errors.join("\n")).toContain(
      "requires @takosjp/yurucommu-core@3.0.5",
    );

    expect(
      expectedVersionForTag("@takosjp/yurucommu-api", "refs/tags/api-v3.0.4"),
    ).toBe("3.0.4");
    expect(
      expectedVersionForTag("@takosjp/yurucommu-core", "refs/tags/api-v3.0.4"),
    ).toBeUndefined();
  });
});
