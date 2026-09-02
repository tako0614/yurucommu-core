/**
 * Cloudflare Workers Runtime Adapters
 *
 * These adapters wrap Cloudflare-specific APIs to conform to the runtime interfaces.
 */

import type {
  D1Database,
  Fetcher,
  KVNamespace,
  MessageBatch,
  Queue,
  R2Bucket,
} from "@cloudflare/workers-types";
import { getDb } from "../../db/index.ts";
import type {
  IKeyValueStore,
  ObjectStore,
  ObjectStoreBody,
  ObjectStoreObject,
  ObjectStorePutOptions,
  IStaticAssets,
} from "./types.ts";
import type {
  IQueueBatch,
  IQueueMessage,
  IQueueProducer,
  QueueBatchItem,
  QueueSendOptions,
} from "./queue.ts";

/**
 * Cloudflare R2 Storage Adapter
 */
class CloudflareStorage implements ObjectStore {
  constructor(private bucket: R2Bucket) {}

  async put(
    key: string,
    value: ObjectStoreBody,
    options?: ObjectStorePutOptions,
  ): Promise<void> {
    await this.bucket.put(key, value as Parameters<R2Bucket["put"]>[1], {
      httpMetadata:
        options?.contentType === undefined
          ? undefined
          : { contentType: options.contentType },
    });
  }

  async get(key: string): Promise<ObjectStoreObject | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;

    return {
      key,
      body: obj.body as unknown as ReadableStream,
      contentType: obj.httpMetadata?.contentType,
      // R2 spells the same validator twice: `etag` bare, `httpEtag` quoted.
      // This adapter has always handed the quoted one over as the port's
      // opaque `etag`, and that stays — narrowing a published field to R2's
      // bare spelling would silently change what every existing reader sees.
      // `httpEtag` names the header-safe form explicitly, which on this lane is
      // the same string.
      etag: obj.httpEtag,
      httpEtag: obj.httpEtag,
      byteLength: obj.size,
    };
  }

  async delete(key: string | readonly string[]): Promise<void> {
    await this.bucket.delete(
      typeof key === "string" ? key : ([...key] as string[]),
    );
  }
}

/**
 * Cloudflare KV Adapter
 */
class CloudflareKV implements IKeyValueStore {
  constructor(private kv: KVNamespace) {}

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
    const type = options?.type ?? "text";
    if (type === "json") return this.kv.get(key, { type: "json" });
    if (type === "arrayBuffer") {
      return this.kv.get(key, { type: "arrayBuffer" });
    }
    return this.kv.get(key, { type: "text" });
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
    await this.kv.put(key, value as Parameters<KVNamespace["put"]>[1], {
      expirationTtl: options?.expirationTtl,
      expiration: options?.expiration,
      metadata: options?.metadata,
    });
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
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
    const result = await this.kv.list(options);
    return {
      keys: result.keys,
      list_complete: result.list_complete,
      cursor: result.list_complete ? undefined : result.cursor,
    };
  }
}

/**
 * Cloudflare Static Assets Adapter
 */
class CloudflareAssets implements IStaticAssets {
  constructor(private assets: Fetcher) {}

  fetch(request: Request): Promise<Response> {
    return this.assets.fetch(request as never) as unknown as Promise<Response>;
  }
}

class CloudflareQueueProducer<T> implements IQueueProducer<T> {
  constructor(private readonly queue: Queue<T>) {}

  async send(body: T, options?: QueueSendOptions): Promise<void> {
    await this.queue.send(body, options);
  }

  async sendBatch(
    messages: readonly QueueBatchItem<T>[],
    options?: QueueSendOptions,
  ): Promise<void> {
    await this.queue.sendBatch([...messages], options);
  }
}

export function wrapCloudflareQueue<T>(queue: Queue<T>): IQueueProducer<T> {
  return new CloudflareQueueProducer(queue);
}

export function wrapCloudflareMessageBatch<T>(
  batch: MessageBatch<T>,
): IQueueBatch<T> {
  const messages: readonly IQueueMessage<T>[] = batch.messages.map(
    (message) => ({
      id: message.id,
      timestamp: message.timestamp,
      body: message.body,
      attempts: message.attempts,
      ack: () => message.ack(),
      retry: (options) => message.retry(options),
    }),
  );
  return {
    queue: batch.queue,
    messages,
    ackAll: () => batch.ackAll(),
    retryAll: (options) => batch.retryAll(options),
  };
}

/**
 * Wrap a native Cloudflare Workers binding env into the app's runtime
 * `Env` shape. The Hono app and all helper functions speak the runtime
 * `I*` contracts, so every binding flows through this adapter before
 * reaching app code. Pre-creates the drizzle wrapper as `DB_INSTANCE`.
 */
export function wrapCloudflareBindings<
  T extends {
    DB: D1Database;
    MEDIA?: R2Bucket;
    KV: KVNamespace;
    ASSETS?: Fetcher;
    DELIVERY_QUEUE?: Queue<unknown>;
    DELIVERY_DLQ?: Queue<unknown>;
  },
>(
  bindings: T,
): Omit<
  T,
  "DB" | "MEDIA" | "KV" | "ASSETS" | "DELIVERY_QUEUE" | "DELIVERY_DLQ"
> & {
  DB_INSTANCE: ReturnType<typeof getDb>;
  MEDIA?: ObjectStore;
  KV: IKeyValueStore;
  ASSETS?: IStaticAssets;
  DELIVERY_QUEUE?: IQueueProducer<unknown>;
  DELIVERY_DLQ?: IQueueProducer<unknown>;
} {
  const { DB, MEDIA, KV, ASSETS, DELIVERY_QUEUE, DELIVERY_DLQ, ...rest } =
    bindings;
  return {
    ...rest,
    DB_INSTANCE: getDb(DB),
    MEDIA: MEDIA ? new CloudflareStorage(MEDIA) : undefined,
    KV: new CloudflareKV(KV),
    ASSETS: ASSETS ? new CloudflareAssets(ASSETS) : undefined,
    DELIVERY_QUEUE: DELIVERY_QUEUE
      ? wrapCloudflareQueue(DELIVERY_QUEUE)
      : undefined,
    DELIVERY_DLQ: DELIVERY_DLQ ? wrapCloudflareQueue(DELIVERY_DLQ) : undefined,
  };
}
