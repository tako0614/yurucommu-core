/**
 * App Bundler Types
 *
 * Defines the configuration and output types for the App bundler.
 */

/**
 * Configuration for the App bundler
 */
export interface AppBundlerConfig {
  /**
   * Root directory of the App (contains manifest.json, handlers.ts, etc.)
   */
  appDir: string;

  /**
   * Output directory for bundled files
   */
  outDir: string;

  /**
   * Enable source maps
   * @default true
   */
  sourcemap?: boolean;

  /**
   * Enable minification
   * @default true in production
   */
  minify?: boolean;

  /**
   * Custom external dependencies (won't be bundled)
   */
  external?: string[];
}

/**
 * App entry points (v2.0)
 */
export interface AppEntry {
  /**
   * Server-side entry point (e.g., "src/server.ts", "index.ts")
   */
  server: string;

  /**
   * Client-side entry point (e.g., "src/client.tsx")
   */
  client?: string;

  /**
   * Styles entry point (e.g., "src/styles.css")
   */
  styles?: string;
}

/**
 * App Manifest structure
 * Supports both v1.0 (legacy) and v2.0 formats
 */
export interface AppManifest {
  /**
   * Schema version ("2.0" for new format)
   */
  schema_version?: "2.0";

  /**
   * Unique identifier for the App
   */
  id: string;

  /**
   * Display name of the App
   */
  name: string;

  /**
   * Version string (semver)
   */
  version: string;

  /**
   * App description
   */
  description?: string;

  /**
   * Base app this is derived from (v2.0)
   */
  basedOn?: string;

  /**
   * Whether this app has been modified from the base (v2.0)
   */
  modified?: boolean;

  /**
   * Entry points (v2.0)
   */
  entry?: AppEntry;

  /**
   * Routes configuration
   */
  routes?: Record<string, RouteConfig>;

  /**
   * Views configuration
   */
  views?: Record<string, ViewConfig>;

  /**
   * ActivityPub handlers
   */
  activityPub?: ActivityPubConfig;

  /**
   * Data schemas
   */
  data?: Record<string, DataSchemaConfig>;

  /**
   * Storage configuration
   */
  storage?: StorageConfig;
}

/**
 * Route configuration
 */
export interface RouteConfig {
  /**
   * Path pattern (e.g., "/posts/:id")
   */
  path: string;

  /**
   * View to render
   */
  view: string;

  /**
   * Required authentication level
   */
  auth?: "public" | "authenticated" | "owner";
}

/**
 * View configuration
 */
export interface ViewConfig {
  /**
   * View type
   */
  type: "list" | "detail" | "form" | "custom";

  /**
   * Component tree or reference
   */
  component?: unknown;

  /**
   * Data source
   */
  data?: string;
}

/**
 * ActivityPub configuration
 */
export interface ActivityPubConfig {
  /**
   * Supported activity types
   */
  activities?: string[];

  /**
   * Object type handlers
   */
  objectTypes?: string[];
}

/**
 * Data schema configuration
 */
export interface DataSchemaConfig {
  /**
   * Schema type
   */
  type: "object" | "collection";

  /**
   * Fields definition
   */
  fields?: Record<string, FieldConfig>;
}

/**
 * Field configuration
 */
export interface FieldConfig {
  type: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Storage configuration
 */
export interface StorageConfig {
  /**
   * KV namespaces
   */
  kv?: string[];

  /**
   * R2 buckets
   */
  r2?: string[];
}

/**
 * Bundle output result
 */
export interface BundleResult {
  /**
   * Whether the build succeeded
   */
  success: boolean;

  /**
   * Generated files
   */
  files: BundleFile[];

  /**
   * Build errors
   */
  errors?: BundleError[];

  /**
   * Build warnings
   */
  warnings?: BundleWarning[];
}

/**
 * Generated bundle file
 */
export interface BundleFile {
  /**
   * File path relative to outDir
   */
  path: string;

  /**
   * File type
   */
  type: "client" | "server" | "manifest" | "sourcemap";

  /**
   * File size in bytes
   */
  size: number;
}

/**
 * Bundle error
 */
export interface BundleError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/**
 * Bundle warning
 */
export interface BundleWarning {
  message: string;
  file?: string;
}

/**
 * Vite plugin options
 */
export interface VitePluginAppBundlerOptions {
  /**
   * App directory (relative to project root)
   * @default "app"
   */
  appDir?: string;

  /**
   * Output directory for App bundles
   * @default "dist/app"
   */
  outDir?: string;

  /**
   * Watch for changes in development mode
   * @default true
   */
  watch?: boolean;

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;
}
