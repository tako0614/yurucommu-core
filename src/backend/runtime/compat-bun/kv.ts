// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Cloudflare Compatibility Layer - KV Namespace
 */

import { drainStream, resolveExpiration } from './utils.ts';

/**
 * KVNamespace-compatible in-memory implementation
 */
export class KVCompatNamespace {
  private store = new Map<string, {
    value: string | ArrayBuffer;
    expiration?: number;
    metadata?: unknown;
  }>();

  private getValid(key: string): { value: string | ArrayBuffer; metadata?: unknown } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && entry.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  async get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<unknown> {
    const entry = this.getValid(key);
    if (!entry) return null;

    const type = options?.type ?? 'text';
    const value = entry.value;

    if (type === 'json') {
      return typeof value === 'string' ? JSON.parse(value) : JSON.parse(new TextDecoder().decode(value as ArrayBuffer));
    }
    if (type === 'arrayBuffer') {
      return typeof value === 'string' ? new TextEncoder().encode(value).buffer : value;
    }
    return typeof value === 'string' ? value : new TextDecoder().decode(value as ArrayBuffer);
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: unknown;
    }
  ): Promise<void> {
    let storedValue: string | ArrayBuffer;
    if (typeof value === 'string') {
      storedValue = value;
    } else if (value instanceof ArrayBuffer) {
      storedValue = value;
    } else {
      storedValue = (await drainStream(value)).buffer;
    }

    this.store.set(key, {
      value: storedValue,
      expiration: resolveExpiration(options),
      metadata: options?.metadata,
    });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
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
    const keys: Array<{ name: string; expiration?: number; metadata?: unknown }> = [];
    const now = Date.now() / 1000;

    for (const [name, entry] of this.store.entries()) {
      if (entry.expiration && entry.expiration < now) continue;
      if (options?.prefix && !name.startsWith(options.prefix)) continue;
      keys.push({ name, expiration: entry.expiration, metadata: entry.metadata });
    }

    const limit = options?.limit ?? 1000;
    return {
      keys: keys.slice(0, limit),
      list_complete: keys.length <= limit,
      cursor: keys.length > limit ? String(limit) : undefined,
    };
  }
}
