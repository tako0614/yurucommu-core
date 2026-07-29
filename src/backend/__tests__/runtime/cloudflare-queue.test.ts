import { describe, expect, test } from "bun:test";
import type {
  D1Database,
  KVNamespace,
  MessageBatch,
  Queue,
} from "@cloudflare/workers-types";
import {
  wrapCloudflareBindings,
  wrapCloudflareMessageBatch,
  wrapCloudflareQueue,
} from "../../runtime/cloudflare.ts";

describe("Cloudflare queue runtime adapter", () => {
  test("forwards producer bodies and delay options through the neutral port", async () => {
    const calls: Array<{
      readonly kind: "send" | "batch";
      readonly value: unknown;
      readonly delaySeconds?: number;
    }> = [];
    const native = {
      send: async (body: unknown, options?: { delaySeconds?: number }) => {
        calls.push({
          kind: "send",
          value: body,
          delaySeconds: options?.delaySeconds,
        });
      },
      sendBatch: async (
        messages: readonly {
          readonly body: unknown;
          readonly delaySeconds?: number;
        }[],
        options?: { delaySeconds?: number },
      ) => {
        calls.push({
          kind: "batch",
          value: messages,
          delaySeconds: options?.delaySeconds,
        });
      },
    } as unknown as Queue<{ readonly id: string }>;

    const queue = wrapCloudflareQueue(native);
    await queue.send({ id: "one" }, { delaySeconds: 3 });
    await queue.sendBatch([{ body: { id: "two" }, delaySeconds: 5 }]);

    expect(calls).toEqual([
      { kind: "send", value: { id: "one" }, delaySeconds: 3 },
      {
        kind: "batch",
        value: [{ body: { id: "two" }, delaySeconds: 5 }],
        delaySeconds: undefined,
      },
    ]);
  });

  test("adapts consumer settlement without exposing the native batch", () => {
    const settled: string[] = [];
    const native = {
      queue: "delivery",
      messages: [
        {
          id: "message-1",
          timestamp: new Date("2026-07-29T00:00:00.000Z"),
          body: { id: "one" },
          attempts: 2,
          ack: () => settled.push("ack"),
          retry: (options?: { delaySeconds?: number }) =>
            settled.push(`retry:${options?.delaySeconds ?? 0}`),
        },
      ],
      ackAll: () => settled.push("ackAll"),
      retryAll: (options?: { delaySeconds?: number }) =>
        settled.push(`retryAll:${options?.delaySeconds ?? 0}`),
    } as unknown as MessageBatch<{ readonly id: string }>;

    const batch = wrapCloudflareMessageBatch(native);
    expect(batch.queue).toBe("delivery");
    expect(batch.messages[0]?.attempts).toBe(2);
    batch.messages[0]?.retry({ delaySeconds: 9 });
    batch.ackAll();
    batch.retryAll({ delaySeconds: 11 });

    expect(settled).toEqual(["retry:9", "ackAll", "retryAll:11"]);
  });

  test("the native binding wrapper adapts producers instead of leaking them", async () => {
    const sent: unknown[] = [];
    const deliveryQueue = {
      send: async (body: unknown) => {
        sent.push(body);
      },
      sendBatch: async () => undefined,
    } as unknown as Queue<unknown>;
    const env = wrapCloudflareBindings({
      DB: {} as D1Database,
      KV: {} as KVNamespace,
      DELIVERY_QUEUE: deliveryQueue,
    });

    expect(env.DELIVERY_QUEUE).not.toBe(deliveryQueue);
    await env.DELIVERY_QUEUE?.send({ type: "delivery" });
    expect(sent).toEqual([{ type: "delivery" }]);
  });
});
