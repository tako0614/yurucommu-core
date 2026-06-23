/**
 * Core queue management - message builders, public enqueue entry points,
 * and the batch handler that dispatches to sub-modules.
 */

import type { Message, MessageBatch, Queue } from "@cloudflare/workers-types";
import type { Env } from "../../types.ts";
import type { Database } from "../../../db/index.ts";
import { and, eq, notInArray, or, sql } from "drizzle-orm";
import { actorCache, deliveryQueue } from "../../../db/index.ts";
import { isSafeRemoteUrl } from "../../federation-helpers.ts";
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryDeliverEndpointMessageV1,
  type DeliveryDlqMessageV1,
  type DeliveryQueueMessageV1,
  isDeliveryDlqMessageV1,
  isDeliveryQueueMessageV1,
} from "./types.ts";
import { computeDeliveryJobId, safeEndpointHost } from "./transformers.ts";
import { emitMetric } from "./metrics.ts";
import { logger } from "../logger.ts";
import { filterBlockedActorApIds, isActorBlocked } from "../blocklist.ts";

const log = logger.child({ component: "delivery.queue" });

// Without DELIVERY_QUEUE/DELIVERY_DLQ bindings, enqueued activities persist in
// the DB but never federate. That used to be a silent no-op; surface it as a
// structured error/metric on first occurrence so it is observable. Reset only
// once a successful enqueue happens again (so a later misconfiguration re-fires).
let producerUnavailableReported = false;

function reportProducerUnavailable(op: string): void {
  if (producerUnavailableReported) return;
  producerUnavailableReported = true;
  log.error("Delivery queue producer unavailable; activity will not federate", {
    event: "delivery.queue.producer_unavailable",
    op,
  });
  emitMetric("delivery.queue.producer_unavailable", 1, { op });
}

function assertNever(x: never): never {
  throw new Error(
    `Unhandled delivery queue message type: ${JSON.stringify(x)}`,
  );
}

// ---------------------------------------------------------------------------
// Concurrency primitives
// ---------------------------------------------------------------------------

const BULKHEAD_PER_DOMAIN = 3;
const BULKHEAD_GLOBAL_CONCURRENCY = 10;

class Semaphore {
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(limit: number) {
    this.available = limit;
  }

