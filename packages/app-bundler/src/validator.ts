// === Types ===

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
  path?: string;
}

// === Constants ===

/** Routes reserved by takos Core */
const RESERVED_ROUTES = [
  "/login",
  "/logout",
  "/auth/*",
  "/-/core/*",
  "/-/config/*",
  "/-/app/*",
  "/-/apps/*",
  "/-/api/*",
  "/-/health",
  "/.well-known/*",
];

/** Valid permission prefixes */
const VALID_PERMISSION_PREFIXES = ["core:", "app:"];

/** Known Core API permissions */
const KNOWN_PERMISSIONS = [
  "core:posts.read",
  "core:posts.write",
  "core:users.read",
  "core:users.write",
  "core:timeline.read",
  "core:notifications.read",
  "core:notifications.write",
  "core:storage.read",
  "core:storage.write",
  "core:activitypub.read",
  "core:activitypub.write",
  "core:ai.read",
  "core:ai.write",
  "app:storage",
];

// === Helpers ===

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&")
    .replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function isReservedRoute(route: string, reserved: string[]): boolean {
  return reserved.some((pattern) => patternToRegExp(pattern).test(route));
}

function isValidSemver(version: string): boolean {
  return /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/.test(version);
}

function isValidAppId(id: string): boolean {
  // Allow reverse-domain notation or simple kebab-case
  return /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*(-[a-z0-9]+)*$/.test(id) ||
         /^[a-z][a-z0-9-]*$/.test(id);
}

// === Main Validator ===

/**
 * Validate a generated manifest object.
 *
 * Checks:
 * - Schema version is "2.0"
 * - Required fields: id, name, version, entry.client, entry.server
 * - Screen/handler IDs are unique
 * - Paths start with "/" and are not reserved
 * - Permissions use valid prefixes
 * - Handler methods are valid HTTP methods
 */
