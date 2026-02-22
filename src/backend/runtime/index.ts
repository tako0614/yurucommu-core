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

export * from './types';
export * from './cloudflare';

import type { RuntimeEnv } from './types';

export type RuntimeType = 'cloudflare' | 'node' | 'bun' | 'deno';

export interface RuntimeConfig {
  databasePath?: string;
  storagePath?: string;
  assetsPath?: string;
  envVars: {
    APP_URL: string;
    AUTH_PASSWORD_HASH?: string;
    AUTH_PASSWORD?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    X_CLIENT_ID?: string;
    X_CLIENT_SECRET?: string;
    TAKOS_URL?: string;
    TAKOS_CLIENT_ID?: string;
    TAKOS_CLIENT_SECRET?: string;
    AUTH_MODE?: string;
  };
}

export function detectRuntime(): RuntimeType {
  // @ts-ignore - caches.default is a Cloudflare Workers global
  if (typeof caches !== 'undefined' && typeof caches.default !== 'undefined') {
    return 'cloudflare';
  }
  // @ts-ignore - Deno global
  if (typeof Deno !== 'undefined') return 'deno';
  // @ts-ignore - Bun global
  if (typeof Bun !== 'undefined') return 'bun';
  return 'node';
}

export function isCloudflareWorkers(): boolean {
  return detectRuntime() === 'cloudflare';
}

export function isNodeJS(): boolean {
  return detectRuntime() === 'node';
}

export function isBun(): boolean {
  return detectRuntime() === 'bun';
}

export function isDeno(): boolean {
  return detectRuntime() === 'deno';
}

/**
 * Create runtime environment based on detected or specified runtime.
 * Dynamically imports the appropriate adapter to avoid bundling issues.
 */
export async function createRuntime(
  config: RuntimeConfig,
  runtime?: RuntimeType
): Promise<RuntimeEnv> {
  const target = runtime ?? detectRuntime();

  switch (target) {
    case 'cloudflare':
      throw new Error('Cloudflare runtime should use createCloudflareRuntime with bindings');

    case 'node': {
      const { createNodeRuntime } = await import('./node');
      return createNodeRuntime(config);
    }

    case 'bun': {
      // @ts-ignore - Bun-specific module
      const mod = await import('./bun');
      return mod.createBunRuntime(config);
    }

    case 'deno': {
      // @ts-ignore - Deno-specific module
      const mod = await import('./deno');
      return mod.createDenoRuntime(config);
    }

    default:
      throw new Error(`Unsupported runtime: ${target}`);
  }
}

// Re-export individual runtime creators for direct use
export async function createNodeRuntime(config: RuntimeConfig): Promise<RuntimeEnv> {
  return createRuntime(config, 'node');
}

export async function createBunRuntime(config: RuntimeConfig): Promise<RuntimeEnv> {
  return createRuntime(config, 'bun');
}

export async function createDenoRuntime(config: RuntimeConfig): Promise<RuntimeEnv> {
  return createRuntime(config, 'deno');
}
