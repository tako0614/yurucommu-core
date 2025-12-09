export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export interface ValidationWarning {
  code: string;
  message: string;
  file?: string;
  line?: number;
}

export function validateManifest(manifest: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const RESERVED_ROUTES = ["/login", "/auth/*", "/-/core/*", "/-/config/*", "/-/app/*", "/-/health", "/.well-known/*"];
  const isObject = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

  const pushError = (message: string, code = "invalid_manifest") => {
    errors.push({ code, message });
  };
  const pushWarning = (message: string, code = "manifest_warning") => {
    warnings.push({ code, message });
  };

  if (!isObject(manifest)) {
    pushError("manifest must be an object");
    return { valid: false, errors, warnings };
  }

  if ((manifest as any).schema_version !== "2.0") {
    pushError(`schema_version must be "2.0"`);
  }

  if (typeof (manifest as any).id !== "string" || !(manifest as any).id) {
    pushError("id is required");
  }
  if (typeof (manifest as any).name !== "string" || !(manifest as any).name) {
    pushError("name is required");
  }
  if (typeof (manifest as any).version !== "string" || !(manifest as any).version) {
    pushError("version is required");
  }

  const entry = (manifest as any).entry;
  if (!isObject(entry)) {
    pushError("entry must be an object with client/server");
  } else {
    if (typeof entry.client !== "string" || !entry.client) {
      pushError("entry.client is required");
    }
    if (typeof entry.server !== "string" || !entry.server) {
      pushError("entry.server is required");
    }
  }

  const screens = Array.isArray((manifest as any).screens) ? (manifest as any).screens : [];
  const screenIds = new Set<string>();
  const screenRoutes = new Set<string>();
  if (!Array.isArray((manifest as any).screens)) {
    pushError("screens must be an array");
  } else {
    for (const screen of screens) {
      if (!isObject(screen)) {
        pushError("screen must be an object", "invalid_screen");
        continue;
      }
      if (typeof screen.id !== "string" || !screen.id) {
        pushError("screen.id is required", "invalid_screen");
      } else if (screenIds.has(screen.id)) {
        pushError(`duplicate screen id: ${screen.id}`, "duplicate_screen");
      } else {
        screenIds.add(screen.id);
      }

      if (typeof screen.path !== "string" || !screen.path.startsWith("/")) {
        pushError(`screen ${screen.id ?? "<unknown>"} must have a path starting with "/"`, "invalid_screen");
      } else if (isReservedRoute(screen.path, RESERVED_ROUTES)) {
        pushError(`screen ${screen.id} uses reserved route ${screen.path}`, "reserved_route");
      } else if (screenRoutes.has(screen.path)) {
        pushWarning(`duplicate screen path ${screen.path}`, "duplicate_screen_path");
      } else {
        screenRoutes.add(screen.path);
      }
    }
  }

  const handlers = Array.isArray((manifest as any).handlers) ? (manifest as any).handlers : [];
  const handlerIds = new Set<string>();
  if (!Array.isArray((manifest as any).handlers)) {
    pushWarning("handlers is not provided as array", "missing_handlers");
  } else {
    for (const handler of handlers) {
      if (!isObject(handler)) {
        pushError("handler must be an object", "invalid_handler");
        continue;
      }
      if (typeof handler.id !== "string" || !handler.id) {
        pushError("handler.id is required", "invalid_handler");
      } else if (handlerIds.has(handler.id)) {
        pushError(`duplicate handler id: ${handler.id}`, "duplicate_handler");
      } else {
        handlerIds.add(handler.id);
      }
      if (typeof handler.path !== "string" || !handler.path.startsWith("/")) {
        pushError(`handler ${handler.id ?? "<unknown>"} must have a path starting with "/"`, "invalid_handler");
      }
      if (!["GET", "POST", "PUT", "DELETE"].includes(String(handler.method))) {
        pushError(`handler ${handler.id ?? "<unknown>"} has invalid method`, "invalid_handler");
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&").replace(/\\\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function isReservedRoute(route: string, reserved: string[]): boolean {
  return reserved.some((pattern) => patternToRegExp(pattern).test(route));
}
