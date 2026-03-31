/**
 * Runtime Abstraction Layer
 *
 * Unified interface for different runtime environments.
 *
 * Supported runtimes:
 * - Cloudflare Workers / workerd (D1, R2, KV)
 * - Node.js (better-sqlite3, filesystem, memory KV)
 * - Bun (native SQLite, filesystem)
 * - Deno (deno.land/x/sqlite3, filesystem)
 */

export * from './cloudflare.ts';

