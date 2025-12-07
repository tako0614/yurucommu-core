import { describe, expect, it } from "vitest";
import {
  APP_MANIFEST_SCHEMA_VERSION,
  assertSupportedAppSchemaVersion,
  validateAppSchemaVersion,
} from "./manifest.js";

describe("app manifest schema version", () => {
  it("accepts compatible schema versions with patch/minor warnings", () => {
    const patchResult = validateAppSchemaVersion({ schema_version: "1.10.1" });
    expect(patchResult.ok).toBe(true);
    expect(patchResult.warnings.some((msg) => msg.includes("patch version differs"))).toBe(true);

    const minorResult = validateAppSchemaVersion({ schema_version: "1.11.0" });
    expect(minorResult.ok).toBe(true);
    expect(minorResult.warnings.some((msg) => msg.includes("minor version differs"))).toBe(true);
  });

  it("rejects major mismatches", () => {
    const result = validateAppSchemaVersion({ schema_version: "2.0.0" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("major version mismatch");
  });

  it("asserts supported version or throws", () => {
    expect(() =>
      assertSupportedAppSchemaVersion({ schema_version: APP_MANIFEST_SCHEMA_VERSION }),
    ).not.toThrow();
    expect(() => assertSupportedAppSchemaVersion({})).toThrow(/schema_version/i);
  });
});