  async acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.available -= 1;
  }

  release(): void {
    this.available += 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

export class Bulkhead {
  private global: Semaphore;
  private perHost = new Map<string, Semaphore>();

  constructor(globalLimit: number, perHostLimit: number) {
    this.global = new Semaphore(globalLimit);
    this.perHostLimit = perHostLimit;
  }

  private perHostLimit: number;

  async acquire(host: string): Promise<void> {
    await this.global.acquire();
    let sem = this.perHost.get(host);
    if (!sem) {
      sem = new Semaphore(this.perHostLimit);
      this.perHost.set(host, sem);
    }
    await sem.acquire();
  }

  release(host: string): void {
    const sem = this.perHost.get(host);
    if (sem) sem.release();
    this.global.release();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

export type QueueEnv = Env & {
  DELIVERY_QUEUE: Queue<DeliveryQueueMessageV1>;
  DELIVERY_DLQ: Queue<DeliveryDlqMessageV1>;
};

function queueAvailable(env: Env): env is QueueEnv {
  return Boolean(env.DELIVERY_QUEUE) && Boolean(env.DELIVERY_DLQ);
}

export function requireQueue(
  env: Env,
  label: string,
  message: Message<DeliveryQueueMessageV1>,
): env is QueueEnv {
  if (queueAvailable(env)) return true;
  log.warn("Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings; dropping job", {
    event: "delivery.queue.bindings_missing",
    label,
  });
  message.ack();
  return false;
}

// ---------------------------------------------------------------------------
// Queue message builders & senders
// ---------------------------------------------------------------------------

export async function sendQueueMessage(
  env: Env,
  body: DeliveryQueueMessageV1,
  delaySeconds?: number,
): Promise<void> {
  if (!queueAvailable(env)) {
    reportProducerUnavailable("sendQueueMessage");
    return;
  }
  producerUnavailableReported = false;
  await env.DELIVERY_QUEUE.send(
    body,
    delaySeconds ? { delaySeconds } : undefined,
  );
}

export async function sendDlqMessage(
  env: Env,
  payload: DeliveryDlqMessageV1,
): Promise<void> {
  if (!queueAvailable(env)) {
    reportProducerUnavailable("sendDlqMessage");
    return;
  }
  producerUnavailableReported = false;
  await env.DELIVERY_DLQ.send(payload);
}

// Maximum reconcile cycles before a dead-lettered job is left terminally
// dead_letter. Each cycle revives the job (6h apart) for one more full retry
// series, so this bounds a permanently-dead endpoint instead of churning the
// queue forever. Exported so the DLQ consumer (handleDeliveryDlqBatch) and the
// reconcile worker (processReconcileJob) share one source of truth.
export const MAX_RECONCILE_ATTEMPTS = 5;

export function buildDeliverEndpointMessage(
  jobId: string,
  reconcileAttempt = 0,
): DeliveryQueueMessageV1 {
  return {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "deliver_endpoint",
    jobId,
    // Only stamp the field once a reconcile cycle has begun, so the initial
    // delivery message stays byte-identical to before (treated as 0 on read).
    ...(reconcileAttempt > 0 ? { reconcileAttempt } : {}),
    scheduledAt: nowIso(),
  };
}

export function buildResolveActorMessage(
  activityId: string,
  recipientActorApId: string,
  attempts = 0,
): DeliveryQueueMessageV1 {
  return {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "resolve_actor",
    activityId,
    recipientActorApId,
    ...(attempts > 0 ? { attempts } : {}),
    scheduledAt: nowIso(),
  };
}

export function buildReconcileJobMessage(
  jobId: string,
  reconcileAttempt: number,
): DeliveryQueueMessageV1 {
  return {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "reconcile_job",
    jobId,
    reconcileAttempt,
    scheduledAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Job management
// ---------------------------------------------------------------------------

export async function upsertDeliveryJob(
  db: Database,
  jobId: string,
  activityId: string,
  endpoint: string,
): Promise<void> {
  await db
    .insert(deliveryQueue)
    .values({
      id: jobId,
      inboxUrl: endpoint,
      activityApId: activityId,
      attempts: 0,
      nextAttemptAt: nowIso(),
      status: "pending",
    })
    .onConflictDoNothing();

  // Guard against overwriting in-flight or completed jobs.
  await db
    .update(deliveryQueue)
    .set({
      inboxUrl: endpoint,
      activityApId: activityId,
    })
    .where(
      and(
        eq(deliveryQueue.id, jobId),
        notInArray(deliveryQueue.status, ["processing", "delivered"]),
      ),
    );
}

export async function enqueueResolveForEndpointActors(
  db: Database,
  env: Env,
  activityId: string,
  endpoint: string,
): Promise<number> {
  if (!queueAvailable(env)) return 0;

  const PAGE_SIZE = 200;
  const SEND_BATCH_SIZE = 100;
  const MAX_ACTORS = 2000;

  let cursor: string | null = null;
  let enqueued = 0;

  while (enqueued < MAX_ACTORS) {
    let query = db
      .select({ apId: actorCache.apId })
      .from(actorCache)
      .where(
        or(
          eq(actorCache.sharedInbox, endpoint),
          eq(actorCache.inbox, endpoint),
        ),
      )
      .orderBy(actorCache.apId)
      .limit(PAGE_SIZE);

    if (cursor) {
      query = db
        .select({ apId: actorCache.apId })
        .from(actorCache)
        .where(
          and(
            or(
              eq(actorCache.sharedInbox, endpoint),
              eq(actorCache.inbox, endpoint),
            ),
            sql`${actorCache.apId} > ${cursor}`,
          ),
        )
        .orderBy(actorCache.apId)
        .limit(PAGE_SIZE);
    }

    const page = await query;

    if (page.length === 0) break;

    for (
      let i = 0;
      i < page.length && enqueued < MAX_ACTORS;
      i += SEND_BATCH_SIZE
    ) {
      const candidates = page
        .slice(i, i + SEND_BATCH_SIZE)
        .map((r) => r.apId)
        .filter((apId) => isSafeRemoteUrl(apId));

      // Drop recipients the operator has defederated before re-enqueueing
      // resolve_actor jobs (outbound blocklist enforcement). Batched (2 queries)
      // rather than a serial isActorBlocked per candidate.
      const blockedSet = await filterBlockedActorApIds(db, candidates);
      const slice = candidates.filter((apId) => !blockedSet.has(apId));

      if (slice.length === 0) continue;

      const requests = slice.map((recipientApId) => ({
        body: buildResolveActorMessage(activityId, recipientApId),
      }));

      await env.DELIVERY_QUEUE.sendBatch(requests);
      enqueued += slice.length;
    }

    cursor = page[page.length - 1]?.apId ?? null;
    if (page.length < PAGE_SIZE) break;
  }

  if (enqueued >= MAX_ACTORS) {
    log.warn(
      "Endpoint invalidation affected many actors; capped re-resolution enqueue",
      {
        event: "delivery.queue.reresolution_capped",
        endpoint,
        activityId,
        enqueued,
        max: MAX_ACTORS,
      },
    );
  }

  return enqueued;
}

// ---------------------------------------------------------------------------
// Public enqueue entry points
// ---------------------------------------------------------------------------

export async function enqueueFanoutToFollowers(
  env: Env,
  activityId: string,
  followeeApId: string,
): Promise<void> {
  await sendQueueMessage(env, {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "fanout_followers",
    activityId,
    followeeApId,
    scheduledAt: nowIso(),
  });
}

export async function enqueueDeliveryToActor(
  env: Env,
  activityId: string,
  recipientActorApId: string,
): Promise<void> {
  // Enforce the operator blocklist on the OUTBOUND single-actor path (DMs,
  // Accept/Follow responses, targeted post/story interactions). A defederated
  // domain/actor must never receive our activities, mirroring the inbound
  // enforcement in the inbox handler. Best-effort: if the db read fails,
  // isActorBlocked returns false (never black-hole on a transient error).
  const db = (env as Partial<Env>).DB_INSTANCE;
  if (db && (await isActorBlocked(db, recipientActorApId))) {
    log.info("Skipping outbound delivery to blocked actor", {
      event: "delivery.blocklist.actor_skip",
      actor: recipientActorApId,
      activityId,
    });
    emitMetric("delivery.blocklist.actor_skip", 1, {});
    return;
  }

  await sendQueueMessage(
    env,
    buildResolveActorMessage(activityId, recipientActorApId),
  );
}

/**
 * Fan an activity out to a community's audience (members + community
 * followers) instead of the author's personal follower graph. Used for
 * community-scoped posts so reach == community.
 */
export async function enqueueFanoutToCommunity(
  env: Env,
  activityId: string,
  communityApId: string,
  announceActivityId?: string,
): Promise<void> {
  await sendQueueMessage(env, {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "fanout_community",
    activityId,
    communityApId,
    ...(announceActivityId ? { announceActivityId } : {}),
    scheduledAt: nowIso(),
  });
}

// ---------------------------------------------------------------------------
// Batch handlers (top-level entry points for queue consumers)
// ---------------------------------------------------------------------------

export async function handleDeliveryQueueBatch(
  batch: MessageBatch<DeliveryQueueMessageV1>,
  env: Env,
): Promise<void> {
  const db = env.DB_INSTANCE;
  const bulkhead = new Bulkhead(
    BULKHEAD_GLOBAL_CONCURRENCY,
    BULKHEAD_PER_DOMAIN,
  );

  // Lazy import sub-modules to avoid circular dependencies at module level
  const {
    processFanoutFollowers,
    processFanoutCommunity,
    processResolveActor,
    processReconcileJob,
    runWithConcurrency,
  } = await import("./queue-batching.ts");
  const { processDeliverEndpoint } = await import("./queue-delivery.ts");

  // Process non-delivery messages first (planning/resolution).
  for (const message of batch.messages) {
    const body = message.body;
    if (!isDeliveryQueueMessageV1(body)) {
      log.warn("Invalid delivery message format, skipping", {
        event: "delivery.queue.invalid_message",
        bodyPreview: JSON.stringify(body).slice(0, 200),
      });
      message.ack();
      continue;
    }

    if (body.type === "deliver_endpoint") {
      // handled later with concurrency
      continue;
    }

    try {
      switch (body.type) {
        case "fanout_followers":
          await processFanoutFollowers(db, env, body, message);
          break;
        case "fanout_community":
          await processFanoutCommunity(db, env, body, message);
          break;
        case "resolve_actor":
          await processResolveActor(db, env, body, message);
          break;
        case "reconcile_job":
          await processReconcileJob(db, env, body, message);
          break;
        default:
          assertNever(body);
      }
    } catch (e) {
      log.error("Non-delivery message failed", {
        event: "delivery.queue.non_delivery_failed",
        messageType: body.type,
        error: e,
      });
      message.retry({ delaySeconds: 60 });
    }
  }

  // Deliver endpoint messages with bulkhead+concurrency.
  const deliveryMessages = batch.messages.filter(
    (m: Message<DeliveryQueueMessageV1>) =>
      isDeliveryQueueMessageV1(m.body) && m.body.type === "deliver_endpoint",
  ) as Array<Message<DeliveryQueueMessageV1>>;
  await runWithConcurrency(
    deliveryMessages,
    BULKHEAD_GLOBAL_CONCURRENCY,
    async (m: Message<DeliveryQueueMessageV1>) => {
      try {
        await processDeliverEndpoint(
          db,
          env,
          m.body as DeliveryDeliverEndpointMessageV1,
          m,
          bulkhead,
        );
      } catch (e) {
        const body = m.body as DeliveryDeliverEndpointMessageV1;
        log.error("deliver_endpoint failed", {
          event: "delivery.queue.deliver_endpoint_failed",
          jobId: body?.jobId,
          error: e,
        });
        m.retry({ delaySeconds: 60 });
      }
    },
  );
}

export async function handleDeliveryDlqBatch(
  batch: MessageBatch<DeliveryDlqMessageV1>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body;
    if (!isDeliveryDlqMessageV1(body)) {
      log.warn("Invalid DLQ message format, skipping", {
        event: "delivery.dlq.invalid_message",
        bodyPreview: JSON.stringify(body).slice(0, 200),
      });
      message.ack();
      continue;
    }

    // Structured log for alerting/monitoring.
    log.error("Delivery job dead-lettered", {
      event: "delivery.dlq.job_dead_lettered",
      jobId: body.jobId,
      activityId: body.activityId,
      endpoint: body.endpoint,
      attempts: body.attempts,
      lastError: body.lastError,
      deadLetteredAt: body.deadLetteredAt,
    });

    // Phase 3: periodic reconciliation (best-effort), BOUNDED. The job's
    // reconcile-cycle count is carried in-band on the dead-lettered
    // deliver_endpoint message (default 0 for the first dead-letter). Once it
    // reaches the cap, stop reconciling and leave the job terminally dead_letter
    // — otherwise a permanently-dead endpoint loops dead_letter -> reconcile ->
    // dead_letter forever. The next cycle carries count+1.
    const reconcileAttempt = body.reconcileAttempt ?? 0;
    if (reconcileAttempt >= MAX_RECONCILE_ATTEMPTS) {
      log.warn("Delivery job exhausted reconciliation budget; giving up", {
        event: "delivery.dlq.reconciliation_exhausted",
        jobId: body.jobId,
        endpoint: body.endpoint,
        reconcileAttempt,
      });
      message.ack();
      continue;
    }
    try {
      await sendQueueMessage(
        env,
        buildReconcileJobMessage(body.jobId, reconcileAttempt + 1),
        6 * 60 * 60,
      );
    } catch (e) {
      log.warn("Failed to schedule DLQ reconciliation", {
        event: "delivery.dlq.reconciliation_schedule_failed",
        jobId: body.jobId,
        error: e,
      });
    }

    message.ack();
  }
}
