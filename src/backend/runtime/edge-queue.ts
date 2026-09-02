/**
 * `edge.queue@1.0.0` → {@link IQueueProducer} / {@link IQueueBatch}.
 *
 * Two differences from Cloudflare Queues, both of which would otherwise be
 * discovered in production:
 *
 *  - BODIES ARE BYTES. `queue.send(object)` works on Cloudflare because the
 *    runtime structured-clones the value. The facade runs the body through a
 *    bytes projection and rejects anything that is not a string, ArrayBuffer,
 *    or view, so a delivery message has to be serialized. JSON is the encoding
 *    on both ends, and the consumer side undoes it.
 *  - THE CONSUMER BATCH IS A DIFFERENT OBJECT. It is `acknowledge` /
 *    `acknowledgeAll` / `timestampMillis`, not `ack` / `ackAll` / `timestamp`,
 *    and the body arrives as `{encoding:"base64", data}`. `retry` also refuses
 *    `delaySeconds: 0`, which Cloudflare accepts as "no delay".
 *
 * AVAILABILITY: both wrapper backends project queue bindings (see takoserver
 * `selfhost-worker-wrapper.ts` `projectEnv`, whose data-binding kinds are
 * `edge.kv`, `edge.objects`, `edge.queue` and `edge.sql`). What leaves
 * `DELIVERY_QUEUE` unbound is a Version that declared no queue, and the core's
 * existing behaviour for that — synchronous fallback delivery, reported by the
 * readiness surface — is what applies then.
 */

import {
  EDGE_QUEUE_MAX_MESSAGES,
  decodeEdgeBytes,
  type EdgeQueueBatch,
  type EdgeQueueBinding,
} from "./edge-facades.ts";
import type {
  IQueueBatch,
  IQueueMessage,
  IQueueProducer,
  QueueBatchItem,
  QueueSendOptions,
} from "./queue.ts";

/** A message cannot be carried over the facade. */
export class EdgeQueueShapeError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeQueueShapeError";
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBody(body: unknown): Uint8Array {
  let json: string;
  try {
    json = JSON.stringify(body);
  } catch (error) {
    throw new EdgeQueueShapeError(
      `edge.queue: the message body is not JSON-serializable: ${String(error)}`,
    );
  }
  if (json === undefined) {
    throw new EdgeQueueShapeError(
      "edge.queue: the message body serialized to nothing",
    );
  }
  return encoder.encode(json);
}

/**
 * The facade takes `delaySeconds` only as a positive whole number; Cloudflare's
 * `0` means the same as omitting it, so it is omitted.
 */
function delayOption(
  delaySeconds: number | undefined,
): { delaySeconds: number } | Record<string, never> {
  if (delaySeconds === undefined || delaySeconds <= 0) return {};
  return { delaySeconds: Math.ceil(delaySeconds) };
}

class EdgeQueueProducer<T> implements IQueueProducer<T> {
  constructor(private readonly queue: EdgeQueueBinding) {}

  async send(body: T, options?: QueueSendOptions): Promise<void> {
    await this.queue.send(encodeBody(body), delayOption(options?.delaySeconds));
  }

  async sendBatch(
    messages: readonly QueueBatchItem<T>[],
    options?: QueueSendOptions,
  ): Promise<void> {
    if (messages.length === 0) return;
    if (messages.length > EDGE_QUEUE_MAX_MESSAGES) {
      throw new EdgeQueueShapeError(
        `edge.queue: ${messages.length} messages exceed the facade limit of ` +
          `${EDGE_QUEUE_MAX_MESSAGES}`,
      );
    }
    // `sendBatch` takes no batch-wide options, so a shared default delay is
    // pushed down onto each message that did not set its own.
    await this.queue.sendBatch(
      messages.map(({ body, delaySeconds }) => ({
        body: encodeBody(body),
        ...delayOption(delaySeconds ?? options?.delaySeconds),
      })),
    );
  }
}

export function wrapEdgeQueue<T>(queue: EdgeQueueBinding): IQueueProducer<T> {
  return new EdgeQueueProducer<T>(queue);
}

/**
 * Adapt one consumer batch. The body is decoded with the same JSON encoding
 * {@link wrapEdgeQueue} writes, so a producer and consumer on this lane agree
 * even though the Host only ever sees opaque bytes.
 */
export function wrapEdgeMessageBatch<T>(batch: EdgeQueueBatch): IQueueBatch<T> {
  const messages: readonly IQueueMessage<T>[] = batch.messages.map(
    (message) => ({
      id: message.id,
      timestamp: new Date(message.timestampMillis),
      body: JSON.parse(decoder.decode(decodeEdgeBytes(message.body))) as T,
      attempts: message.attempts,
      ack: () => message.acknowledge(),
      // The facade rejects `delaySeconds: 0` on a retry; omitting it is the
      // same request.
      retry: (options) => message.retry(delayOption(options?.delaySeconds)),
    }),
  );
  return {
    queue: batch.queue,
    messages,
    ackAll: () => batch.acknowledgeAll(),
    retryAll: (options) => batch.retryAll(delayOption(options?.delaySeconds)),
  };
}
