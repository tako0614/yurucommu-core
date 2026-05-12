/**
 * KVNamespace-compatible in-memory implementation
 *
 * Implements the runtime `IKeyValueStore` contract using an in-memory
 * Map. The nominal Cloudflare `KVNamespace` is reached through
 * `runtime/cloudflare-binding.ts#toCloudflareBindings`.
 */

import { drainStream } from "./node-modules.ts";
import type { IKeyValueStore } from "../types.ts";

interface KVEntry {
  value: string | ArrayBuffer;
  expiration?: number;
  metadata?: unknown;
}

async function readStreamAsArrayBuffer(
  stream: ReadableStream,
): Promise<ArrayBuffer> {
  const drained = await drainStream(stream as ReadableStream<Uint8Array>);
  return drained.buffer as ArrayBuffer;
}

export class KVCompatNamespace implements IKeyValueStore {
  private store = new Map<string, KVEntry>();

  private getEntry(key: string): KVEntry | null {
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

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get<T = unknown>(
    key: string,
    options: { type: "json" },
  ): Promise<T | null>;
  get(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<ArrayBuffer | null>;
  async get(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" },
  ): Promise<string | ArrayBuffer | unknown | null> {
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
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    let storedValue: string | ArrayBuffer;
    if (typeof value === "string" || value instanceof ArrayBuffer) {
      storedValue = value;
    } else {
      storedValue = await readStreamAsArrayBuffer(value);
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
