/**
 * Cloudflare Workers Runtime Adapters
 *
 * These adapters wrap Cloudflare-specific APIs to conform to the runtime interfaces.
 */

import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Fetcher,
  KVNamespace,
  R2Bucket,
  R2Object,
} from "@cloudflare/workers-types";
import type {
  FirstResult,
  IDatabase,
  IKeyValueStore,
  IObjectStorage,
  IStaticAssets,
  ListObjectsResult,
  ObjectMetadata,
  PreparedStatement,
  QueryResult,
  RunResult,
  StorageObject,
} from "./types.ts";

/**
 * Cloudflare D1 Database Adapter
 */
class CloudflareDatabase implements IDatabase {
  constructor(private db: D1Database) {}

  prepare(query: string): PreparedStatement {
    return new CloudflarePreparedStatement(this.db.prepare(query));
  }

  async exec(query: string): Promise<void> {
    await this.db.exec(query);
  }

  async batch<T = unknown>(
    statements: PreparedStatement[],
  ): Promise<QueryResult<T>[]> {
    const d1Statements = statements.map((s) => {
      if (s instanceof CloudflarePreparedStatement) return s.getD1Statement();
      throw new Error("Invalid statement type for Cloudflare batch");
    });

    const results = await this.db.batch<T>(d1Statements);
    return results.map((r: D1Result<T>) => ({
      results: r.results,
      success: r.success,
      meta: r.meta,
    }));
  }
}

/**
 * Cloudflare D1 Prepared Statement Adapter
 */
class CloudflarePreparedStatement implements PreparedStatement {
  private stmt: D1PreparedStatement;

  constructor(stmt: D1PreparedStatement) {
    this.stmt = stmt;
  }

  bind(...values: unknown[]): PreparedStatement {
    this.stmt = this.stmt.bind(...values);
    return this;
  }

  async first<T = unknown>(colName?: string): Promise<FirstResult<T>> {
    return colName !== undefined
      ? await this.stmt.first<T>(colName)
      : await this.stmt.first<T>();
  }

  async all<T = unknown>(): Promise<QueryResult<T>> {
    const result = await this.stmt.all<T>();
    return {
      results: result.results,
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

  getD1Statement(): D1PreparedStatement {
    return this.stmt;
  }
}

/**
 * Cloudflare R2 Storage Adapter
 */
class CloudflareStorage implements IObjectStorage {
  constructor(private bucket: R2Bucket) {}

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata["httpMetadata"];
      customMetadata?: Record<string, string>;
    },
  ): Promise<void> {
    await this.bucket.put(key, value, {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;

    return {
      key,
      body: obj.body,
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
    return {
      objects: result.objects.map((obj: R2Object) => ({
        key: obj.key,
        size: obj.size,
        uploaded: obj.uploaded,
        etag: obj.etag,
        httpMetadata: obj.httpMetadata,
      })),
      truncated: result.truncated,
      cursor: result.truncated ? result.cursor : undefined,
      delimitedPrefixes: result.delimitedPrefixes,
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
class CloudflareKV implements IKeyValueStore {
  constructor(private kv: KVNamespace) {}

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: "json" }): Promise<T | null>;
  get(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<ArrayBuffer | null>;
  async get(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" },
  ): Promise<string | ArrayBuffer | unknown | null> {
    const type = options?.type ?? "text";
    if (type === "json") return this.kv.get(key, { type: "json" });
    if (type === "arrayBuffer") {
      return this.kv.get(key, { type: "arrayBuffer" });
    }
    return this.kv.get(key, { type: "text" });
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.kv.put(key, value, {
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
    return {
      keys: result.keys,
      list_complete: result.list_complete,
      cursor: result.list_complete ? undefined : result.cursor,
    };
  }
}

/**
 * Cloudflare Static Assets Adapter
 */
class CloudflareAssets implements IStaticAssets {
  constructor(private assets: Fetcher) {}

  fetch(request: Request): Promise<Response> {
    return this.assets.fetch(request);
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
  CLIENT_ID?: string;
  CLIENT_SECRET?: string;
  TAKOS_URL?: string;
  AUTH_MODE?: string;
}) {
  const {
    DB,
    MEDIA,
    KV,
    ASSETS,
    APP_URL,
    AUTH_PASSWORD_HASH,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    X_CLIENT_ID,
    X_CLIENT_SECRET,
    OIDC_ISSUER_URL,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OAUTH_ISSUER_URL,
    TAKOSUMI_ACCOUNTS_ISSUER_URL,
    TAKOSUMI_ACCOUNTS_CLIENT_ID,
    TAKOSUMI_ACCOUNTS_CLIENT_SECRET,
    CLIENT_ID,
    CLIENT_SECRET,
    TAKOS_URL,
    AUTH_MODE,
  } = env;

  return {
    db: new CloudflareDatabase(DB),
    storage: MEDIA ? new CloudflareStorage(MEDIA) : undefined,
    kv: KV ? new CloudflareKV(KV) : undefined,
    assets: ASSETS ? new CloudflareAssets(ASSETS) : undefined,
    APP_URL,
    AUTH_PASSWORD_HASH,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    X_CLIENT_ID,
    X_CLIENT_SECRET,
    OIDC_ISSUER_URL,
    OIDC_CLIENT_ID,
    OIDC_CLIENT_SECRET,
    OAUTH_ISSUER_URL,
    TAKOSUMI_ACCOUNTS_ISSUER_URL,
    TAKOSUMI_ACCOUNTS_CLIENT_ID,
    TAKOSUMI_ACCOUNTS_CLIENT_SECRET,
    CLIENT_ID,
    CLIENT_SECRET,
    TAKOS_URL,
    AUTH_MODE,
  };
}
