import type {
  D1Database as CloudflareD1Database,
  ExecutionContext as CloudflareExecutionContext,
  Fetcher as CloudflareFetcher,
  KVNamespace as CloudflareKVNamespace,
  MessageBatch as CloudflareMessageBatch,
  Queue as CloudflareQueue,
  R2Bucket as CloudflareR2Bucket,
} from "@cloudflare/workers-types";

declare global {
  type D1Database = CloudflareD1Database;
  type ExecutionContext = CloudflareExecutionContext;
  type Fetcher = CloudflareFetcher;
  type KVNamespace = CloudflareKVNamespace;
  type MessageBatch<T = unknown> = CloudflareMessageBatch<T>;
  type Queue<T = unknown> = CloudflareQueue<T>;
  type R2Bucket = CloudflareR2Bucket;
}

export {};
