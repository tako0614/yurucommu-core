/**
 * Vite Plugin for App Bundler
 *
 * Integrates the App bundler into the Vite build pipeline.
 */

import * as path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { AppBundler } from "./bundler.js";
import type { VitePluginAppBundlerOptions } from "./types.js";

/**
 * Default plugin options
 */
const DEFAULT_OPTIONS: Required<VitePluginAppBundlerOptions> = {
  appDir: "app",
  outDir: "dist/app",
  watch: true,
  verbose: false
};

/**
 * Vite plugin for building App bundles
 *
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { appBundler } from "@takos/app-bundler/vite";
 *
 * export default defineConfig({
 *   plugins: [
 *     appBundler({
 *       appDir: "app",
 *       outDir: "dist/app"
 *     })
 *   ]
 * });
 * ```
 */
export function appBundler(
  options: VitePluginAppBundlerOptions = {}
): Plugin {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let config: ResolvedConfig;
  let bundler: AppBundler;

  return {
    name: "takos-app-bundler",

    configResolved(resolvedConfig) {
      config = resolvedConfig;

      // Initialize bundler with resolved paths
      const appDir = path.resolve(config.root, opts.appDir);
      const outDir = path.resolve(config.root, opts.outDir);

      bundler = new AppBundler({
        appDir,
        outDir,
        sourcemap: config.build.sourcemap !== false,
        minify: config.mode === "production"
      });

      if (opts.verbose) {
        config.logger.info(`[app-bundler] App directory: ${appDir}`);
        config.logger.info(`[app-bundler] Output directory: ${outDir}`);
      }
    },

    async buildStart() {
      if (config.command === "build") {
        // Run bundler at build start
        if (opts.verbose) {
          config.logger.info("[app-bundler] Building App bundles...");
        }

        const result = await bundler.bundle();

        if (!result.success) {
          const errors = result.errors?.map((e) => e.message).join("\n");
          throw new Error(`App bundler failed:\n${errors}`);
        }

        if (opts.verbose) {
          for (const file of result.files) {
            config.logger.info(
              `[app-bundler] Generated: ${file.path} (${formatBytes(file.size)})`
            );
          }
        }
      }
    },

    configureServer(server) {
      if (!opts.watch) return;

      // Watch app directory for changes in dev mode
      const appDir = path.resolve(config.root, opts.appDir);

      server.watcher.add(appDir);

      server.watcher.on("change", async (changedPath) => {
        if (!changedPath.startsWith(appDir)) return;

        if (opts.verbose) {
          config.logger.info(
            `[app-bundler] File changed: ${path.relative(config.root, changedPath)}`
          );
        }

        // Rebuild App bundles
        const result = await bundler.bundle();

        if (result.success) {
          // Trigger HMR update
          server.ws.send({
            type: "custom",
            event: "app-bundler:update",
            data: { files: result.files.map((f) => f.path) }
          });
        } else {
          const errors = result.errors?.map((e) => e.message).join("\n");
          config.logger.error(`[app-bundler] Build failed:\n${errors}`);
        }
      });
    },

    async closeBundle() {
      // Final build step - ensure bundles are in output
      if (config.command === "build" && opts.verbose) {
        config.logger.info("[app-bundler] Build complete");
      }
    }
  };
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Default export for convenience
export default appBundler;
