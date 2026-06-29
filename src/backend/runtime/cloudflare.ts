/**
 * Cloudflare Workers Runtime Adapters
 *
 * These adapters wrap Cloudflare-specific APIs to conform to the runtime interfaces.
 */

import type {
  D1Database,
  Fetcher,
  KVNamespace,
  R2Bucket,
  R2Object,
} from "@cloudflare/workers-types";
import { getDb } from "../../db/index.ts";
import type {
  IKeyValueStore,
  IObjectStorage,
  IStaticAssets,
  ListObjectsResult,
  ObjectMetadata,
  StorageObject,
} from "./types.ts";

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
    await this.bucket.put(key, value as Parameters<R2Bucket["put"]>[1], {
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    });
  }

  async get(key: string): Promise<StorageObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;

    return {
      key,
      body: obj.body as unknown as ReadableStream,
      bodyUsed: obj.bodyUsed,
      httpEtag: obj.httpEtag,
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
    await this.kv.put(key, value as Parameters<KVNamespace["put"]>[1], {
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
    return this.assets.fetch(request as never) as unknown as Promise<Response>;
  }
}

/**
 * Wrap a native Cloudflare Workers binding env into the app's runtime
 * `Env` shape. The Hono app and all helper functions speak the runtime
 * `I*` contracts, so every binding flows through this adapter before
 * reaching app code. Pre-creates the drizzle wrapper as `DB_INSTANCE`.
 */
export function wrapCloudflareBindings<
  T extends {
    DB: D1Database;
    MEDIA?: R2Bucket;
    KV: KVNamespace;
    ASSETS?: Fetcher;
  },
>(
  bindings: T,
): Omit<T, "DB" | "MEDIA" | "KV" | "ASSETS"> & {
  DB_INSTANCE: ReturnType<typeof getDb>;
  MEDIA?: IObjectStorage;
  KV: IKeyValueStore;
  ASSETS?: IStaticAssets;
} {
  const { DB, MEDIA, KV, ASSETS, ...rest } = bindings;
  return {
    ...rest,
    DB_INSTANCE: getDb(DB),
    MEDIA: MEDIA ? new CloudflareStorage(MEDIA) : undefined,
    KV: new CloudflareKV(KV),
    ASSETS: ASSETS ? new CloudflareAssets(ASSETS) : undefined,
  };
}
