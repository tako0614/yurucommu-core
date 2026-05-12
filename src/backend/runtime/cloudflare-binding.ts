/**
 * Cloudflare Workers binding boundary
 *
 * The Workers types (`D1Database`, `R2Bucket`, `KVNamespace`, `Fetcher`) are
 * nominal interfaces from `@cloudflare/workers-types`. The Deno / Node / Bun
 * runtime adapters in this directory implement the same surface area
 * structurally but are independently authored, so TypeScript cannot prove
 * assignability automatically.
 *
 * `toCloudflareBindings` is the single, named place where the
 * runtime-adapter -> Workers-binding bridge is acknowledged. Downstream code
 * always sees the Workers binding types, never re-casts.
 */

import type {
  IDatabase,
  IKeyValueStore,
  IObjectStorage,
  IStaticAssets,
} from "./types.ts";

export interface RuntimeAdapters {
  db: IDatabase;
  media: IObjectStorage;
  kv: IKeyValueStore;
  assets: IStaticAssets;
}

export interface CloudflareBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  KV: KVNamespace;
  ASSETS: Fetcher;
}

export function toCloudflareBindings(
  adapters: RuntimeAdapters,
): CloudflareBindings {
  return {
    DB: adapters.db as unknown as D1Database,
    MEDIA: adapters.media as unknown as R2Bucket,
    KV: adapters.kv as unknown as KVNamespace,
    ASSETS: adapters.assets as unknown as Fetcher,
  };
}
