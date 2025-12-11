import fs from "node:fs";
import path from "node:path";
import type { AppDefinition, HandlerConfig, ScreenConfig } from "@takos/app-sdk";
import { validateManifest } from "./validator.js";

// === Types ===

export type GenerateManifestOptions = {
  app: AppDefinition;
  entry: {
    client: string;
    server: string;
    styles?: string;
  };
  outputPath?: string;
  write?: boolean;
  validate?: boolean;
  /** Source directory for permission inference (optional) */
  sourceDir?: string;
};

export type ManifestScreen = {
  id: string;
  path: string;
  title?: string;
  auth?: "required" | "optional";
};

export type ManifestHandler = {
  id: string;
  method: string;
  path: string;
  auth?: boolean;
};

export type GeneratedManifest = {
  schema_version: "2.0";
  id: string;
  name: string;
  version: string;
  description?: string;
  entry: {
    client: string;
    server: string;
    styles?: string;
  };
  screens: ManifestScreen[];
  handlers: ManifestHandler[];
  permissions: string[];
  peer_dependencies: Record<string, string>;
};

// === Permission Constants ===

/** Known Core API methods and their required permissions */
const CORE_API_PERMISSIONS: Record<string, string[]> = {
  // posts
  "core.posts.list": ["core:posts.read"],
  "core.posts.get": ["core:posts.read"],
  "core.posts.create": ["core:posts.write"],
  "core.posts.delete": ["core:posts.write"],
  // users
  "core.users.get": ["core:users.read"],
  "core.users.follow": ["core:users.write"],
  "core.users.unfollow": ["core:users.write"],
  // timeline
  "core.timeline.home": ["core:timeline.read"],
  // notifications
  "core.notifications.list": ["core:notifications.read"],
  "core.notifications.markRead": ["core:notifications.write"],
  // storage
  "core.storage.upload": ["core:storage.write"],
  "core.storage.get": ["core:storage.read"],
  "core.storage.delete": ["core:storage.write"],
};

// === ID Derivation ===

/**
 * Derive a unique screen ID from ScreenConfig.
 * If `id` is provided, use it directly.
 * Otherwise, generate from path (e.g., "/profile/:id" -> "screen.profile_id").
 */
function deriveScreenId(screen: ScreenConfig, index: number): string {
  if (screen.id) return screen.id;
  if (!screen.path) return `screen.unknown_${index}`;
  if (screen.path === "/") return "home";

  const tokens = screen.path
    .replace(/^\//, "")
    .split("/")
    .map((segment) => {
      if (!segment) return "";
      if (segment.startsWith(":")) return segment.slice(1);
      return segment.replace(/[^a-zA-Z0-9]+/g, "_");
    })
    .filter(Boolean);

  return tokens.join("_") || `screen_${index}`;
}

/**
 * Derive a unique handler ID from HandlerConfig.
 * If `id` is provided, use it directly.
 * Otherwise, generate from method + path (e.g., "GET /stats" -> "getStats").
 */
function deriveHandlerId(handler: HandlerConfig, index: number): string {
  if (handler.id) return handler.id;

  const method = handler.method.toLowerCase();
  const pathPart = handler.path
    .replace(/^\//, "")
    .split("/")
    .map((segment, i) => {
      if (segment.startsWith(":")) {
        // Convert :userId to ByUserId
        const paramName = segment.slice(1);
        return "By" + paramName.charAt(0).toUpperCase() + paramName.slice(1);
      }
      if (i === 0) return segment;
      return segment.charAt(0).toUpperCase() + segment.slice(1);
    })
    .join("")
    .replace(/[^a-zA-Z0-9]+/g, "");

  if (!pathPart) return `${method}Root`;
  return `${method}${pathPart.charAt(0).toUpperCase()}${pathPart.slice(1)}`;
}

// === Auth Conversion ===

/**
 * Convert SDK auth format to manifest boolean format.
 * - "required" -> true
 * - "optional" | "none" | undefined -> false
 */
function normalizeHandlerAuth(auth: HandlerConfig["auth"]): boolean {
  return auth === "required";
}

// === Screen Extraction ===

/**
 * Extract screens from AppDefinition.
 */
function extractScreens(app: AppDefinition): ManifestScreen[] {
  const screens = app.screens || [];
  const seenIds = new Set<string>();

  return screens.map((screen, index) => {
    let id = deriveScreenId(screen, index);

    // Ensure unique IDs
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}_${suffix}`)) suffix++;
      id = `${id}_${suffix}`;
    }
    seenIds.add(id);

    return {
      id,
      path: screen.path,
      ...(screen.title ? { title: screen.title } : {}),
      ...(screen.auth ? { auth: screen.auth } : {}),
    };
  });
}

// === Handler Extraction ===

/**
 * Extract handlers from AppDefinition.
 */
function extractHandlers(app: AppDefinition): ManifestHandler[] {
  const handlers = app.handlers || [];
  const seenIds = new Set<string>();

  return handlers.map((handler, index) => {
    let id = deriveHandlerId(handler, index);

    // Ensure unique IDs
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}_${suffix}`)) suffix++;
      id = `${id}_${suffix}`;
    }
    seenIds.add(id);

    return {
      id,
      method: handler.method,
      path: handler.path,
      ...(handler.auth !== undefined ? { auth: normalizeHandlerAuth(handler.auth) } : {}),
    };
  });
}

