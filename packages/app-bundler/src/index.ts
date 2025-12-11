/**
 * @takos/app-bundler
 *
 * App bundler for takos platform.
 * Bundles App code into client.bundle.js, server.bundle.js, and manifest.json.
 *
 * @example
 * ```ts
 * import { bundleApp, createBundler } from "@takos/app-bundler";
 *
 * // Simple usage
 * const result = await bundleApp({
 *   appDir: "./app",
 *   outDir: "./dist/app"
 * });
 *
 * // Or use the bundler instance for more control
 * const bundler = createBundler({
 *   appDir: "./app",
 *   outDir: "./dist/app"
 * });
 * const result = await bundler.bundle();
 * ```
 */

// Core bundler
export { AppBundler, bundleApp, createBundler } from "./bundler.js";

// Validator
export {
  AppValidator,
  createValidator,
  validateApp,
  type ValidationError,
  type ValidationResult,
  type ValidationWarning,
  type ValidatorOptions
} from "./validator.js";

// Types
export type {
  ActivityPubConfig,
  AppBundlerConfig,
  AppManifest,
  BundleError,
  BundleFile,
  BundleResult,
  BundleWarning,
  DataSchemaConfig,
  FieldConfig,
  RouteConfig,
  StorageConfig,
  ViewConfig,
  VitePluginAppBundlerOptions
} from "./types.js";
