export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface AppRouteDefinition {
  id: string;
  method: HttpMethod;
  path: string;
  handler: string;
  auth?: boolean;
  description?: string;
  // Additional metadata fields are kept as-is
  [key: string]: unknown;
}

export interface AppScreenDefinition {
  id: string;
  route?: string;
  title?: string;
  layout: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AppViewInsertDefinition {
  screen: string;
  position: string;
  order?: number;
  node: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AppApHandlerDefinition {
  id: string;
  handler: string;
  match?: Record<string, unknown>;
  [key: string]: unknown;
}

export type AppCollectionEngine = "sqlite" | string;

export interface AppCollectionColumnDefinition {
  type?: "text" | "integer" | "real" | "blob" | "json";
  primary_key?: boolean;
  primaryKey?: boolean;
  not_null?: boolean;
  notNull?: boolean;
  unique?: boolean;
  default?: unknown;
  references?: string;
  raw?: string;
  [key: string]: unknown;
}

export interface AppCollectionIndexDefinition {
  columns: string[] | string;
  name?: string;
  unique?: boolean;
  where?: string;
  [key: string]: unknown;
}

export interface AppCollectionDefinition {
  engine?: AppCollectionEngine;
  schema?: Record<string, AppCollectionColumnDefinition | string>;
  primary_key?: string | string[];
  primaryKey?: string | string[];
  indexes?: AppCollectionIndexDefinition[];
  [key: string]: unknown;
}
export type AppBucketDefinition = Record<string, unknown>;

export interface AppManifest {
  schemaVersion: string;
  version?: string;
  routes: AppRouteDefinition[];
  views: {
    screens: AppScreenDefinition[];
    insert: AppViewInsertDefinition[];
  };
  ap: {
    handlers: AppApHandlerDefinition[];
  };
  data: {
    collections: Record<string, AppCollectionDefinition>;
  };
  storage: {
    buckets: Record<string, AppBucketDefinition>;
  };
}

export interface AppManifestLayout {
  baseDir: string;
  routesDir: string;
  viewsDir: string;
  apDir: string;
  dataDir: string;
  storageDir: string;
}

export const DEFAULT_APP_LAYOUT: AppManifestLayout = {
  baseDir: "app",
  routesDir: "routes",
  viewsDir: "views",
  apDir: "ap",
  dataDir: "data",
  storageDir: "storage",
};

export type AppManifestValidationIssue = {
  severity: "error" | "warning";
  message: string;
  path?: string;
  file?: string;
};

export interface AppDefinitionSource {
  readFile(path: string): Promise<string>;
  listFiles(path: string): Promise<string[]>;
}

export interface LoadAppManifestOptions {
  source: AppDefinitionSource;
  rootDir?: string;
  availableHandlers?: Iterable<string>;
}

export interface AppManifestLoadResult {
  manifest?: AppManifest;
  layout?: AppManifestLayout;
  issues: AppManifestValidationIssue[];
}
