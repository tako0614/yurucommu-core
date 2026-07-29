import { describe, expect, test } from "bun:test";

import { packageReleaseDecision } from "./publish-package-resumable.mjs";

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
});
