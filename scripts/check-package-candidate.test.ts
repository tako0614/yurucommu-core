import { describe, expect, test } from "bun:test";

import { packageCandidateDecision } from "./check-package-candidate.mjs";

describe("package candidate check", () => {
  test("accepts an absent version and recognizes only exact existing bytes", () => {
    expect(packageCandidateDecision("sha512-local", undefined)).toBe(
      "unpublished",
    );
    expect(packageCandidateDecision("sha512-local", "sha512-local")).toBe(
      "already-published",
    );
  });

  test("rejects an existing version with different immutable contents", () => {
    expect(() =>
      packageCandidateDecision("sha512-local", "sha512-published"),
    ).toThrow("does not match local tarball integrity");
  });
});
