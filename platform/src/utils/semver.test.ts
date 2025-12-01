import { describe, expect, it } from "vitest";
import { checkSemverCompatibility, parseSemver } from "./semver.js";

describe("semver utils", () => {
  it("parses semver strings with optional patch", () => {
    expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemver("2.5")).toEqual({ major: 2, minor: 5, patch: 0 });
    expect(parseSemver("invalid")).toBeNull();
  });

  it("checks compatibility across patch, minor, and major changes", () => {
    const same = checkSemverCompatibility("1.2.3", "1.2.3");
    expect(same.ok).toBe(true);
    expect(same.warnings.length).toBe(0);

    const patch = checkSemverCompatibility("1.2.3", "1.2.4");
    expect(patch.ok).toBe(true);
    expect(patch.warnings.some((msg) => msg.includes("patch version differs"))).toBe(true);

    const minor = checkSemverCompatibility("1.2.3", "1.3.0");
    expect(minor.ok).toBe(true);
    expect(minor.warnings.some((msg) => msg.includes("minor version differs"))).toBe(true);

    const major = checkSemverCompatibility("1.2.3", "2.0.0");
    expect(major.ok).toBe(false);
    expect(major.error).toContain("major version mismatch");

    const forced = checkSemverCompatibility("1.2.3", "2.0.0", {
      allowMajorMismatch: true,
      action: "import",
    });
    expect(forced.ok).toBe(true);
    expect(forced.warnings.some((msg) => msg.includes("forced import"))).toBe(true);
  });

  it("returns context-aware error when SemVer is invalid", () => {
    const result = checkSemverCompatibility("1.0.0", "not-semver", {
      context: "app manifest schema_version",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("app manifest schema_version");
  });
});
