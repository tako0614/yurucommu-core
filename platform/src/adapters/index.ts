/**
 * Runtime Adapter Abstraction
 *
 * Provides a unified interface for takos to run on different runtimes:
 * - Cloudflare Workers (primary)
 * - Node.js (secondary, via separate import)
 * - Bun/Deno (future)
 *
 * Each adapter implements the RuntimeAdapter interface to provide
 * runtime-specific implementations of storage, database, and crypto operations.
 *
 * NOTE: NodeAdapter is NOT exported from this file to avoid bundling Node.js
 * modules in workerd builds. Import it directly from "./node" when needed.
 */

export interface KVStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string; expiration?: number }[];
    cursor?: string;
    list_complete: boolean;
  }>;
}

export interface ObjectStorage {
  get(key: string): Promise<{
    body: ReadableStream | null;
    httpMetadata?: { contentType?: string; cacheControl?: string };
    httpEtag?: string;
    size?: number;
  } | null>;
  put(
    key: string,
    body: ReadableStream | ArrayBuffer | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string; cacheControl?: string };
    }
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
  }): Promise<{
    objects: {
      key: string;
      size: number;
      uploaded: Date;
      httpEtag?: string;
      httpMetadata?: { contentType?: string; cacheControl?: string };
    }[];
    delimitedPrefixes?: string[];
    truncated: boolean;
    cursor?: string;
  }>;
}

export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): Promise<{
    results: unknown[];
    meta?: { changes?: number; last_row_id?: number };
  }>;
  batch(statements: { sql: string; params?: unknown[] }[]): Promise<
    { results: unknown[]; meta?: { changes?: number } }[]
  >;
}

export interface CryptoAdapter {
  subtle: SubtleCrypto;
  randomUUID(): string;
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

export interface RuntimeAdapter {
  name: string;
  version: string;

  kv: KVStore;
  storage: ObjectStorage;
  database: DatabaseAdapter;
  crypto: CryptoAdapter;

  getEnv(key: string): string | undefined;
  isProduction(): boolean;
}

export type RuntimeType = "cloudflare-workers" | "node" | "bun" | "deno" | "unknown";

export function detectRuntime(): RuntimeType {
  // Cloudflare Workers detection
  if (
    typeof globalThis !== "undefined" &&
    (globalThis as any).navigator?.userAgent === "Cloudflare-Workers"
  ) {
    return "cloudflare-workers";
  }

  // Bun detection
  if (typeof (globalThis as any).Bun !== "undefined") {
    return "bun";
  }

  // Deno detection
  if (typeof (globalThis as any).Deno !== "undefined") {
    return "deno";
  }

  // Node.js detection (safe check for workerd compatibility)
  if (
    typeof globalThis !== "undefined" &&
    typeof (globalThis as any).process !== "undefined" &&
    (globalThis as any).process?.versions?.node
  ) {
    return "node";
  }

  return "unknown";
}

export { CloudflareAdapter } from "./cloudflare";
// NOTE: NodeAdapter is intentionally NOT exported here.
// Import it directly from "@takos/platform/adapters/node" when needed in Node.js environments.
export * from "./websocket";
