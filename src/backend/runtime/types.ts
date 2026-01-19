/**
 * Runtime Abstraction Types
 *
 * These interfaces abstract away Cloudflare Workers-specific APIs
 * to allow the application to run on different runtimes.
 */

/**
 * Database query result
 */
export interface QueryResult<T = unknown> {
  results: T[];
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
  };
}

/**
 * Single row result
 */
export type FirstResult<T> = T | null;

/**
 * Run result (for INSERT/UPDATE/DELETE)
 */
export interface RunResult {
  success: boolean;
  meta?: {
    changes?: number;
    last_row_id?: number;
  };
}

/**
 * Prepared statement interface
 */
export interface PreparedStatement {
  bind(...values: unknown[]): PreparedStatement;
  first<T = unknown>(colName?: string): Promise<FirstResult<T>>;
  all<T = unknown>(): Promise<QueryResult<T>>;
  run(): Promise<RunResult>;
}

/**
 * Database interface - abstracts D1Database
 */
export interface IDatabase {
  prepare(query: string): PreparedStatement;
  exec(query: string): Promise<void>;
  batch<T = unknown>(statements: PreparedStatement[]): Promise<QueryResult<T>[]>;
}

/**
 * Object storage metadata
 */
export interface ObjectMetadata {
  contentType?: string;
  contentLength?: number;
  etag?: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
    contentEncoding?: string;
    contentLanguage?: string;
  };
  customMetadata?: Record<string, string>;
}

/**
 * Storage object interface
 */
export interface StorageObject {
  key: string;
  body: ReadableStream<Uint8Array> | null;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  httpMetadata?: ObjectMetadata['httpMetadata'];
  customMetadata?: Record<string, string>;
}

/**
 * List objects result
 */
export interface ListObjectsResult {
  objects: Array<{
    key: string;
    size: number;
    uploaded: Date;
    etag?: string;
    httpMetadata?: ObjectMetadata['httpMetadata'];
  }>;
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes?: string[];
}

/**
 * Object storage interface - abstracts R2Bucket
 */
export interface IObjectStorage {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata['httpMetadata'];
      customMetadata?: Record<string, string>;
    }
  ): Promise<void>;

  get(key: string): Promise<StorageObject | null>;

  delete(key: string | string[]): Promise<void>;

  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<ListObjectsResult>;

  head(key: string): Promise<ObjectMetadata | null>;
}

/**
 * Key-value store interface - abstracts KVNamespace
 */
export interface IKeyValueStore {
  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: 'json' }): Promise<T | null>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;

  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void>;

  delete(key: string): Promise<void>;

  list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }>;
}

/**
 * Static assets fetcher interface
 */
export interface IStaticAssets {
  fetch(request: Request): Promise<Response>;
}

/**
 * Runtime environment - for non-Cloudflare runtimes
 */
export interface RuntimeEnv {
  db: IDatabase;
  storage?: IObjectStorage;
  kv?: IKeyValueStore;
  assets?: IStaticAssets;

  // Environment variables
  APP_URL: string;
  AUTH_PASSWORD_HASH?: string;
  AUTH_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;
  AUTH_MODE?: string;
}

/**
 * Runtime type identifier
 */
export type RuntimeType = 'cloudflare' | 'node' | 'bun' | 'deno';

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  type: RuntimeType;
  database?: {
    type: 'sqlite' | 'postgres' | 'mysql' | 'd1';
    connectionString?: string;
    filename?: string;
  };
  storage?: {
    type: 'r2' | 'filesystem' | 's3';
    basePath?: string;
    bucket?: string;
    endpoint?: string;
    accessKey?: string;
    secretKey?: string;
  };
  kv?: {
    type: 'cloudflare-kv' | 'redis' | 'memory';
    url?: string;
  };
}
