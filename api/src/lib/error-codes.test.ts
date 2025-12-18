import { describe, expect, it } from "vitest";
import { ErrorCodes, ErrorCodeHttpStatus } from "./error-codes";

describe("error codes", () => {
  it("exports every error code from docs/plan/13-error-codes.md", () => {
    const expected = [
      // Auth / Authorization
      "UNAUTHORIZED",
      "INVALID_TOKEN",
      "TOKEN_EXPIRED",
      "FORBIDDEN",
      "INSUFFICIENT_PERMISSIONS",
      "OWNER_REQUIRED",
      "PLAN_REQUIRED",
      "FEATURE_UNAVAILABLE",

      // Resources
      "NOT_FOUND",
      "OBJECT_NOT_FOUND",
      "ACTOR_NOT_FOUND",
      "USER_NOT_FOUND",
      "COMMUNITY_NOT_FOUND",
      "THREAD_NOT_FOUND",
      "POLL_NOT_FOUND",
      "MEDIA_NOT_FOUND",

      // Validation
      "VALIDATION_ERROR",
      "INVALID_INPUT",
      "MISSING_REQUIRED_FIELD",
      "INVALID_FORMAT",
      "CONTENT_TOO_LONG",
      "INVALID_VISIBILITY",
      "INVALID_OPTION",

      // Duplication / Conflict
      "ALREADY_EXISTS",
      "ALREADY_LIKED",
      "ALREADY_VOTED",
      "ALREADY_FOLLOWED",
      "ALREADY_MEMBER",
      "DUPLICATE_HANDLE",

      // Operation restrictions
      "POLL_ENDED",
      "SINGLE_CHOICE_ONLY",
      "RESULTS_HIDDEN",
      "NOT_A_POLL",
      "SELF_ACTION_FORBIDDEN",
      "BLOCKED_USER",
      "PRIVATE_ACCOUNT",

      // Rate limiting
      "RATE_LIMIT_EXCEEDED",
      "RATE_LIMIT_MINUTE",
      "RATE_LIMIT_DAY",
      "AI_LIMIT_EXCEEDED",

      // Storage
      "STORAGE_LIMIT_EXCEEDED",
      "FILE_TOO_LARGE",
      "INVALID_FILE_TYPE",
      "UPLOAD_FAILED",

      // ActivityPub
      "MISSING_SIGNATURE",
      "SIGNATURE_EXPIRED",
      "SIGNATURE_FUTURE",
      "SIGNATURE_INVALID",
      "DIGEST_MISMATCH",
      "KEY_MISMATCH",
      "MISSING_REQUIRED_HEADER",
      "FEDERATION_DISABLED",
      "INSTANCE_BLOCKED",

      // API access
      "API_WRITE_UNAVAILABLE",
      "API_KEY_INVALID",
      "API_KEY_EXPIRED",

      // AI
      "AI_UNAVAILABLE",
      "AI_PROVIDER_ERROR",
      "DATA_POLICY_VIOLATION",
      "ACTION_VIOLATES_NODE_POLICY",

      // App definition
      "MANIFEST_VALIDATION_ERROR",
      "HANDLER_EXECUTION_ERROR",
      "RESERVED_ROUTE",
      "CYCLIC_DEPENDENCY",
      "DANGEROUS_APP_PATTERN",
      "ESBUILD_ERROR",
      "NO_COMPILER",

      // Audit trail
      "AUDIT_INTEGRITY_VIOLATION",
      "AUDIT_WRITE_FAILED",

      // Sandbox
      "SANDBOX_TIMEOUT",
      "SANDBOX_OOM",
      "SANDBOX_OUTPUT_VIOLATION",
      "SANDBOX_SECURITY_ERROR",
      "TOOL_NOT_ALLOWED",
      "PERMISSION_REVOKED",

      // Internal
      "INTERNAL_ERROR",
      "DATABASE_ERROR",
      "CONFIGURATION_ERROR",
      "SERVICE_UNAVAILABLE",
    ] as const;

    expect(Object.keys(ErrorCodes).sort()).toEqual([...expected].sort());
    expect(new Set(Object.values(ErrorCodes)).size).toBe(expected.length);
  });

  it("maps each error code to the documented HTTP status", () => {
    for (const [code, status] of Object.entries(ErrorCodeHttpStatus)) {
      expect(ErrorCodes).toHaveProperty(code);
      expect(typeof status).toBe("number");
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThanOrEqual(599);
    }
  });
});
