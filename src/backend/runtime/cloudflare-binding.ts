/**
 * Cloudflare Workers binding boundary
 *
 * Maps a tuple of runtime adapters (concrete classes implementing
 * `IDatabase` / `IObjectStorage` / `IKeyValueStore` / `IStaticAssets`)
 * into the env-shape that the Hono app consumes via `Env.DB / MEDIA /
 * KV / ASSETS`. Identity mapping — the app's `Env` is declared in terms
 * of the same `I*` contracts, so no nominal cast is required.
 *
 * Native Cloudflare bindings (`D1Database` / `R2Bucket` / `KVNamespace`
 * / `Fetcher`) are wrapped by the adapter classes in `cloudflare.ts`
 * before reaching this function.
 */

import type {
  IDatabase,
  IKeyValueStore,
  IObjectStorage,
  IStaticAssets,
} from "./types.ts";

export interface RuntimeAdapters {
  db: IDatabase;
  media?: IObjectStorage;
  kv: IKeyValueStore;
  assets?: IStaticAssets;
}

export interface RuntimeBindings {
  DB: IDatabase;
  MEDIA?: IObjectStorage;
  KV: IKeyValueStore;
  ASSETS?: IStaticAssets;
}

export function toCloudflareBindings(
  adapters: RuntimeAdapters,
): RuntimeBindings {
  return {
    DB: adapters.db,
    MEDIA: adapters.media,
    KV: adapters.kv,
    ASSETS: adapters.assets,
  };
}
