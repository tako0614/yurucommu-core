import { describe, expect, test } from "bun:test";

import {
  EdgeQueueShapeError,
  wrapEdgeMessageBatch,
  wrapEdgeQueue,
} from "../../runtime/edge-queue.ts";
import {
  encodeEdgeBytes,
  type EdgeQueueBatch,
  type EdgeQueueBatchItem,
  type EdgeQueueBinding,
  type EdgeQueueMessage,
} from "../../runtime/edge-facades.ts";

const decoder = new TextDecoder();

function bodyText(value: string | ArrayBuffer | ArrayBufferView): string {
  if (typeof value === "string") return value;
  if (value instanceof ArrayBuffer) return decoder.decode(value);
  return decoder.decode(value as Uint8Array);
}

function createFakeEdgeQueue(): EdgeQueueBinding & {
  readonly sent: {
    body: string;
    options?: { delaySeconds?: number };
  }[];
  readonly batches: EdgeQueueBatchItem[][];
} {
  const sent: { body: string; options?: { delaySeconds?: number } }[] = [];
  const batches: EdgeQueueBatchItem[][] = [];
  return {
    sent,
    batches,
    send: async (body, options) => {
      // The Host rejects anything that is not bytes, so prove the adapter never
      // hands it a live object.
      if (typeof body === "object" && !(body instanceof ArrayBuffer)) {
        if (!ArrayBuffer.isView(body)) {
          const error = new Error("invalid_body");
          error.name = "invalid_body";
          throw error;
        }
      }
      sent.push({ body: bodyText(body), options });
      return "acceptance-1";
    },
    sendBatch: async (messages) => {
      batches.push([...messages]);
      return messages.map((_, index) => `acceptance-${index}`);
    },
  };
}

function facadeMessage(
  id: string,
  body: unknown,
  settled: string[],
): EdgeQueueMessage {
  return {
    id,
    timestampMillis: 1_700_000_000_000,
    attempts: 1,
    body: encodeEdgeBytes(new TextEncoder().encode(JSON.stringify(body))),
    acknowledge: () => settled.push(`ack:${id}`),
    retry: (options) =>
      settled.push(`retry:${id}:${JSON.stringify(options ?? {})}`),
  };
}

describe("edge.queue producer", () => {
  test("serializes a body the facade would otherwise refuse", async () => {
    const facade = createFakeEdgeQueue();
    const queue = wrapEdgeQueue<{ readonly to: string }>(facade);
    await queue.send({ to: "https://remote.example/inbox" });
    expect(facade.sent).toEqual([
      {
        body: JSON.stringify({ to: "https://remote.example/inbox" }),
        options: {},
      },
    ]);
  });

  test("sends a positive delay and omits a zero one", async () => {
    const facade = createFakeEdgeQueue();
    const queue = wrapEdgeQueue<number>(facade);
    await queue.send(1, { delaySeconds: 30 });
    await queue.send(2, { delaySeconds: 0 });
    await queue.send(3);
    expect(facade.sent.map((entry) => entry.options)).toEqual([
      { delaySeconds: 30 },
      {},
      {},
    ]);
  });

  test("pushes a batch-wide delay onto each message the facade sees", async () => {
    // `sendBatch` has no batch-level options slot, so a shared default has to
    // become a per-message one or it would be silently dropped.
    const facade = createFakeEdgeQueue();
    const queue = wrapEdgeQueue<string>(facade);
    await queue.sendBatch([{ body: "a" }, { body: "b", delaySeconds: 5 }], {
      delaySeconds: 60,
    });
    expect(
      facade.batches[0]!.map((item) => ({
        body: bodyText(item.body),
        delaySeconds: item.delaySeconds,
      })),
    ).toEqual([
      { body: '"a"', delaySeconds: 60 },
      { body: '"b"', delaySeconds: 5 },
    ]);
  });

  test("does not call the Host for an empty batch", async () => {
    const facade = createFakeEdgeQueue();
    await wrapEdgeQueue<string>(facade).sendBatch([]);
    expect(facade.batches).toHaveLength(0);
  });

  test("refuses a batch larger than the facade carries", async () => {
    const facade = createFakeEdgeQueue();
    const queue = wrapEdgeQueue<number>(facade);
    await expect(
      queue.sendBatch(Array.from({ length: 101 }, (_, i) => ({ body: i }))),
    ).rejects.toThrow(EdgeQueueShapeError);
  });

  test("refuses a body that cannot be serialized", async () => {
    const facade = createFakeEdgeQueue();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(wrapEdgeQueue<unknown>(facade).send(cyclic)).rejects.toThrow(
      EdgeQueueShapeError,
    );
  });
});

describe("edge.queue consumer batch", () => {
  test("decodes bodies and maps the settle vocabulary", async () => {
    const settled: string[] = [];
    const facadeBatch: EdgeQueueBatch = {
      batchId: "batch-1",
      queue: "yurucommu-delivery",
      messages: [
        facadeMessage("m1", { activity: "Follow" }, settled),
        facadeMessage("m2", { activity: "Like" }, settled),
      ],
      acknowledgeAll: () => settled.push("ackAll"),
      retryAll: (options) =>
        settled.push(`retryAll:${JSON.stringify(options ?? {})}`),
    };

    const batch = wrapEdgeMessageBatch<{ activity: string }>(facadeBatch);
    expect(batch.queue).toBe("yurucommu-delivery");
    expect(batch.messages.map((message) => message.body)).toEqual([
      { activity: "Follow" },
      { activity: "Like" },
    ]);
    expect(batch.messages[0]!.timestamp).toEqual(new Date(1_700_000_000_000));
    expect(batch.messages[0]!.attempts).toBe(1);

    batch.messages[0]!.ack();
    batch.messages[1]!.retry({ delaySeconds: 120 });
    batch.ackAll();
    batch.retryAll({ delaySeconds: 30 });
    expect(settled).toEqual([
      "ack:m1",
      'retry:m2:{"delaySeconds":120}',
      "ackAll",
      'retryAll:{"delaySeconds":30}',
    ]);
  });

  test("omits a zero retry delay the facade would reject", async () => {
    const settled: string[] = [];
    const facadeBatch: EdgeQueueBatch = {
      batchId: "batch-2",
      queue: "q",
      messages: [facadeMessage("m1", 1, settled)],
      acknowledgeAll: () => settled.push("ackAll"),
      retryAll: (options) =>
        settled.push(`retryAll:${JSON.stringify(options ?? {})}`),
    };
    const batch = wrapEdgeMessageBatch<number>(facadeBatch);
    batch.messages[0]!.retry({ delaySeconds: 0 });
    batch.retryAll();
    expect(settled).toEqual(["retry:m1:{}", "retryAll:{}"]);
  });

  test("round-trips a body between the producer and the consumer", async () => {
    const facade = createFakeEdgeQueue();
    const payload = { to: "https://remote.example/inbox", attempt: 2 };
    await wrapEdgeQueue<typeof payload>(facade).send(payload);

    const settled: string[] = [];
    const wire = new TextEncoder().encode(facade.sent[0]!.body);
    const batch = wrapEdgeMessageBatch<typeof payload>({
      batchId: "b",
      queue: "q",
      messages: [
        {
          id: "m",
          timestampMillis: 0,
          attempts: 1,
          body: encodeEdgeBytes(wire),
          acknowledge: () => settled.push("ack"),
          retry: () => settled.push("retry"),
        },
      ],
      acknowledgeAll: () => {},
      retryAll: () => {},
    });
    expect(batch.messages[0]!.body).toEqual(payload);
  });
});
