/**
 * Runtime-neutral queue ports used by the application.
 *
 * These deliberately model only the semantics Yurucommu uses. A runtime may
 * back them with Cloudflare Queues, a local scheduler, or a host gateway, but
 * app code never receives a provider-native queue object.
 */

export interface QueueSendOptions {
  readonly delaySeconds?: number;
}

export interface QueueBatchItem<T> {
  readonly body: T;
  readonly delaySeconds?: number;
}

export interface IQueueProducer<T> {
  send(body: T, options?: QueueSendOptions): Promise<void>;
  sendBatch(
    messages: readonly QueueBatchItem<T>[],
    options?: QueueSendOptions,
  ): Promise<void>;
}

export interface IQueueMessage<T> {
  readonly id: string;
  readonly timestamp: Date;
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(options?: QueueSendOptions): void;
}

export interface IQueueBatch<T> {
  readonly queue: string;
  readonly messages: readonly IQueueMessage<T>[];
  ackAll(): void;
  retryAll(options?: QueueSendOptions): void;
}
