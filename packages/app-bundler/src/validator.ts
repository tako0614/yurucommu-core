/**
 * App Validator
 *
 * Validates App manifest and structure for correctness.
 */

import { glob } from "glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppManifest, RouteConfig, ViewConfig } from "./types.js";

export type ValidationLevel = "ERROR" | "WARN" | "INFO";

export type ValidationCode =
  | "RESERVED_ROUTE_VIOLATION"
  | "CORE_ROUTE_MOVED"
  | "DUPLICATE_ROUTE"
  | "DUPLICATE_SCREEN_ID"
  | "INVALID_PATH_FORMAT"
  | "INVALID_PATH_PARAM"
  | "MISSING_SCREEN_LAYOUT"
  | "UNUSED_SCREEN_ID";

export interface ValidationLocation {
  file: string;
  line?: number;
  column?: number;
}

const normalizeRoutePath = (raw: string): string => {
  const trimmed = (raw || "").trim();
  if (!trimmed) return "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutTrailing = withSlash === "/" ? "/" : withSlash.replace(/\/+$/, "");
  return withoutTrailing || "/";
};

// Keep behavior consistent with takos/platform reserved route guard.
const isReservedHttpPath = (raw: string): boolean => {
  const normalized = normalizeRoutePath(raw);
  if (normalized === "/login") return true;
  if (normalized === "/logout") return true;
  if (normalized === "/-/health") return true;
  if (normalized === "/-" || normalized.startsWith("/-/")) return true;
  if (normalized === "/auth" || normalized.startsWith("/auth/")) return true;
  if (normalized === "/.well-known" || normalized.startsWith("/.well-known/")) return true;
  if (normalized === "/nodeinfo" || normalized.startsWith("/nodeinfo/")) return true;
  return false;
};

const findJsonFieldLocation = (content: string, fieldName: string): { line: number; column: number } | null => {
  const needle = `"${fieldName}"`;
  const index = content.indexOf(needle);
  if (index < 0) return null;
  const upTo = content.slice(0, index);
  const lines = upTo.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
};

/**
 * Validation error
 */
export interface ValidationError {
  type: "error";
  code?: ValidationCode;
  level?: ValidationLevel;
  message: string;
  file?: string;
  path?: string;
  location?: ValidationLocation;
  suggestion?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  type: "warning";
  code?: ValidationCode;
  level?: ValidationLevel;
  message: string;
  file?: string;
  path?: string;
  location?: ValidationLocation;
  suggestion?: string;
}

export interface ValidationInfo {
  type: "info";
  code: ValidationCode;
  level: ValidationLevel;
  message: string;
  file?: string;
  path?: string;
  location?: ValidationLocation;
  suggestion?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  infos?: ValidationInfo[];
}

/**
 * Validator options
 */
export interface ValidatorOptions {
  /**
   * App directory to validate
   */
  appDir: string;

  /**
   * Enable strict mode (warnings become errors)
   * @default false
   */
  strict?: boolean;
}

/**
 * App Validator class
 */
export class AppValidator {
  private options: ValidatorOptions;
  private errors: ValidationError[] = [];
  private warnings: ValidationWarning[] = [];
  private infos: ValidationInfo[] = [];

  constructor(options: ValidatorOptions) {
    this.options = options;
  }

  /**
   * Run full validation
   */
  async validate(): Promise<ValidationResult> {
    this.errors = [];
    this.warnings = [];
    this.infos = [];

    // 1. Check manifest exists and is valid
    const manifest = await this.validateManifest();
    if (!manifest) {
      return this.buildResult();
    }

    // 2. Validate routes
    await this.validateRoutes(manifest);

    // 3. Validate views
    await this.validateViews(manifest);

    // 4. Validate handlers
    await this.validateHandlers(manifest);

    // 5. Validate data schemas
    await this.validateDataSchemas(manifest);

    // 6. Validate storage config
    await this.validateStorage(manifest);

    // 7. Check for orphaned files
    await this.checkOrphanedFiles(manifest);

    return this.buildResult();
  }

