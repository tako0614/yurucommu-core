import { checkSemverCompatibility } from "../utils/semver.js";

export const APP_MANIFEST_SCHEMA_VERSION = "1.10";

export function extractAppSchemaVersion(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return null;
  const rawValue = (manifest as any).schema_version ?? (manifest as any).schemaVersion;
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function validateAppSchemaVersion(manifest: unknown): {
  ok: boolean;
  version?: string;
  warnings: string[];
  error?: string;
} {
  const version = extractAppSchemaVersion(manifest);
  if (!version) {
    return { ok: false, warnings: [], error: "App manifest schema_version is required" };
  }

  const compatibility = checkSemverCompatibility(APP_MANIFEST_SCHEMA_VERSION, version, {
    context: "app manifest schema_version",
  });

  return {
    ok: compatibility.ok,
    version,
    warnings: compatibility.warnings,
    error: compatibility.error,
  };
}

export function assertSupportedAppSchemaVersion(manifest: unknown): string {
  const validation = validateAppSchemaVersion(manifest);
  if (!validation.ok || !validation.version) {
    throw new Error(validation.error || "App manifest schema_version is required");
  }
  return validation.version;
}
