/**
 * Cloudflare Workers Runtime Adapters
 *
 * These adapters wrap Cloudflare-specific APIs to conform to the runtime interfaces.
 */

import type { D1Database, R2Bucket, KVNamespace, Fetcher } from '@cloudflare/workers-types';
import type {
  IDatabase,
  IObjectStorage,
  IKeyValueStore,
  IStaticAssets,
  PreparedStatement,
  QueryResult,
  FirstResult,
  RunResult,
  StorageObject,
  ListObjectsResult,
  ObjectMetadata,
} from './types';

/**
 * Cloudflare D1 Database Adapter
 */
export class CloudflareDatabase implements IDatabase {
  constructor(private db: D1Database) {}

  prepare(query: string): PreparedStatement {
    const stmt = this.db.prepare(query);
    return new CloudflarePreparedStatement(stmt);
  }

  async exec(query: string): Promise<void> {
    await this.db.exec(query);
  }

  async batch<T = unknown>(statements: PreparedStatement[]): Promise<QueryResult<T>[]> {
    const d1Statements = statements.map((s) => {
      if (s instanceof CloudflarePreparedStatement) {
        return s.getD1Statement();
      }
      throw new Error('Invalid statement type for Cloudflare batch');
    });

    const results = await this.db.batch(d1Statements);
    return results.map((r) => ({
      results: (r.results ?? []) as T[],
      success: r.success,
      meta: r.meta,
    }));
  }
}

/**
 * Cloudflare D1 Prepared Statement Adapter
 */
class CloudflarePreparedStatement implements PreparedStatement {
  private stmt: ReturnType<D1Database['prepare']>;

  constructor(stmt: ReturnType<D1Database['prepare']>) {
    this.stmt = stmt;
  }

  bind(...values: unknown[]): PreparedStatement {
    this.stmt = this.stmt.bind(...values);
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    if (colName) {
      return this.stmt.first<T>(colName);
    }
    return this.stmt.first<T>();
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    const result = await this.stmt.all<T>();
    return {
      results: result.results ?? [],
      success: result.success,
      meta: result.meta,
    };
  }

  async run(): Promise<RunResult> {
    const result = await this.stmt.run();
    return {
      success: result.success,
      meta: result.meta,
    };
  }

  getD1Statement(): ReturnType<D1Database['prepare']> {
    return this.stmt;
  }
}

/**
 * Cloudflare R2 Storage Adapter
 */
export class CloudflareStorage implements IObjectStorage {
  constructor(private bucket: R2Bucket) {}

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata['httpMetadata'];
      customMetadata?: Record<string, string>;
    }
  ): Promise<void> {
    // Cast value to match R2Bucket.put expectations
    await this.bucket.put(key, value as Parameters<R2Bucket['put']>[1], {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;

    return {
      key,
      body: obj.body as ReadableStream<Uint8Array> | null,
      bodyUsed: obj.bodyUsed,
      arrayBuffer: () => obj.arrayBuffer(),
      text: () => obj.text(),
      json: <T>() => obj.json<T>(),
      httpMetadata: obj.httpMetadata,
      customMetadata: obj.customMetadata,
    };
  }

  async delete(key: string | string[]): Promise<void> {
    await this.bucket.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<ListObjectsResult> {
    const result = await this.bucket.list(options);
    // R2Objects type varies - use type assertion for cursor
    const r2Result = result as { objects: typeof result.objects; truncated: boolean; cursor?: string; delimitedPrefixes?: string[] };
    return {
      objects: r2Result.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
        etag: obj.etag,
        httpMetadata: obj.httpMetadata,
      })),
      truncated: r2Result.truncated,
      cursor: r2Result.cursor,
      delimitedPrefixes: r2Result.delimitedPrefixes,
    };
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const obj = await this.bucket.head(key);
    if (!obj) return null;

    return {
      contentType: obj.httpMetadata?.contentType,
      contentLength: obj.size,
      etag: obj.etag,
      httpMetadata: obj.httpMetadata,
      customMetadata: obj.customMetadata,
    };
  }
}

/**
 * Cloudflare KV Adapter
 */
export class CloudflareKV implements IKeyValueStore {
  constructor(private kv: KVNamespace) {}

  get(key: string, options?: { type?: 'text' }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: 'json' }): Promise<T | null>;
  get(key: string, options: { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
  async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' }): Promise<string | ArrayBuffer | unknown | null> {
    const type = options?.type ?? 'text';
    if (type === 'json') {
      return this.kv.get(key, { type: 'json' });
    }
    if (type === 'arrayBuffer') {
      return this.kv.get(key, { type: 'arrayBuffer' });
    }
    return this.kv.get(key, { type: 'text' });
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    }
  ): Promise<void> {
    await this.kv.put(key, value as string, {
      expirationTtl: options?.expirationTtl,
      expiration: options?.expiration,
      metadata: options?.metadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const result = await this.kv.list(options);
    // KVNamespaceListResult type varies - use type assertion
    const kvResult = result as { keys: typeof result.keys; list_complete: boolean; cursor?: string };
    return {
      keys: kvResult.keys,
      list_complete: kvResult.list_complete,
      cursor: kvResult.cursor,
    };
  }
}

/**
 * Cloudflare Static Assets Adapter
 */
export class CloudflareAssets implements IStaticAssets {
  constructor(private assets: Fetcher) {}

  async fetch(request: Request): Promise<Response> {
    // Cast to handle type differences between standard Request/Response and Cloudflare types
    const response = await this.assets.fetch(request as unknown as Parameters<Fetcher['fetch']>[0]);
    return response as unknown as Response;
  }
}

/**
 * Create runtime environment from Cloudflare bindings
 */
export function createCloudflareRuntime(env: {
  DB: D1Database;
  MEDIA?: R2Bucket;
  KV?: KVNamespace;
  ASSETS?: Fetcher;
  APP_URL: string;
  AUTH_PASSWORD?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  TAKOS_CLIENT_ID?: string;
  TAKOS_CLIENT_SECRET?: string;
  AUTH_MODE?: string;
}) {
  return {
    db: new CloudflareDatabase(env.DB),
    storage: env.MEDIA ? new CloudflareStorage(env.MEDIA) : undefined,
    kv: env.KV ? new CloudflareKV(env.KV) : undefined,
    assets: env.ASSETS ? new CloudflareAssets(env.ASSETS) : undefined,
    APP_URL: env.APP_URL,
    AUTH_PASSWORD: env.AUTH_PASSWORD,
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    X_CLIENT_ID: env.X_CLIENT_ID,
    X_CLIENT_SECRET: env.X_CLIENT_SECRET,
    TAKOS_URL: env.TAKOS_URL,
    TAKOS_CLIENT_ID: env.TAKOS_CLIENT_ID,
    TAKOS_CLIENT_SECRET: env.TAKOS_CLIENT_SECRET,
    AUTH_MODE: env.AUTH_MODE,
  };
}
