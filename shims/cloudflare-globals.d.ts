import type {
  D1Database as CloudflareD1Database,
  DurableObjectNamespace as CloudflareDurableObjectNamespace,
  DurableObjectStub as CloudflareDurableObjectStub,
  ExecutionContext as CloudflareExecutionContext,
  Fetcher as CloudflareFetcher,
  KVNamespace as CloudflareKVNamespace,
  MessageBatch as CloudflareMessageBatch,
  Queue as CloudflareQueue,
  R2Bucket as CloudflareR2Bucket,
} from "@cloudflare/workers-types";

declare global {
  type D1Database = CloudflareD1Database;
  // Signaling hub binding (call feature). DO-internal APIs (Hibernatable
  // WebSockets, alarms) are typed file-locally in the DO implementation to stay
  // decoupled from workers-types version drift; only the namespace/stub handles
  // that flow through Env need to be global here.
  type DurableObjectNamespace = CloudflareDurableObjectNamespace;
  type DurableObjectStub = CloudflareDurableObjectStub;
  type ExecutionContext = CloudflareExecutionContext;
  type Fetcher = CloudflareFetcher;
  type KVNamespace = CloudflareKVNamespace;
  type MessageBatch<T = unknown> = CloudflareMessageBatch<T>;
  type Queue<T = unknown> = CloudflareQueue<T>;
  type R2Bucket = CloudflareR2Bucket;
}

export {};
