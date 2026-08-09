import { expect, test } from "bun:test";

import {
  handleDeliveryDlqBatch,
  MAX_AUTO_DLQ_REDRIVES,
} from "../../lib/delivery/queue.ts";
import {
  isDeliveryQueueMessageV1,
  type DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";

const ISO = "2026-08-09T00:00:00.000Z";

function rawMessages(): DeliveryQueueMessageV1[] {
  return [
    {
      version: 1,
      type: "fanout_followers",
      activityId: "activity-followers",
      followeeApId: "https://yuru.test/ap/users/alice",
      cursor: "https://remote.example/users/follower-20000",
      scheduledAt: ISO,
    },
    {
      version: 1,
      type: "fanout_community",
      activityId: "activity-community",
      communityApId: "https://yuru.test/ap/groups/community",
      announceActivityId: "activity-community-announce",
      stage: "remote_followers",
      cursor: "https://remote.example/users/member-20000",
      scheduledAt: ISO,
    },
    {
      version: 1,
      type: "resolve_actor",
      activityId: "activity-resolve",
      recipientActorApId: "https://remote.example/users/bob",
      attempts: 4,
      scheduledAt: ISO,
    },
    {
      version: 1,
      type: "deliver_endpoint",
      jobId: "delivery-job",
      reconcileAttempt: 2,
      scheduledAt: ISO,
    },
    {
      version: 1,
      type: "reconcile_job",
      jobId: "reconcile-job",
      reconcileAttempt: 3,
      scheduledAt: ISO,
    },
  ];
}

function semanticPosition(body: DeliveryQueueMessageV1) {
  const autoDlqAttempt = (body as { autoDlqAttempt?: number }).autoDlqAttempt;
  switch (body.type) {
    case "fanout_followers":
      return { type: body.type, cursor: body.cursor, autoDlqAttempt };
    case "fanout_community":
      return {
        type: body.type,
        stage: body.stage,
        cursor: body.cursor,
        autoDlqAttempt,
      };
    case "resolve_actor":
      return { type: body.type, attempts: body.attempts, autoDlqAttempt };
    case "deliver_endpoint":
    case "reconcile_job":
      return {
        type: body.type,
        reconcileAttempt: body.reconcileAttempt,
        autoDlqAttempt,
      };
    case "notification_push":
      return { type: body.type, autoDlqAttempt };
  }
}

test("raw auto-dead-lettered delivery work is redriven without losing its progress", async () => {
  const sent: Array<{
    body: DeliveryQueueMessageV1;
    delaySeconds: number;
  }> = [];
  const queue = {
    send: async (
      body: DeliveryQueueMessageV1,
      options?: { delaySeconds?: number },
    ) => {
      sent.push({ body, delaySeconds: options?.delaySeconds ?? 0 });
    },
    sendBatch: async () => {},
  };
  const acknowledgements: string[] = [];
  const retryDelays: number[] = [];
  const bodies = rawMessages();

  await handleDeliveryDlqBatch(
    {
      messages: bodies.map((body) => ({
        body,
        id: body.type,
        timestamp: new Date(0),
        attempts: 1,
        ack: () => acknowledgements.push(body.type),
        retry: (options?: { delaySeconds?: number }) => {
          retryDelays.push(options?.delaySeconds ?? 0);
        },
      })),
      queue: "dlq",
      ackAll() {},
      retryAll() {},
    } as never,
    {
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as never,
  );

  expect(acknowledgements).toEqual(bodies.map((body) => body.type));
  expect(retryDelays).toEqual([]);
  expect(
    sent.map(({ body, delaySeconds }) => ({
      ...semanticPosition(body),
      delaySeconds,
    })),
  ).toEqual([
    {
      type: "fanout_followers",
      cursor: "https://remote.example/users/follower-20000",
      autoDlqAttempt: 1,
      delaySeconds: 60,
    },
    {
      type: "fanout_community",
      stage: "remote_followers",
      cursor: "https://remote.example/users/member-20000",
      autoDlqAttempt: 1,
      delaySeconds: 60,
    },
    {
      type: "resolve_actor",
      attempts: 4,
      autoDlqAttempt: 1,
      delaySeconds: 60,
    },
    {
      type: "deliver_endpoint",
      reconcileAttempt: 2,
      autoDlqAttempt: 1,
      delaySeconds: 60,
    },
    {
      type: "reconcile_job",
      reconcileAttempt: 3,
      autoDlqAttempt: 1,
      delaySeconds: 60,
    },
  ]);
});

test("raw auto-DLQ redrive stops at its explicit generation cap", async () => {
  const sent: DeliveryQueueMessageV1[] = [];
  const queue = {
    send: async (body: DeliveryQueueMessageV1) => {
      sent.push(body);
    },
    sendBatch: async () => {},
  };
  const acknowledgements: string[] = [];
  const retryDelays: number[] = [];
  const bodies = rawMessages().map(
    (body) =>
      ({
        ...body,
        autoDlqAttempt: MAX_AUTO_DLQ_REDRIVES,
      }) as DeliveryQueueMessageV1,
  );

  await handleDeliveryDlqBatch(
    {
      messages: bodies.map((body) => ({
        body,
        id: body.type,
        timestamp: new Date(0),
        attempts: 1,
        ack: () => acknowledgements.push(body.type),
        retry: (options?: { delaySeconds?: number }) => {
          retryDelays.push(options?.delaySeconds ?? 0);
        },
      })),
      queue: "dlq",
      ackAll() {},
      retryAll() {},
    } as never,
    {
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as never,
  );

  expect(sent).toEqual([]);
  expect(retryDelays).toEqual([]);
  expect(acknowledgements).toEqual(bodies.map((body) => body.type));
});

test("a failed raw redrive keeps the DLQ message alive", async () => {
  const queue = {
    send: async () => {
      throw new Error("simulated main queue outage");
    },
    sendBatch: async () => {},
  };
  let acknowledgements = 0;
  const retryDelays: number[] = [];
  const body = rawMessages()[0];

  await handleDeliveryDlqBatch(
    {
      messages: [
        {
          body,
          id: body.type,
          timestamp: new Date(0),
          attempts: 1,
          ack: () => {
            acknowledgements += 1;
          },
          retry: (options?: { delaySeconds?: number }) => {
            retryDelays.push(options?.delaySeconds ?? 0);
          },
        },
      ],
      queue: "dlq",
      ackAll() {},
      retryAll() {},
    } as never,
    {
      DELIVERY_QUEUE: queue,
      DELIVERY_DLQ: queue,
    } as never,
  );

  expect(acknowledgements).toBe(0);
  expect(retryDelays).toEqual([60]);
});

test("missing MAIN queue binding keeps raw and structured DLQ messages alive", async () => {
  const acknowledgements: string[] = [];
  const retryDelays: Array<{ id: string; delaySeconds: number }> = [];
  const rawBody = rawMessages()[0];
  const structuredBody = {
    version: 1,
    type: "dlq",
    jobId: "structured-without-main",
    activityId: "activity-without-main",
    endpoint: "https://remote.example/inbox",
    attempts: 8,
    lastError: "HTTP 503",
    reconcileAttempt: 0,
    deadLetteredAt: ISO,
  } as const;

  await handleDeliveryDlqBatch(
    {
      messages: [
        { id: "raw", body: rawBody },
        { id: "structured", body: structuredBody },
      ].map(({ id, body }) => ({
        body,
        id,
        timestamp: new Date(0),
        attempts: 1,
        ack: () => acknowledgements.push(id),
        retry: (options?: { delaySeconds?: number }) => {
          retryDelays.push({ id, delaySeconds: options?.delaySeconds ?? 0 });
        },
      })),
      queue: "dlq",
      ackAll() {},
      retryAll() {},
    } as never,
    {
      // Receiving on the DLQ proves that binding exists, but the MAIN producer
      // can still be absent from a drifted deployment.
      DELIVERY_DLQ: { async send() {}, async sendBatch() {} },
    } as never,
  );

  expect(acknowledgements).toEqual([]);
  expect(retryDelays).toEqual([
    { id: "raw", delaySeconds: 60 },
    { id: "structured", delaySeconds: 60 },
  ]);
});

test("delivery message validation accepts only non-negative integer auto-DLQ generations", () => {
  const body = rawMessages()[0];
  expect(isDeliveryQueueMessageV1(body)).toBe(true);
  expect(
    isDeliveryQueueMessageV1({
      ...body,
      autoDlqAttempt: MAX_AUTO_DLQ_REDRIVES,
    }),
  ).toBe(true);
  expect(isDeliveryQueueMessageV1({ ...body, autoDlqAttempt: -1 })).toBe(false);
  expect(isDeliveryQueueMessageV1({ ...body, autoDlqAttempt: 1.5 })).toBe(
    false,
  );
  expect(isDeliveryQueueMessageV1({ ...body, autoDlqAttempt: "1" })).toBe(
    false,
  );
});