  /**
   * Validate the main manifest.json
   */
  private async validateManifest(): Promise<AppManifest | null> {
    const manifestPath = path.join(this.options.appDir, "manifest.json");

    // Check file exists
    try {
      await fs.access(manifestPath);
    } catch {
      this.addError({ message: "manifest.json not found", file: manifestPath });
      return null;
    }

    // Parse JSON
    let manifest: AppManifest;
    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      manifest = JSON.parse(content);
    } catch (error) {
      const message =
        error instanceof SyntaxError
          ? `Invalid JSON: ${error.message}`
          : "Failed to read manifest.json";
      this.addError({ message, file: manifestPath });
      return null;
    }

    // Validate required fields
    if (!manifest.id) {
      this.addError({ message: "Missing required field: id", file: manifestPath, jsonPath: "id" });
    } else if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      this.addError({
        message: "id must contain only lowercase letters, numbers, and hyphens",
        file: manifestPath,
        jsonPath: "id",
      });
    }

    if (!manifest.name) {
      this.addError({ message: "Missing required field: name", file: manifestPath, jsonPath: "name" });
    }

    if (!manifest.version) {
      this.addError({ message: "Missing required field: version", file: manifestPath, jsonPath: "version" });
    } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) {
      this.addWarning({
        message: "version should follow semver format (e.g., 1.0.0)",
        file: manifestPath,
        jsonPath: "version",
      });
    }

    return manifest;
  }

  private validatePathFormat(routePath: string): { message: string; code: ValidationCode } | null {
    const trimmed = (routePath || "").trim();
    if (!trimmed) {
      return { code: "INVALID_PATH_FORMAT", message: "path must be a non-empty string" };
    }
    if (!trimmed.startsWith("/")) {
      return { code: "INVALID_PATH_FORMAT", message: "path must start with /" };
    }
    if (/[?#]/.test(trimmed)) {
      return { code: "INVALID_PATH_FORMAT", message: "path must not include querystring or fragment" };
    }
    if (/\s/.test(trimmed)) {
      return { code: "INVALID_PATH_FORMAT", message: "path must not include whitespace" };
    }
    if (trimmed !== "/" && trimmed.includes("//")) {
      return { code: "INVALID_PATH_FORMAT", message: "path must not include consecutive slashes (//)" };
    }
    return null;
  }

  private validatePathParams(routePath: string): { message: string; code: ValidationCode } | null {
    const normalized = normalizeRoutePath(routePath);
    if (normalized === "/") return null;
    const segments = normalized.split("/").slice(1);
    const wildcardIndex = segments.indexOf("*");
    if (wildcardIndex !== -1 && wildcardIndex !== segments.length - 1) {
      return { code: "INVALID_PATH_PARAM", message: "wildcard (*) is only allowed as the last path segment" };
    }

    for (const segment of segments) {
      if (!segment) {
        return { code: "INVALID_PATH_FORMAT", message: "path must not include empty segments" };
      }
      if (segment === "*") continue;
      if (segment.includes("*")) {
        return { code: "INVALID_PATH_PARAM", message: "wildcard (*) must be a standalone segment" };
      }
      if (segment.includes(":") && !segment.startsWith(":")) {
        return { code: "INVALID_PATH_PARAM", message: "path params (:) must start a segment (e.g., /posts/:id)" };
      }
      if (segment.startsWith(":")) {
        if (!/^:[A-Za-z_][A-Za-z0-9_-]*$/.test(segment)) {
          return { code: "INVALID_PATH_PARAM", message: `invalid path param segment "${segment}"` };
        }
      }
    }
    return null;
  }

  /**
   * Validate routes configuration
   */
  private async validateRoutes(manifest: AppManifest): Promise<void> {
    // Load routes from routes/*.json
    const routesDir = path.join(this.options.appDir, "routes");
    const routeFiles = await this.findJsonFiles(routesDir);

    const manifestPath = path.join(this.options.appDir, "manifest.json");
    const allRoutes: Record<string, RouteConfig> = { ...(manifest.routes ?? {}) };
    const routeSources = new Map<string, { file: string; jsonPath: string; content?: string }>();

    for (const [name, route] of Object.entries(manifest.routes ?? {})) {
      if (route?.path) {
        routeSources.set(name, { file: manifestPath, jsonPath: `routes.${name}.path` });
      }
    }

    // Parse route files
    for (const file of routeFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const route = JSON.parse(content) as RouteConfig;
        const name = path.basename(file, ".json");

        // Validate route structure
        if (!route.path) {
          this.addError({
            code: "INVALID_PATH_FORMAT",
            message: "Missing required field: path",
            file,
            jsonPath: "path",
            location: this.buildLocation(file, content, "path"),
          });
        } else {
          const formatIssue = this.validatePathFormat(route.path);
          if (formatIssue) {
            this.addError({
              code: formatIssue.code,
              message: formatIssue.message,
              file,
              jsonPath: "path",
              location: this.buildLocation(file, content, "path"),
            });
          }
          const paramIssue = this.validatePathParams(route.path);
          if (paramIssue) {
            this.addError({
              code: paramIssue.code,
              message: paramIssue.message,
              file,
              jsonPath: "path",
              location: this.buildLocation(file, content, "path"),
            });
          }
          if (isReservedHttpPath(route.path)) {
            this.addError({
              code: "RESERVED_ROUTE_VIOLATION",
              message: `Reserved route "${normalizeRoutePath(route.path)}" cannot be defined in manifest`,
              file,
              jsonPath: "path",
              location: this.buildLocation(file, content, "path"),
              suggestion: "Use a different route path (e.g., \"/app-login\" or \"/signin\")",
            });
          }
        }

        if (!route.view) {
          this.addError({
            message: "Missing required field: view",
            file,
            jsonPath: "view",
            location: this.buildLocation(file, content, "view"),
          });
        }

        if (route.auth && !["public", "authenticated", "owner"].includes(route.auth)) {
          this.addError({
            code: "INVALID_PATH_FORMAT",
            message: `Invalid auth value: ${route.auth}. Must be "public", "authenticated", or "owner"`,
            file,
            jsonPath: "auth",
            location: this.buildLocation(file, content, "auth"),
          });
        }

        if (name in allRoutes) {
          this.addError({
            code: "DUPLICATE_SCREEN_ID",
            message: `Duplicate route id "${name}" (defined multiple times)`,
            file,
            jsonPath: "",
            location: { file },
            suggestion: "Rename the route file or remove the duplicate route definition",
          });
          continue;
        }

        allRoutes[name] = route;
        routeSources.set(name, { file, jsonPath: "path", content });
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError({
            code: "INVALID_PATH_FORMAT",
            message: `Invalid JSON: ${error.message}`,
            file,
            jsonPath: "",
            location: { file },
          });
        }
      }
    }

    // Check for duplicate paths
    const pathMap = new Map<string, string>();
    for (const [name, route] of Object.entries(allRoutes)) {
      if (route.path) {
        const normalized = normalizeRoutePath(route.path);
        const existing = pathMap.get(normalized);
        if (existing) {
          const src = routeSources.get(name);
          const existingSrc = routeSources.get(existing);
          this.addWarning({
            code: "DUPLICATE_ROUTE",
            message: `Duplicate route "${normalized}" in "${existing}" and "${name}" (first match wins)`,
            file: src?.file ?? routesDir,
            jsonPath: src?.jsonPath ?? "path",
            location: src?.file && src?.content ? this.buildLocation(src.file, src.content, "path") : undefined,
            suggestion: `Remove one of the routes or change its path (kept: "${existing}")`,
          });
        } else {
          pathMap.set(normalized, name);
        }
      }
    }
  }

  /**
   * Validate views configuration
   */
  private async validateViews(manifest: AppManifest): Promise<void> {
    const viewsDir = path.join(this.options.appDir, "views");
    const viewFiles = await this.findJsonFiles(viewsDir);

    const manifestPath = path.join(this.options.appDir, "manifest.json");
    const allViews: Record<string, ViewConfig> = { ...(manifest.views ?? {}) };

    // Parse view files
    for (const file of viewFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const view = JSON.parse(content) as ViewConfig;
        const name = path.basename(file, ".json");

        // Validate view structure
        if (!view.type) {
          this.addError({
            code: "MISSING_SCREEN_LAYOUT",
            message: "Missing required field: type",
            file,
            jsonPath: "type",
            location: this.buildLocation(file, content, "type"),
          });
        } else if (!["list", "detail", "form", "custom"].includes(view.type)) {
          this.addError({
            code: "INVALID_PATH_FORMAT",
            message: `Invalid type value: ${view.type}. Must be "list", "detail", "form", or "custom"`,
            file,
            jsonPath: "type",
            location: this.buildLocation(file, content, "type"),
          });
        }

        if (name in allViews) {
          this.addError({
            code: "DUPLICATE_SCREEN_ID",
            message: `Duplicate view id "${name}" (defined multiple times)`,
            file,
            jsonPath: "",
            location: { file },
            suggestion: "Rename the view file or remove the duplicate view definition",
          });
          continue;
        }

        allViews[name] = view;
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError({
            code: "INVALID_PATH_FORMAT",
            message: `Invalid JSON: ${error.message}`,
            file,
            jsonPath: "",
            location: { file },
          });
        }
      }
    }

    // Check that all routes reference existing views
    const routesDir = path.join(this.options.appDir, "routes");
    const routeFiles = await this.findJsonFiles(routesDir);

    const referencedViews = new Set<string>();
    for (const [routeId, route] of Object.entries(manifest.routes ?? {})) {
      const viewId = route?.view;
      if (!viewId) continue;
      if (!allViews[viewId]) {
        this.addWarning({
          message: `Route references undefined view: ${viewId}`,
          file: manifestPath,
          jsonPath: `routes.${routeId}.view`,
          location: { file: manifestPath },
        });
      } else {
        referencedViews.add(viewId);
      }
    }
    for (const file of routeFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const route = JSON.parse(content) as RouteConfig;

        if (route.view && !allViews[route.view]) {
          this.addWarning({
            message: `Route references undefined view: ${route.view}`,
            file,
            jsonPath: "view",
            location: this.buildLocation(file, content, "view"),
          });
        } else if (route.view) {
          referencedViews.add(route.view);
        }
      } catch {
        // Already handled in validateRoutes
      }
    }

    for (const [viewId] of Object.entries(allViews)) {
      if (!referencedViews.has(viewId)) {
        this.addInfo({
          code: "UNUSED_SCREEN_ID",
          message: `View "${viewId}" is not referenced by any route`,
          file: manifestPath,
          jsonPath: `views.${viewId}`,
          location: { file: manifestPath },
        });
      }
    }
  }

  /**
   * Validate server entrypoint / handlers
   */
  private async validateHandlers(manifest: AppManifest): Promise<void> {
    const manifestPath = path.join(this.options.appDir, "manifest.json");

    if (manifest.entry?.server) {
      const configuredEntry = manifest.entry.server;
      const entryPath = path.join(this.options.appDir, configuredEntry);
      const sourcePath = entryPath.replace(/dist[/\\]/, "src/").replace(/\.js$/, ".ts");

      const ok = (await this.pathExists(sourcePath)) || (await this.pathExists(entryPath));
      if (!ok) {
        this.addError({
          message: `entry.server not found: ${configuredEntry}`,
          file: manifestPath,
          jsonPath: "entry.server",
        });
      } else {
        return;
      }
    }

    const candidates = [
      "index.ts",
      "index.js",
      "src/server.ts",
      "src/server.js",
      "server.ts",
      "server.js",
      "handlers.ts",
      "handlers.js",
    ];

    for (const candidate of candidates) {
      const candidatePath = path.join(this.options.appDir, candidate);
      if (await this.pathExists(candidatePath)) {
        return;
      }
    }

    this.addWarning({ message: "No server entry point found (server-side handlers disabled)", file: manifestPath });
  }

  private async pathExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate data schemas
   */
  private async validateDataSchemas(manifest: AppManifest): Promise<void> {
    const dataDir = path.join(this.options.appDir, "data");
    const dataFiles = await this.findJsonFiles(dataDir);

    for (const file of dataFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const schema = JSON.parse(content);

        if (!schema.type) {
          this.addError({
            message: "Missing required field: type",
            file,
            jsonPath: "type",
            location: this.buildLocation(file, content, "type"),
          });
        } else if (!["object", "collection"].includes(schema.type)) {
          this.addError({
            message: `Invalid type value: ${schema.type}. Must be "object" or "collection"`,
            file,
            jsonPath: "type",
            location: this.buildLocation(file, content, "type"),
          });
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError({ message: `Invalid JSON: ${error.message}`, file });
        }
      }
    }
  }

  /**
   * Validate storage configuration
   */
  private async validateStorage(manifest: AppManifest): Promise<void> {
    const storageDir = path.join(this.options.appDir, "storage");
    const storageFiles = await this.findJsonFiles(storageDir);

    for (const file of storageFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const storage = JSON.parse(content);

        // Validate KV namespaces
        if (storage.kv && !Array.isArray(storage.kv)) {
          this.addError({ message: "kv must be an array of namespace names", file, jsonPath: "kv" });
        }

        // Validate R2 buckets
        if (storage.r2 && !Array.isArray(storage.r2)) {
          this.addError({ message: "r2 must be an array of bucket names", file, jsonPath: "r2" });
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError({ message: `Invalid JSON: ${error.message}`, file });
        }
      }
    }
  }

  /**
   * Check for orphaned files
   */
  private async checkOrphanedFiles(manifest: AppManifest): Promise<void> {
    // Check for .tsx files in views/ that aren't referenced
    const viewsDir = path.join(this.options.appDir, "views");
    const tsxFiles = await glob(path.join(viewsDir, "**/*.tsx"), { nodir: true });

    for (const file of tsxFiles) {
      const relativePath = path.relative(viewsDir, file);
      const viewName = relativePath.replace(/\.tsx$/, "").replace(/\\/g, "/");

      // Check if there's a corresponding JSON config
      const jsonPath = file.replace(/\.tsx$/, ".json");
      try {
        await fs.access(jsonPath);
      } catch {
        this.addWarning({
          message: `View component "${viewName}" has no corresponding JSON config`,
          file,
        });
      }
    }
  }

  /**
   * Find JSON files in a directory
   */
  private async findJsonFiles(dir: string): Promise<string[]> {
    try {
      return await glob(path.join(dir, "*.json"), { nodir: true });
    } catch {
      return [];
    }
  }

  private buildLocation(file: string, content: string, fieldName: string): ValidationLocation {
    const found = findJsonFieldLocation(content, fieldName);
    return {
      file,
      ...(found ?? {}),
    };
  }

  /**
   * Add an error
   */
  private addError(input: {
    code?: ValidationCode;
    message: string;
    file?: string;
    jsonPath?: string;
    location?: ValidationLocation;
    suggestion?: string;
  }): void {
    this.errors.push({
      type: "error",
      level: "ERROR",
      code: input.code,
      message: input.message,
      file: input.file,
      path: input.jsonPath,
      location: input.location,
      suggestion: input.suggestion,
    });
  }

  /**
   * Add a warning
   */
  private addWarning(input: {
    code?: ValidationCode;
    message: string;
    file?: string;
    jsonPath?: string;
    location?: ValidationLocation;
    suggestion?: string;
  }): void {
    this.warnings.push({
      type: "warning",
      level: "WARN",
      code: input.code,
      message: input.message,
      file: input.file,
      path: input.jsonPath,
      location: input.location,
      suggestion: input.suggestion,
    });
  }

  private addInfo(input: {
    code: ValidationCode;
    message: string;
    file?: string;
    jsonPath?: string;
    location?: ValidationLocation;
    suggestion?: string;
  }): void {
    this.infos.push({
      type: "info",
      level: "INFO",
      code: input.code,
      message: input.message,
      file: input.file,
      path: input.jsonPath,
      location: input.location,
      suggestion: input.suggestion,
    });
  }

  /**
   * Build the final result
   */
  private buildResult(): ValidationResult {
    // In strict mode, warnings become errors
    if (this.options.strict) {
      for (const warning of this.warnings) {
        this.errors.push({
          type: "error",
          level: "ERROR",
          code: warning.code,
          message: warning.message,
          file: warning.file,
          path: warning.path,
          location: warning.location,
          suggestion: warning.suggestion,
        });
      }
      return {
        valid: this.errors.length === 0,
        errors: this.errors,
        warnings: [],
        infos: this.infos,
      };
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings,
      infos: this.infos,
    };
  }
}

/**
 * Create a new AppValidator instance
 */
export function createValidator(options: ValidatorOptions): AppValidator {
  return new AppValidator(options);
}

/**
 * Validate an App with the given options
 */
export async function validateApp(options: ValidatorOptions): Promise<ValidationResult> {
  const validator = createValidator(options);
  return validator.validate();
}
