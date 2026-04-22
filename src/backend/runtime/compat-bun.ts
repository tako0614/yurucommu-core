// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Cloudflare Compatibility Layer
 *
 * These classes implement the same interface as Cloudflare D1/R2/KV
 * so existing code can work without changes on Bun.
 *
 * This is the entry point that re-exports all modules.
 */

export {
  D1CompatDatabase,
  D1CompatPreparedStatement,
} from "./compat-bun/d1.ts";
export { R2CompatBucket } from "./compat-bun/r2.ts";
export type { R2CompatObjectHead } from "./compat-bun/r2.ts";
export { KVCompatNamespace } from "./compat-bun/kv.ts";
export { AssetsCompatFetcher } from "./compat-bun/assets.ts";
export { createBunEnv, runMigrations } from "./compat-bun/env.ts";