// === Permission Extraction ===

/**
 * Infer permissions from source code by scanning for Core API usage patterns.
 * This is a best-effort static analysis.
 */
function inferPermissionsFromSource(sourceDir: string): string[] {
  const permissions = new Set<string>();

  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  const scanFile = (filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, "utf8");

      // Scan for core.* API calls
      for (const [apiCall, perms] of Object.entries(CORE_API_PERMISSIONS)) {
        // Match patterns like: core.posts.list, useCore().posts.list
        const patterns = [
          new RegExp(`core\\.${apiCall.replace("core.", "").replace(".", "\\.")}`, "g"),
          new RegExp(`\\.${apiCall.replace("core.", "").replace(".", "\\.")}\\(`, "g"),
        ];

        for (const pattern of patterns) {
          if (pattern.test(content)) {
            perms.forEach((p) => permissions.add(p));
          }
        }
      }

      // Scan for ctx.storage.* usage in handlers
      if (/ctx\.storage\.(get|set|delete|list)/.test(content)) {
        permissions.add("app:storage");
      }
    } catch {
      // Ignore read errors
    }
  };

  const walkDir = (dir: string) => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules") {
          walkDir(fullPath);
        } else if (entry.isFile() && /\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          scanFile(fullPath);
        }
      }
    } catch {
      // Ignore directory access errors
    }
  };

  walkDir(sourceDir);
  return Array.from(permissions).sort();
}

/**
 * Extract and deduplicate permissions.
 * Priority: explicit permissions > inferred permissions
 */
function extractPermissions(app: AppDefinition, sourceDir?: string): string[] {
  // If explicitly provided, use those
  if (app.permissions && app.permissions.length > 0) {
    return [...new Set(app.permissions)].sort();
  }

  // Otherwise, try to infer from source
  if (sourceDir) {
    return inferPermissionsFromSource(sourceDir);
  }

  return [];
}

// === Main Generator ===

/**
 * Generate manifest.json from AppDefinition.
 *
 * @example
 * ```ts
 * const manifest = generateManifest({
 *   app: defineApp({ ... }),
 *   entry: {
 *     client: "dist/client.bundle.js",
 *     server: "dist/server.bundle.js",
 *     styles: "dist/client.bundle.css",
 *   },
 *   outputPath: "dist/manifest.json",
 * });
 * ```
 */
export function generateManifest(options: GenerateManifestOptions): GeneratedManifest {
  const { app, entry, outputPath, sourceDir } = options;

  // Validate required fields
  if (!app.id) throw new Error("AppDefinition.id is required");
  if (!app.name) throw new Error("AppDefinition.name is required");
  if (!app.version) throw new Error("AppDefinition.version is required");

  // Extract components
  const screens = extractScreens(app);
  const handlers = extractHandlers(app);
  const permissions = extractPermissions(app, sourceDir);

  // Build manifest
  const manifest: GeneratedManifest = {
    schema_version: "2.0",
    id: app.id,
    name: app.name,
    version: app.version,
    ...(app.description ? { description: app.description } : {}),
    entry: {
      client: entry.client,
      server: entry.server,
      ...(entry.styles ? { styles: entry.styles } : {}),
    },
    screens,
    handlers,
    permissions,
    peer_dependencies: {
      react: "^18.0.0",
      "react-dom": "^18.0.0",
    },
  };

  // Validate if requested
  if (options.validate !== false) {
    const result = validateManifest(manifest);
    if (!result.valid) {
      const detail = result.errors.map((e) => `[${e.code}] ${e.message}`).join("\n");
      throw new Error(`Manifest validation failed:\n${detail}`);
    }
    if (result.warnings.length > 0) {
      const warnings = result.warnings.map((w) => `[${w.code}] ${w.message}`).join("\n");
      console.warn(`Manifest warnings:\n${warnings}`);
    }
  }

  // Write to file if requested
  if (outputPath && options.write !== false) {
    const target = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(manifest, null, 2), "utf8");
  }

  return manifest;
}

/**
 * Generate manifest from a source file that exports defineApp().
 * This requires dynamic import and is async.
 */
export async function generateManifestFromFile(
  appFilePath: string,
  options: Omit<GenerateManifestOptions, "app">
): Promise<GeneratedManifest> {
  const absolutePath = path.resolve(appFilePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`App file not found: ${absolutePath}`);
  }

  // Dynamic import the app module
  const appModule = await import(absolutePath);
  const app: AppDefinition = appModule.default || appModule.app;

  if (!app || typeof app !== "object") {
    throw new Error(`App file must export a default AppDefinition or named 'app' export`);
  }

  return generateManifest({
    ...options,
    app,
    sourceDir: options.sourceDir ?? path.dirname(absolutePath),
  });
}
