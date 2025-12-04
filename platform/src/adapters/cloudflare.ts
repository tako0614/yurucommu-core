/**
 * Cloudflare Workers Runtime Adapter
 *
 * Provides the primary adapter implementation for Cloudflare Workers environment.
 * Uses D1 for database, R2 for object storage, and KV for key-value storage.
 */

import type {
  RuntimeAdapter,
  KVStore,
  ObjectStorage,
  DatabaseAdapter,
  CryptoAdapter,
} from "./index";

export interface CloudflareBindings {
  DB?: D1Database;
  MEDIA?: R2Bucket;
  KV?: KVNamespace;
  [key: string]: unknown;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: {
    changes?: number;
    last_row_id?: number;
    duration?: number;
  };
}

interface D1ExecResult {
  count: number;
  duration: number;
}

interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | string | Blob,
    options?: R2PutOptions
  ): Promise<R2Object>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  httpEtag?: string;
  httpMetadata?: R2HTTPMetadata;
  body: ReadableStream;
}

interface R2HTTPMetadata {
  contentType?: string;
  cacheControl?: string;
}

interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
}

interface R2ListOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

interface R2Objects {
  objects: R2Object[];
  delimitedPrefixes?: string[];
  truncated: boolean;
  cursor?: string;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<KVListResult>;
}

interface KVListResult {
  keys: { name: string; expiration?: number }[];
  cursor?: string;
  list_complete: boolean;
}

class CloudflareKVStore implements KVStore {
  constructor(private kv: KVNamespace | undefined) {}

  async get(key: string): Promise<string | null> {
    if (!this.kv) throw new Error("KV namespace not configured");
    return this.kv.get(key);
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    if (!this.kv) throw new Error("KV namespace not configured");
    await this.kv.put(key, value, options);
  }

  async delete(key: string): Promise<void> {
    if (!this.kv) throw new Error("KV namespace not configured");
    await this.kv.delete(key);
  }

  async list(options?: { prefix?: string; limit?: number; cursor?: string }) {
    if (!this.kv) throw new Error("KV namespace not configured");
    return this.kv.list(options);
  }
}

class CloudflareObjectStorage implements ObjectStorage {
  constructor(private bucket: R2Bucket | undefined) {}

  async get(key: string) {
    if (!this.bucket) throw new Error("R2 bucket not configured");
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    return {
      body: obj.body,
      httpMetadata: obj.httpMetadata,
      httpEtag: obj.httpEtag,
      size: obj.size,
    };
  }

  async put(
    key: string,
    body: ReadableStream | ArrayBuffer | string | Blob,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } }
  ): Promise<void> {
    if (!this.bucket) throw new Error("R2 bucket not configured");
    await this.bucket.put(key, body, options);
  }

  async delete(key: string): Promise<void> {
    if (!this.bucket) throw new Error("R2 bucket not configured");
    await this.bucket.delete(key);
  }

  async list(options?: { prefix?: string; delimiter?: string; cursor?: string }) {
    if (!this.bucket) throw new Error("R2 bucket not configured");
    const result = await this.bucket.list(options);
    return {
      objects: result.objects.map((obj) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
        httpEtag: obj.httpEtag,
        httpMetadata: obj.httpMetadata,
      })),
      delimitedPrefixes: result.delimitedPrefixes,
      truncated: result.truncated,
      cursor: result.cursor,
    };
  }
}

class CloudflareDatabase implements DatabaseAdapter {
  constructor(private db: D1Database | undefined) {}

  async execute(sql: string, params?: unknown[]) {
    if (!this.db) throw new Error("D1 database not configured");
    const stmt = this.db.prepare(sql);
    const bound = params && params.length > 0 ? stmt.bind(...params) : stmt;
    const result = await bound.all();
    return {
      results: result.results || [],
      meta: {
        changes: result.meta?.changes,
        last_row_id: result.meta?.last_row_id,
      },
    };
  }

  async batch(statements: { sql: string; params?: unknown[] }[]) {
    if (!this.db) throw new Error("D1 database not configured");
    const prepared = statements.map(({ sql, params }) => {
      const stmt = this.db!.prepare(sql);
      return params && params.length > 0 ? stmt.bind(...params) : stmt;
    });
    const results = await this.db.batch(prepared);
    return results.map((r) => ({
      results: r.results || [],
      meta: { changes: r.meta?.changes },
    }));
  }
}

class CloudflareCrypto implements CryptoAdapter {
  get subtle(): SubtleCrypto {
    return crypto.subtle;
  }

  randomUUID(): string {
    return crypto.randomUUID();
  }

  getRandomValues<T extends ArrayBufferView | null>(array: T): T {
    if (array === null) return array;
    // TypeScript has strict generics constraints; use unknown cast
    return crypto.getRandomValues(array as unknown as Uint8Array) as unknown as T;
  }
}

export class CloudflareAdapter implements RuntimeAdapter {
  readonly name = "cloudflare-workers";
  readonly version = "1.0.0";

  readonly kv: KVStore;
  readonly storage: ObjectStorage;
  readonly database: DatabaseAdapter;
  readonly crypto: CryptoAdapter;

  private env: CloudflareBindings;

  constructor(env: CloudflareBindings) {
    this.env = env;
    this.kv = new CloudflareKVStore(env.KV as KVNamespace | undefined);
    this.storage = new CloudflareObjectStorage(env.MEDIA as R2Bucket | undefined);
    this.database = new CloudflareDatabase(env.DB as D1Database | undefined);
    this.crypto = new CloudflareCrypto();
  }

  getEnv(key: string): string | undefined {
    const value = this.env[key];
    return typeof value === "string" ? value : undefined;
  }

  isProduction(): boolean {
    const context = this.getEnv("TAKOS_CONTEXT") || this.getEnv("APP_ENV") || "prod";
    return !["dev", "development", "local", "preview"].includes(context.toLowerCase());
  }
}

export function createCloudflareAdapter(env: CloudflareBindings): RuntimeAdapter {
  return new CloudflareAdapter(env);
}
