/**
 * Cloudflare Compatibility Layer
 *
 * These classes implement the same interface as Cloudflare D1/R2/KV
 * so existing code can work without changes on Node.js, Bun, Deno.
 *
 * This module re-exports everything from the compat/ subdirectory.
 */

export { D1CompatDatabase, D1CompatPreparedStatement } from './compat/d1';
export { R2CompatBucket } from './compat/r2';
export { KVCompatNamespace } from './compat/kv';
export { AssetsCompatFetcher } from './compat/assets';
export { createNodeEnv, runMigrations } from './compat/env';
