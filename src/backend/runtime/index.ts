/**
 * Runtime Abstraction Layer
 *
 * This module provides a unified interface for different runtime environments.
 * Use the appropriate adapter based on your deployment target.
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

/**
 * Detect current runtime environment
 */
export function detectRuntime(): RuntimeType {
  // Check for Cloudflare Workers
  // @ts-expect-error - caches is a global in Cloudflare Workers
  if (typeof caches !== 'undefined' && typeof caches.default !== 'undefined') {
    return 'cloudflare';
  }

  // Check for Deno
  // @ts-expect-error - Deno is a global in Deno
  if (typeof Deno !== 'undefined') {
    return 'deno';
  }

  // Check for Bun
  // @ts-ignore - Bun is a global in Bun runtime
  if (typeof Bun !== 'undefined') {
    return 'bun';
  }

  // Default to Node.js
  return 'node';
}

/**
 * Type guard to check if we're in Cloudflare Workers environment
 */
export function isCloudflareWorkers(): boolean {
  return detectRuntime() === 'cloudflare';
}

/**
 * Type guard to check if we're in Node.js environment
 */
export function isNodeJS(): boolean {
  return detectRuntime() === 'node';
}

/**
 * Type guard to check if we're in Bun environment
 */
export function isBun(): boolean {
  return detectRuntime() === 'bun';
}

/**
 * Type guard to check if we're in Deno environment
 */
export function isDeno(): boolean {
  return detectRuntime() === 'deno';
}

/**
 * Create runtime environment based on detected or specified runtime
 * Dynamically imports the appropriate adapter to avoid bundling issues
 */
export async function createRuntime(
  config: RuntimeConfig,
  runtime?: RuntimeType
): Promise<RuntimeEnv> {
  const detectedRuntime = runtime || detectRuntime();

  switch (detectedRuntime) {
    case 'cloudflare':
      throw new Error('Cloudflare runtime should use createCloudflareRuntime with bindings');

    case 'node': {
      const { createNodeRuntime } = await import('./node');
      return createNodeRuntime(config);
    }

    case 'bun': {
      // Dynamic import - only executed in Bun runtime
      // @ts-ignore - Bun-specific module
      const mod = await import('./bun');
      return mod.createBunRuntime(config);
    }

    case 'deno': {
      // Dynamic import - only executed in Deno runtime
      // @ts-ignore - Deno-specific module
      const mod = await import('./deno');
      return mod.createDenoRuntime(config);
    }

    default:
      throw new Error(`Unsupported runtime: ${detectedRuntime}`);
  }
}

// Re-export individual runtime creators for direct use
export async function createNodeRuntime(config: RuntimeConfig): Promise<RuntimeEnv> {
  const { createNodeRuntime: create } = await import('./node');
  return create(config);
}

export async function createBunRuntime(config: RuntimeConfig): Promise<RuntimeEnv> {
  // @ts-ignore - Bun-specific module
  const mod = await import('./bun');
  return mod.createBunRuntime(config);
}

export async function createDenoRuntime(config: RuntimeConfig): Promise<RuntimeEnv> {
  // @ts-ignore - Deno-specific module
  const mod = await import('./deno');
  return mod.createDenoRuntime(config);
}
