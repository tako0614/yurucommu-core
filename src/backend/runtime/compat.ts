/**
 * Cloudflare Compatibility Layer
 *
 * These classes implement the same interface as Cloudflare D1/R2/KV
 * so existing code can work without changes on Node.js, Bun, Deno.
 *
 * This module re-exports everything from the compat/ subdirectory.
 */

export { D1CompatDatabase, D1CompatPreparedStatement } from "./compat/d1.ts";
export { R2CompatBucket } from "./compat/r2.ts";
export { KVCompatNamespace } from "./compat/kv.ts";
export { AssetsCompatFetcher } from "./compat/assets.ts";
export { createNodeEnv, runMigrations } from "./compat/env.ts";
