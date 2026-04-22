import type { IKeyValueStore } from "./types.ts";
import {
  DEFAULT_LIST_LIMIT,
  nowSeconds,
  paginateList,
  readStream,
  resolveExpiration,
} from "./shared.ts";

export class MemoryKV implements IKeyValueStore {
  private store = new Map<
    string,
    { value: string; expiration?: number; metadata?: Record<string, unknown> }
  >();

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: "json" }): Promise<T | null>;
  get(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<ArrayBuffer | null>;
  async get(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" },
  ): Promise<string | ArrayBuffer | unknown | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (entry.expiration && entry.expiration < nowSeconds()) {
      this.store.delete(key);
      return null;
    }

    const type = options?.type ?? "text";
    if (type === "json") return JSON.parse(entry.value);
    if (type === "arrayBuffer") {
      return new TextEncoder().encode(entry.value).buffer;
    }
    return entry.value;
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
    let strValue: string;
    if (typeof value === "string") {
      strValue = value;
    } else if (value instanceof ArrayBuffer) {
      strValue = new TextDecoder().decode(value);
    } else {
      strValue = new TextDecoder().decode(await readStream(value));
    }

    this.store.set(key, {
      value: strValue,
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
    const keys: Array<{
      name: string;
      expiration?: number;
      metadata?: unknown;
    }> = [];
    const now = nowSeconds();

    for (const [name, entry] of this.store.entries()) {
      if (entry.expiration && entry.expiration < now) continue;
      if (options?.prefix && !name.startsWith(options.prefix)) continue;

      keys.push({
        name,
        expiration: entry.expiration,
        metadata: entry.metadata,
      });
    }

    const { items, complete, cursor } = paginateList(
      keys,
      options?.limit ?? DEFAULT_LIST_LIMIT,
    );
    return { keys: items, list_complete: complete, cursor };
  }
}
