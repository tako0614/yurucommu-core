import { describe, expect, test } from "bun:test";

import {
  packageReleaseDecision,
  publishPreparedPackage,
} from "./publish-package-resumable.mjs";

describe("resumable package release", () => {
  test("publishes an absent version and skips only an exact existing tarball", () => {
    expect(packageReleaseDecision("sha512-local", undefined)).toBe("publish");
    expect(packageReleaseDecision("sha512-local", "sha512-local")).toBe("skip");
  });

  test("rejects an existing version with different immutable contents", () => {
    expect(() =>
      packageReleaseDecision("sha512-local", "sha512-published"),
    ).toThrow("does not match local tarball integrity");
  });

  test("marks a successful npm mutation as touched when readback fails", async () => {
    const calls: string[][] = [];
    await expect(
      publishPreparedPackage(
        {
          packageName: "@takosjp/example",
          version: "3.4.5",
          integrity: "sha512-local",
          tarballPath: "/tmp/example.tgz",
          packageRoot: process.cwd(),
        },
        {
          publishedPackageIntegrity: async () => undefined,
          runCommand: (_command, args) => {
            calls.push(args);
            return { status: 0, stdout: "published", stderr: "" };
          },
          verifyPublishedIntegrity: async () => {
            throw new Error("registry readback timeout");
          },
        },
      ),
    ).rejects.toMatchObject({
      name: "PublishMutationError",
      targetTouched: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("publish");
  });
});
