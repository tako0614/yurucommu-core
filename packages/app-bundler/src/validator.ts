/**
 * App Validator
 *
 * Validates App manifest and structure for correctness.
 */

import { glob } from "glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AppManifest, RouteConfig, ViewConfig } from "./types.js";

/**
 * Validation error
 */
export interface ValidationError {
  type: "error";
  message: string;
  file?: string;
  path?: string;
}

/**
 * Validation warning
 */
export interface ValidationWarning {
  type: "warning";
  message: string;
  file?: string;
  path?: string;
}

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
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

  constructor(options: ValidatorOptions) {
    this.options = options;
  }

  /**
   * Run full validation
   */
  async validate(): Promise<ValidationResult> {
    this.errors = [];
    this.warnings = [];

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
    await this.validateHandlers();

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
      this.addError("manifest.json not found", manifestPath);
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
      this.addError(message, manifestPath);
      return null;
    }

    // Validate required fields
    if (!manifest.id) {
      this.addError("Missing required field: id", manifestPath, "id");
    } else if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      this.addError(
        "id must contain only lowercase letters, numbers, and hyphens",
        manifestPath,
        "id"
      );
    }

    if (!manifest.name) {
      this.addError("Missing required field: name", manifestPath, "name");
    }

    if (!manifest.version) {
      this.addError("Missing required field: version", manifestPath, "version");
    } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(manifest.version)) {
      this.addWarning(
        "version should follow semver format (e.g., 1.0.0)",
        manifestPath,
        "version"
      );
    }

    return manifest;
  }

  /**
   * Validate routes configuration
   */
  private async validateRoutes(manifest: AppManifest): Promise<void> {
    // Load routes from routes/*.json
    const routesDir = path.join(this.options.appDir, "routes");
    const routeFiles = await this.findJsonFiles(routesDir);

    const allRoutes: Record<string, RouteConfig> = { ...manifest.routes };

    // Parse route files
    for (const file of routeFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const route = JSON.parse(content) as RouteConfig;
        const name = path.basename(file, ".json");

        // Validate route structure
        if (!route.path) {
          this.addError("Missing required field: path", file, "path");
        } else if (!route.path.startsWith("/")) {
          this.addError("path must start with /", file, "path");
        }

        if (!route.view) {
          this.addError("Missing required field: view", file, "view");
        }

        if (route.auth && !["public", "authenticated", "owner"].includes(route.auth)) {
          this.addError(
            `Invalid auth value: ${route.auth}. Must be "public", "authenticated", or "owner"`,
            file,
            "auth"
          );
        }

        allRoutes[name] = route;
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError(`Invalid JSON: ${error.message}`, file);
        }
      }
    }

    // Check for duplicate paths
    const pathMap = new Map<string, string>();
    for (const [name, route] of Object.entries(allRoutes)) {
      if (route.path) {
        const existing = pathMap.get(route.path);
        if (existing) {
          this.addError(
            `Duplicate path "${route.path}" in routes "${existing}" and "${name}"`,
            routesDir
          );
        } else {
          pathMap.set(route.path, name);
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

    const allViews: Record<string, ViewConfig> = { ...manifest.views };

    // Parse view files
    for (const file of viewFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const view = JSON.parse(content) as ViewConfig;
        const name = path.basename(file, ".json");

        // Validate view structure
        if (!view.type) {
          this.addError("Missing required field: type", file, "type");
        } else if (!["list", "detail", "form", "custom"].includes(view.type)) {
          this.addError(
            `Invalid type value: ${view.type}. Must be "list", "detail", "form", or "custom"`,
            file,
            "type"
          );
        }

        allViews[name] = view;
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError(`Invalid JSON: ${error.message}`, file);
        }
      }
    }

    // Check that all routes reference existing views
    const routesDir = path.join(this.options.appDir, "routes");
    const routeFiles = await this.findJsonFiles(routesDir);

    for (const file of routeFiles) {
      try {
        const content = await fs.readFile(file, "utf-8");
        const route = JSON.parse(content) as RouteConfig;

        if (route.view && !allViews[route.view]) {
          this.addWarning(
            `Route references undefined view: ${route.view}`,
            file,
            "view"
          );
        }
      } catch {
        // Already handled in validateRoutes
      }
    }
  }

  /**
   * Validate handlers.ts
   */
  private async validateHandlers(): Promise<void> {
    const handlersPath = path.join(this.options.appDir, "handlers.ts");

    try {
      await fs.access(handlersPath);
    } catch {
      // handlers.ts is optional
      this.addWarning("handlers.ts not found (server-side handlers disabled)", handlersPath);
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
          this.addError("Missing required field: type", file, "type");
        } else if (!["object", "collection"].includes(schema.type)) {
          this.addError(
            `Invalid type value: ${schema.type}. Must be "object" or "collection"`,
            file,
            "type"
          );
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError(`Invalid JSON: ${error.message}`, file);
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
          this.addError("kv must be an array of namespace names", file, "kv");
        }

        // Validate R2 buckets
        if (storage.r2 && !Array.isArray(storage.r2)) {
          this.addError("r2 must be an array of bucket names", file, "r2");
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.addError(`Invalid JSON: ${error.message}`, file);
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
        this.addWarning(
          `View component "${viewName}" has no corresponding JSON config`,
          file
        );
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

  /**
   * Add an error
   */
  private addError(message: string, file?: string, jsonPath?: string): void {
    this.errors.push({
      type: "error",
      message,
      file,
      path: jsonPath
    });
  }

  /**
   * Add a warning
   */
  private addWarning(message: string, file?: string, jsonPath?: string): void {
    this.warnings.push({
      type: "warning",
      message,
      file,
      path: jsonPath
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
          message: warning.message,
          file: warning.file,
          path: warning.path
        });
      }
      return {
        valid: this.errors.length === 0,
        errors: this.errors,
        warnings: []
      };
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors,
      warnings: this.warnings
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