export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const pushError = (message: string, code = "invalid_manifest", path?: string) => {
    errors.push({ code, message, path });
  };

  const pushWarning = (message: string, code = "manifest_warning", path?: string) => {
    warnings.push({ code, message, path });
  };

  // Root object check
  if (!isObject(manifest)) {
    pushError("Manifest must be an object");
    return { valid: false, errors, warnings };
  }

  const m = manifest as Record<string, unknown>;

  // === Schema Version ===
  if (m.schema_version !== "2.0") {
    pushError('schema_version must be "2.0"', "invalid_schema_version");
  }

  // === Required Fields ===
  if (typeof m.id !== "string" || !m.id) {
    pushError("id is required", "missing_id");
  } else if (!isValidAppId(m.id)) {
    pushWarning(
      `id "${m.id}" should use reverse-domain notation (e.g., com.example.myapp)`,
      "invalid_app_id",
      "id"
    );
  }

  if (typeof m.name !== "string" || !m.name) {
    pushError("name is required", "missing_name");
  }

  if (typeof m.version !== "string" || !m.version) {
    pushError("version is required", "missing_version");
  } else if (!isValidSemver(m.version)) {
    pushWarning(
      `version "${m.version}" is not valid semver`,
      "invalid_semver",
      "version"
    );
  }

  // === Entry ===
  if (!isObject(m.entry)) {
    pushError("entry must be an object with client and server", "missing_entry");
  } else {
    const entry = m.entry as Record<string, unknown>;
    if (typeof entry.client !== "string" || !entry.client) {
      pushError("entry.client is required", "missing_entry_client", "entry.client");
    }
    if (typeof entry.server !== "string" || !entry.server) {
      pushError("entry.server is required", "missing_entry_server", "entry.server");
    }
  }

  // === Screens ===
  const screenIds = new Set<string>();
  const screenPaths = new Set<string>();

  if (!Array.isArray(m.screens)) {
    pushError("screens must be an array", "invalid_screens");
  } else {
    for (let i = 0; i < m.screens.length; i++) {
      const screen = m.screens[i];
      const screenPath = `screens[${i}]`;

      if (!isObject(screen)) {
        pushError(`Screen at index ${i} must be an object`, "invalid_screen", screenPath);
        continue;
      }

      const s = screen as Record<string, unknown>;

      // ID validation
      if (typeof s.id !== "string" || !s.id) {
        pushError(`Screen at index ${i} must have an id`, "missing_screen_id", screenPath);
      } else {
        if (screenIds.has(s.id)) {
          pushError(`Duplicate screen id: ${s.id}`, "duplicate_screen_id", `${screenPath}.id`);
        }
        screenIds.add(s.id);
      }

      // Path validation
      if (typeof s.path !== "string") {
        pushError(`Screen ${s.id ?? i} must have a path`, "missing_screen_path", screenPath);
      } else if (!s.path.startsWith("/")) {
        pushError(
          `Screen ${s.id ?? i} path must start with "/"`,
          "invalid_screen_path",
          `${screenPath}.path`
        );
      } else if (isReservedRoute(s.path, RESERVED_ROUTES)) {
        pushError(
          `Screen ${s.id} uses reserved route: ${s.path}`,
          "reserved_route",
          `${screenPath}.path`
        );
      } else {
        if (screenPaths.has(s.path)) {
          pushWarning(
            `Duplicate screen path: ${s.path}`,
            "duplicate_screen_path",
            `${screenPath}.path`
          );
        }
        screenPaths.add(s.path);
      }

      // Auth validation
      if (s.auth !== undefined && s.auth !== "required" && s.auth !== "optional") {
        pushError(
          `Screen ${s.id ?? i} auth must be "required" or "optional"`,
          "invalid_screen_auth",
          `${screenPath}.auth`
        );
      }
    }
  }

  // === Handlers ===
  const handlerIds = new Set<string>();
  const handlerRoutes = new Set<string>();

  if (m.handlers !== undefined && !Array.isArray(m.handlers)) {
    pushError("handlers must be an array", "invalid_handlers");
  } else if (Array.isArray(m.handlers)) {
    for (let i = 0; i < m.handlers.length; i++) {
      const handler = m.handlers[i];
      const handlerPath = `handlers[${i}]`;

      if (!isObject(handler)) {
        pushError(`Handler at index ${i} must be an object`, "invalid_handler", handlerPath);
        continue;
      }

      const h = handler as Record<string, unknown>;

      // ID validation
      if (typeof h.id !== "string" || !h.id) {
        pushError(`Handler at index ${i} must have an id`, "missing_handler_id", handlerPath);
      } else {
        if (handlerIds.has(h.id)) {
          pushError(`Duplicate handler id: ${h.id}`, "duplicate_handler_id", `${handlerPath}.id`);
        }
        handlerIds.add(h.id);
      }

      // Method validation
      const validMethods = ["GET", "POST", "PUT", "DELETE", "PATCH"];
      if (typeof h.method !== "string" || !validMethods.includes(h.method)) {
        pushError(
          `Handler ${h.id ?? i} must have a valid method (${validMethods.join(", ")})`,
          "invalid_handler_method",
          `${handlerPath}.method`
        );
      }

      // Path validation
      if (typeof h.path !== "string") {
        pushError(`Handler ${h.id ?? i} must have a path`, "missing_handler_path", handlerPath);
      } else if (!h.path.startsWith("/")) {
        pushError(
          `Handler ${h.id ?? i} path must start with "/"`,
          "invalid_handler_path",
          `${handlerPath}.path`
        );
      } else {
        const routeKey = `${h.method} ${h.path}`;
        if (handlerRoutes.has(routeKey)) {
          pushError(
            `Duplicate handler route: ${routeKey}`,
            "duplicate_handler_route",
            handlerPath
          );
        }
        handlerRoutes.add(routeKey);
      }

      // Auth validation (boolean in manifest)
      if (h.auth !== undefined && typeof h.auth !== "boolean") {
        pushError(
          `Handler ${h.id ?? i} auth must be a boolean`,
          "invalid_handler_auth",
          `${handlerPath}.auth`
        );
      }
    }
  }

  // === Permissions ===
  if (m.permissions !== undefined && !Array.isArray(m.permissions)) {
    pushError("permissions must be an array", "invalid_permissions");
  } else if (Array.isArray(m.permissions)) {
    const seenPermissions = new Set<string>();

    for (let i = 0; i < m.permissions.length; i++) {
      const perm = m.permissions[i];
      const permPath = `permissions[${i}]`;

      if (typeof perm !== "string") {
        pushError(`Permission at index ${i} must be a string`, "invalid_permission", permPath);
        continue;
      }

      // Check prefix
      const hasValidPrefix = VALID_PERMISSION_PREFIXES.some((prefix) => perm.startsWith(prefix));
      if (!hasValidPrefix) {
        pushError(
          `Permission "${perm}" must start with ${VALID_PERMISSION_PREFIXES.join(" or ")}`,
          "invalid_permission_prefix",
          permPath
        );
      }

      // Check if known
      if (!KNOWN_PERMISSIONS.includes(perm)) {
        pushWarning(
          `Unknown permission: ${perm}`,
          "unknown_permission",
          permPath
        );
      }

      // Check duplicates
      if (seenPermissions.has(perm)) {
        pushWarning(`Duplicate permission: ${perm}`, "duplicate_permission", permPath);
      }
      seenPermissions.add(perm);
    }
  }

  // === Peer Dependencies ===
  if (m.peer_dependencies !== undefined) {
    if (!isObject(m.peer_dependencies)) {
      pushError("peer_dependencies must be an object", "invalid_peer_dependencies");
    } else {
      const deps = m.peer_dependencies as Record<string, unknown>;

      // React is required
      if (!deps.react) {
        pushWarning("peer_dependencies should include react", "missing_peer_dep_react");
      }
      if (!deps["react-dom"]) {
        pushWarning("peer_dependencies should include react-dom", "missing_peer_dep_react_dom");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate a manifest file from disk.
 */
export function validateManifestFile(filePath: string): ValidationResult {
  const fs = require("node:fs");
  const path = require("node:path");

  const absolutePath = path.resolve(filePath);

  if (!fs.existsSync(absolutePath)) {
    return {
      valid: false,
      errors: [{ code: "file_not_found", message: `Manifest file not found: ${absolutePath}` }],
      warnings: [],
    };
  }

  try {
    const content = fs.readFileSync(absolutePath, "utf8");
    const manifest = JSON.parse(content);
    return validateManifest(manifest);
  } catch (err) {
    return {
      valid: false,
      errors: [{
        code: "parse_error",
        message: `Failed to parse manifest: ${err instanceof Error ? err.message : String(err)}`,
      }],
      warnings: [],
    };
  }
}
