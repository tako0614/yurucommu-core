/**
 * Runtime Abstraction Types
 *
 * These interfaces abstract away Cloudflare Workers-specific APIs
 * to allow the application to run on different runtimes.
 */

/**
 * Shared metadata for query/run results
 */
export interface ResultMeta {
  changes?: number;
  last_row_id?: number;
  duration?: number;
}

/**
 * Database query result
 */
export interface QueryResult<T = unknown> {
  results: T[];
  success: boolean;
  meta?: ResultMeta;
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
  meta?: Pick<ResultMeta, "changes" | "last_row_id">;
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
  batch<T = unknown>(
    statements: PreparedStatement[],
  ): Promise<QueryResult<T>[]>;
}

/**
 * Bodies accepted by the provider-neutral object store seam.
 *
 * A body is handed to an adapter exactly once. Adapters must not eagerly
 * consume or clone streams; callers that need replayability own that concern.
 */
export type ObjectStoreBody =
  Blob | ReadableStream<Uint8Array> | ArrayBuffer | string;

/** Options for writing one object. */
export interface ObjectStorePutOptions {
  contentType?: string;
}

/**
 * One object returned by an ObjectStore read.
 *
 * The body remains lazy and is consumed through the returned stream. Metadata
 * is deliberately flat so callers do not depend on a vendor SDK's shape.
 */
export interface ObjectStoreObject {
  key: string;
  body: ReadableStream<Uint8Array> | null;
  contentType?: string;
  /**
   * The backend's etag VERBATIM, and opaque. Backends disagree on the spelling:
   * some hand over a bare digest, others an already-quoted tag. So this is a
   * value to compare and to store, never one to put in a header.
   */
  etag?: string;
  /**
   * The same etag as an entity-tag: quoted, and safe to emit (RFC 9110 §8.8.3).
   * Present exactly when `etag` is. This is the value a response carries in
   * `ETag` and the value a client echoes back in `If-None-Match`, so a
   * conditional request is evaluated against this one, not against `etag`.
   */
  httpEtag?: string;
  byteLength?: number;
}

/**
 * Provider-neutral object storage seam.
 *
 * Implementations expose only the operations used by production code. Object
 * enumeration and separate metadata probes are intentionally not part of the
 * contract; batch deletion is represented by passing an array of keys.
 */
export interface ObjectStore {
  put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<void>;

  get(key: string): Promise<ObjectStoreObject | null>;

  delete(key: string | readonly string[]): Promise<void>;
}

/**
 * Key-value store interface - abstracts KVNamespace
 */
export interface IKeyValueStore {
  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: "json" }): Promise<T | null>;
  get(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<ArrayBuffer | null>;

  put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    },
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
  storage?: ObjectStore;
  kv?: IKeyValueStore;
  assets?: IStaticAssets;

  // Environment variables
  APP_URL: string;
  AUTH_PASSWORD_HASH?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  OIDC_ISSUER_URL?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  OAUTH_ISSUER_URL?: string;
  TAKOSUMI_ACCOUNTS_ISSUER_URL?: string;
  TAKOSUMI_ACCOUNTS_CLIENT_ID?: string;
  TAKOSUMI_ACCOUNTS_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  AUTH_MODE?: string;
}
