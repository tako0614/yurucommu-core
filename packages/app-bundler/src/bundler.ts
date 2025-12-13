/**
 * App Bundler Core
 *
 * Handles the bundling of App code into client.bundle.js, server.bundle.js, and manifest.json
 */

import { glob } from "glob";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { build as viteBuild, type Plugin } from "vite";
import type {
  AppBundlerConfig,
  AppManifest,
  BundleFile,
  BundleResult
} from "./types.js";

/**
 * Default bundler configuration
 */
const DEFAULT_CONFIG: Partial<AppBundlerConfig> = {
  sourcemap: true,
  minify: process.env.NODE_ENV === "production"
};

/**
 * App Bundler class
 *
 * Orchestrates the bundling process for App code.
 */
export class AppBundler {
  private config: AppBundlerConfig;

  constructor(config: AppBundlerConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Run the full bundle process
   */
  async bundle(): Promise<BundleResult> {
    const files: BundleFile[] = [];
    const errors: BundleResult["errors"] = [];
    const warnings: BundleResult["warnings"] = [];

    try {
      // 1. Load and validate manifest
      const manifest = await this.loadManifest();
      if (!manifest) {
        errors.push({ message: "Failed to load manifest.json" });
        return { success: false, files, errors, warnings };
      }

      // 2. Ensure output directory exists
      await fs.mkdir(this.config.outDir, { recursive: true });

      // 3. Build client bundle
      const clientResult = await this.buildClientBundle(manifest);
      if (clientResult) {
        files.push(clientResult);
      }

      // 4. Build server bundle
      const serverResult = await this.buildServerBundle(manifest);
      if (serverResult) {
        files.push(serverResult);
      }

      // 5. Generate final manifest
      const manifestResult = await this.generateManifest(manifest);
      files.push(manifestResult);

      return {
        success: errors.length === 0,
        files,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      errors.push({ message });
      return { success: false, files, errors, warnings };
    }
  }

  /**
   * Load the App manifest from the app directory
   */
  private async loadManifest(): Promise<AppManifest | null> {
    const manifestPath = path.join(this.config.appDir, "manifest.json");

    try {
      const content = await fs.readFile(manifestPath, "utf-8");
      return JSON.parse(content) as AppManifest;
    } catch {
      return null;
    }
  }

  /**
   * Build the client-side bundle
   *
   * This bundles all client-side code (React components, hooks, etc.)
   * that will run in the browser.
   *
   * - React is marked as external (provided by host runtime)
   * - Output format: ESM
   */
  private async buildClientBundle(manifest?: AppManifest | null): Promise<BundleFile | null> {
    // Try v2.0 single entry point first
    const singleEntryPoint = await this.findClientEntryPoint(manifest);

    if (singleEntryPoint) {
      // Build single-entry client bundle
      return this.buildSingleClientBundle(singleEntryPoint);
    }

    // Fall back to legacy auto-discovery
    const clientEntryPoints = await this.findClientEntryPoints();
    if (clientEntryPoints.length === 0) {
      return null;
    }

    // Create virtual entry content that exports all client components
    const virtualEntryContent = clientEntryPoints
      .map((file) => {
        const relativePath = path
          .relative(this.config.appDir, file)
          .replace(/\\/g, "/");
        const exportName = this.getExportName(relativePath);
        return `export { default as ${exportName} } from "./${relativePath}";`;
      })
      .join("\n");

    // Virtual module ID for the entry point
    const VIRTUAL_ENTRY_ID = "virtual:client-entry";
    const RESOLVED_VIRTUAL_ENTRY_ID = "\0" + VIRTUAL_ENTRY_ID;

    // Create a Vite plugin to handle the virtual entry module
    const virtualEntryPlugin: Plugin = {
      name: "app-bundler-virtual-entry",
      resolveId(id) {
        if (id === VIRTUAL_ENTRY_ID) {
          return RESOLVED_VIRTUAL_ENTRY_ID;
        }
      },
      load(id) {
        if (id === RESOLVED_VIRTUAL_ENTRY_ID) {
          return virtualEntryContent;
        }
      }
    };

    // Build with Vite/Rollup
    await viteBuild({
      configFile: false,
      root: this.config.appDir,
      plugins: [virtualEntryPlugin],
      build: {
        outDir: this.config.outDir,
        emptyOutDir: false,
        lib: {
          entry: VIRTUAL_ENTRY_ID,
          formats: ["es"],
          fileName: () => "client.bundle.js"
        },
        rollupOptions: {
          external: [
            // React is provided by the host runtime
            "react",
            "react-dom",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            // App SDK is provided by the host runtime
            "@takos/app-sdk",
            /^@takos\/app-sdk\/.*/
          ],
          output: {
            // Single file bundle
            preserveModules: false,
            // ESM format for browser
            format: "es",
            // Ensure proper external module interop
            interop: "auto",
            // Generate inline dynamic imports
            inlineDynamicImports: true
          }
        },
        sourcemap: this.config.sourcemap,
        minify: this.config.minify ? "esbuild" : false
      },
      esbuild: {
        jsx: "automatic",
        jsxImportSource: "react"
      },
      logLevel: "warn"
    });

    const outputPath = path.join(this.config.outDir, "client.bundle.js");
    const stats = await fs.stat(outputPath);

    return {
      path: "client.bundle.js",
      type: "client",
      size: stats.size
    };
  }

  /**
   * Build single-entry client bundle (v2.0)
   */
  private async buildSingleClientBundle(entryPath: string): Promise<BundleFile | null> {
    await viteBuild({
      configFile: false,
      root: this.config.appDir,
      build: {
        outDir: this.config.outDir,
        emptyOutDir: false,
        lib: {
          entry: entryPath,
          formats: ["es"],
          fileName: () => "client.bundle.js"
        },
        rollupOptions: {
          external: [
            // React is provided by the host runtime
            "react",
            "react-dom",
            "react/jsx-runtime",
            "react/jsx-dev-runtime",
            // React Router (common client-side router)
            "react-router-dom",
            "react-router",
            // App SDK is provided by the host runtime
            "@takos/app-sdk",
            /^@takos\/app-sdk\/.*/
          ],
          output: {
            preserveModules: false,
            format: "es",
            interop: "auto",
            inlineDynamicImports: true
          }
        },
        sourcemap: this.config.sourcemap,
        minify: this.config.minify ? "esbuild" : false
      },
      esbuild: {
        jsx: "automatic",
        jsxImportSource: "react"
      },
      logLevel: "warn"
    });

    const outputPath = path.join(this.config.outDir, "client.bundle.js");
    const stats = await fs.stat(outputPath);

    return {
      path: "client.bundle.js",
      type: "client",
      size: stats.size
    };
  }

  /**
   * Generate export name from file path
   */
  private getExportName(relativePath: string): string {
    // views/home.tsx -> ViewsHome
    // components/Button.tsx -> ComponentsButton
    return relativePath
      .replace(/\.(tsx?|jsx?)$/, "")
      .split("/")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("");
  }

  /**
   * Build the server-side bundle
   *
   * This bundles all server-side code (handlers, data fetchers, etc.)
   * that will run on Cloudflare Workers.
   *
   * - Output format: ESM (Cloudflare Workers compatible)
   * - Platform services (@takos/platform/*) are external
   * - Node.js built-ins are marked external
   */
  private async buildServerBundle(manifest?: AppManifest | null): Promise<BundleFile | null> {
    const entryPath = await this.findServerEntryPoint(manifest);

    if (!entryPath) {
      return null;
    }

    const handlersPath = entryPath;

    // Build with Vite/Rollup for Cloudflare Workers
    await viteBuild({
      configFile: false,
      root: this.config.appDir,
      build: {
        outDir: this.config.outDir,
        emptyOutDir: false,
        lib: {
          entry: handlersPath,
          formats: ["es"],
          fileName: () => "server.bundle.js"
        },
        rollupOptions: {
          external: [
            // Platform services are provided by the host runtime
            /^@takos\/platform.*/,
            // App SDK server utilities
            /^@takos\/app-sdk\/server.*/,
            // Node.js built-ins that Cloudflare Workers may polyfill
            /^node:/,
            // Cloudflare-specific modules
            "cloudflare:workers",
            // Custom external dependencies from config
            ...(this.config.external || [])
          ],
          output: {
            // Single file bundle for Workers
            preserveModules: false,
            // ESM format (required for Workers modules format)
            format: "es",
            // Ensure proper interop with external modules
            interop: "auto",
            // Named exports for handler functions
            exports: "named",
            // Inline dynamic imports for single-file output
            inlineDynamicImports: true
          }
        },
        sourcemap: this.config.sourcemap,
        minify: this.config.minify ? "esbuild" : false,
        // Target modern runtime (Cloudflare Workers V8)
        target: "esnext"
      },
      logLevel: "warn",
      // Define environment variables for Workers
      define: {
        "process.env.NODE_ENV": JSON.stringify(
          this.config.minify ? "production" : "development"
        )
      },
      // Resolve configuration for Workers environment
      resolve: {
        // Prefer ESM for all dependencies
        mainFields: ["module", "main"],
        // Conditions for module resolution
        conditions: ["worker", "browser", "import", "default"]
      }
    });

    const outputPath = path.join(this.config.outDir, "server.bundle.js");
    const stats = await fs.stat(outputPath);

    return {
      path: "server.bundle.js",
      type: "server",
      size: stats.size
    };
  }

  /**
   * Generate the final manifest.json with resolved paths and metadata
   */
  private async generateManifest(manifest: AppManifest): Promise<BundleFile> {
    // Merge manifest with resolved routes and views from JSON files
    const resolvedManifest = await this.resolveManifestFragments(manifest);

    const outputPath = path.join(this.config.outDir, "manifest.json");
    const content = JSON.stringify(resolvedManifest, null, 2);

    await fs.writeFile(outputPath, content);

    const stats = await fs.stat(outputPath);
    return {
      path: "manifest.json",
      type: "manifest",
      size: stats.size
    };
  }

  /**
   * Find server entry point for v2.0 Apps
   *
   * Search order:
   * 1. manifest.entry.server (if specified)
   * 2. index.ts / index.js
   * 3. src/server.ts / src/server.js
   * 4. server.ts / server.js
   * 5. handlers.ts / handlers.js (legacy)
   */
  private async findServerEntryPoint(manifest?: AppManifest | null): Promise<string | null> {
    // Check manifest.entry.server first (v2.0)
    if (manifest?.entry?.server) {
      const entryPath = path.join(this.config.appDir, manifest.entry.server);
      // If entry.server is dist path, look for source
      const sourcePath = entryPath
        .replace(/dist[/\\]/, "src/")
        .replace(/\.js$/, ".ts");

      for (const p of [sourcePath, entryPath]) {
        try {
          await fs.access(p);
          return p;
        } catch {
          // Continue
        }
      }
    }

    // Search in order of preference
    const candidates = [
      "index.ts",
      "index.js",
      "src/server.ts",
      "src/server.js",
      "server.ts",
      "server.js",
      "handlers.ts", // legacy
      "handlers.js", // legacy
    ];

    for (const candidate of candidates) {
      const candidatePath = path.join(this.config.appDir, candidate);
      try {
        await fs.access(candidatePath);
        return candidatePath;
      } catch {
        // Continue to next candidate
      }
    }

    return null;
  }

  /**
   * Find client entry point for v2.0 Apps
   *
   * Search order:
   * 1. manifest.entry.client (if specified)
   * 2. src/client.tsx / src/client.ts
   * 3. client.tsx / client.ts
   * 4. views/ directory (legacy auto-discovery)
   */
  private async findClientEntryPoint(manifest?: AppManifest | null): Promise<string | null> {
    // Check manifest.entry.client first (v2.0)
    if (manifest?.entry?.client) {
      const entryPath = path.join(this.config.appDir, manifest.entry.client);
      // If entry.client is dist path, look for source
      const sourcePath = entryPath
        .replace(/dist[/\\]/, "src/")
        .replace(/\.js$/, ".tsx");

      for (const p of [sourcePath, entryPath]) {
        try {
          await fs.access(p);
          return p;
        } catch {
          // Continue
        }
      }
    }

    // Search in order of preference
    const candidates = [
      "src/client.tsx",
      "src/client.ts",
      "client.tsx",
      "client.ts",
    ];

    for (const candidate of candidates) {
      const candidatePath = path.join(this.config.appDir, candidate);
      try {
        await fs.access(candidatePath);
        return candidatePath;
      } catch {
        // Continue to next candidate
      }
    }

    // Fall back to legacy auto-discovery
    return null;
  }

  /**
   * Find all client-side entry points
   */
  private async findClientEntryPoints(): Promise<string[]> {
    const patterns = [
      path.join(this.config.appDir, "views/**/*.tsx"),
      path.join(this.config.appDir, "components/**/*.tsx")
    ];

    const files: string[] = [];
    for (const pattern of patterns) {
      const matches = await glob(pattern, { nodir: true });
      files.push(...matches);
    }

    return files;
  }

  /**
   * Resolve manifest fragments from separate JSON files
   */
  private async resolveManifestFragments(
    manifest: AppManifest
  ): Promise<AppManifest> {
    const resolved: AppManifest = { ...manifest };

    // Load routes from routes/*.json
    const routesDir = path.join(this.config.appDir, "routes");
    const routes = await this.loadJsonFragments(routesDir);
    if (Object.keys(routes).length > 0) {
      resolved.routes = routes as AppManifest["routes"];
    }

    // Load views from views/*.json
    const viewsDir = path.join(this.config.appDir, "views");
    const views = await this.loadJsonFragments(viewsDir);
    if (Object.keys(views).length > 0) {
      resolved.views = views as AppManifest["views"];
    }

    // Load data schemas from data/*.json
    const dataDir = path.join(this.config.appDir, "data");
    const data = await this.loadJsonFragments(dataDir);
    if (Object.keys(data).length > 0) {
      resolved.data = data as AppManifest["data"];
    }

    return resolved;
  }

  /**
   * Load JSON fragments from a directory
   */
  private async loadJsonFragments(
    dir: string
  ): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    try {
      const files = await glob(path.join(dir, "*.json"), { nodir: true });

      for (const file of files) {
        const name = path.basename(file, ".json");
        const content = await fs.readFile(file, "utf-8");
        result[name] = JSON.parse(content);
      }
    } catch {
      // Directory doesn't exist or no JSON files
    }

    return result;
  }
}

/**
 * Create a new AppBundler instance
 */
export function createBundler(config: AppBundlerConfig): AppBundler {
  return new AppBundler(config);
}

/**
 * Bundle an App with the given configuration
 */
export async function bundleApp(
  config: AppBundlerConfig
): Promise<BundleResult> {
  const bundler = createBundler(config);
  return bundler.bundle();
}
