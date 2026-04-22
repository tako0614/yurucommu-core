/**
 * KVNamespace-compatible in-memory implementation
 *
 * Provides KVCompatNamespace class that implements the same interface
 * as Cloudflare Workers KV.
 */

import { drainStream } from "./node-modules.ts";

/**
 * KVNamespace-compatible in-memory implementation
 */
export class KVCompatNamespace {
  private store = new Map<string, {
    value: string | ArrayBuffer;
    expiration?: number;
    metadata?: unknown;
  }>();

  private getEntry(
    key: string,
  ): { value: string | ArrayBuffer; metadata?: unknown } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiration && entry.expiration < Date.now() / 1000) {
      this.store.delete(key);
      return null;
    }
    return entry;
  }

  private decodeAsText(value: string | ArrayBuffer): string {
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }

  async get(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" | "stream" },
  ): Promise<unknown> {
    const entry = this.getEntry(key);
    if (!entry) return null;

    const type = options?.type ?? "text";
    if (type === "json") return JSON.parse(this.decodeAsText(entry.value));
    if (type === "arrayBuffer") {
      return typeof entry.value === "string"
        ? new TextEncoder().encode(entry.value).buffer
        : entry.value;
    }
    return this.decodeAsText(entry.value);
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: unknown;
    },
  ): Promise<void> {
    let storedValue: string | ArrayBuffer;
    if (typeof value === "string" || value instanceof ArrayBuffer) {
      storedValue = value;
    } else {
      storedValue = (await drainStream(value as ReadableStream<Uint8Array>))
        .buffer as ArrayBuffer;
    }

    let expiration: number | undefined;
    if (options?.expiration) {
      expiration = options.expiration;
    } else if (options?.expirationTtl) {
      expiration = Math.floor(Date.now() / 1000) + options.expirationTtl;
    }

    this.store.set(key, {
      value: storedValue,
      expiration,
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
    const keys: Array<
      { name: string; expiration?: number; metadata?: unknown }
    > = [];
    const now = Date.now() / 1000;

    for (const [name, entry] of this.store.entries()) {
      if (entry.expiration && entry.expiration < now) continue;
      if (options?.prefix && !name.startsWith(options.prefix)) continue;
      keys.push({
        name,
        expiration: entry.expiration,
        metadata: entry.metadata,
      });
    }

    const limit = options?.limit ?? 1000;
    return {
      keys: keys.slice(0, limit),
      list_complete: keys.length <= limit,
      cursor: keys.length > limit ? String(limit) : undefined,
    };
  }
}
