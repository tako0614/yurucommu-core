/**
 * Core queue management - message builders, public enqueue entry points,
 * and the batch handler that dispatches to sub-modules.
 */

import type { Env } from "../../types.ts";
import type {
  IQueueBatch,
  IQueueMessage,
  IQueueProducer,
} from "../../runtime/queue.ts";
import type { Database } from "../../../db/index.ts";
import { and, eq, inArray, lt, lte, notInArray, or, sql } from "drizzle-orm";
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
import {
  enqueuePendingNotificationPushJobs,
  processNotificationPushJob,
  recoverDeadLetteredNotificationPushJob,
} from "../notification-push.ts";
import {
  buildResolveActorMessage,
  enqueueDeliveryResolutionJobs,
  enqueuePendingDeliveryResolutionJobs,
  persistDeliveryResolutionJobs,
} from "./resolution-outbox.ts";
import {
  deliveryFanoutIntentFromMessage,
  enqueueDeliveryFanoutJob,
  enqueuePendingDeliveryFanoutJobs,
  failDeliveryFanoutJob,
} from "./fanout-outbox.ts";

export { buildResolveActorMessage } from "./resolution-outbox.ts";

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
  DELIVERY_QUEUE: IQueueProducer<DeliveryQueueMessageV1>;
  DELIVERY_DLQ: IQueueProducer<DeliveryDlqMessageV1>;
};

function queueAvailable(env: Env): env is QueueEnv {
  return Boolean(env.DELIVERY_QUEUE) && Boolean(env.DELIVERY_DLQ);
}

export function requireQueue(
  env: Env,
  label: string,
  message: IQueueMessage<DeliveryQueueMessageV1>,
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

/**
 * DLQ recovery cannot use the ordinary best-effort producer contract: a
 * missing binding must keep the DLQ message retryable rather than look like a
 * successful redrive and get ACKed. Runtime send failures already throw; make
 * binding drift do the same while preserving the shared alert/metric.
 */
async function sendQueueMessageRequired(
  env: Env,
  body: DeliveryQueueMessageV1,
  delaySeconds?: number,
): Promise<void> {
  if (!queueAvailable(env)) {
    reportProducerUnavailable("sendQueueMessageRequired");
    throw new Error("DELIVERY_QUEUE and DELIVERY_DLQ bindings are required");
  }
  await sendQueueMessage(env, body, delaySeconds);
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

// Cloudflare puts the raw MAIN-queue body onto the DLQ after transport/runtime
// retries are exhausted. Redrive idempotent delivery work a few times so one
// infrastructure incident does not become permanent data loss, while keeping
// a poison message or persistent code failure from cycling MAIN -> DLQ forever.
export const MAX_AUTO_DLQ_REDRIVES = 3;

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

const PENDING_DELIVERY_SCAN_LIMIT = 500;
const STALE_DELIVERY_PROCESSING_MS = 2 * 60 * 1000;

/**
 * Re-publish durable endpoint jobs whose first Queue RPC was lost, whose
 * backoff has elapsed, or whose processing worker disappeared. Queue messages
 * are wakeups; delivery_queue remains the retry authority.
 */
export async function enqueuePendingDeliveryEndpointJobs(
  env: Env,
  nowDate = new Date(),
  options: {
    readonly includeDeferred?: boolean;
    readonly includeFreshPending?: boolean;
  } = {},
): Promise<number> {
  if (!env.DELIVERY_QUEUE) return 0;
  const now = nowDate.toISOString();
  const staleBefore = new Date(
    nowDate.getTime() - STALE_DELIVERY_PROCESSING_MS,
  ).toISOString();
  const rows = await env.DB_INSTANCE.select({ id: deliveryQueue.id })
    .from(deliveryQueue)
    .where(
      or(
        options.includeFreshPending
          ? eq(deliveryQueue.status, "pending")
          : and(
              eq(deliveryQueue.status, "pending"),
              lt(deliveryQueue.createdAt, staleBefore),
            ),
        options.includeDeferred
          ? eq(deliveryQueue.status, "retry_wait")
          : and(
              eq(deliveryQueue.status, "retry_wait"),
              lte(deliveryQueue.nextAttemptAt, now),
            ),
        and(
          eq(deliveryQueue.status, "processing"),
          lt(deliveryQueue.processingStartedAt, staleBefore),
        ),
      ),
    )
    .limit(PENDING_DELIVERY_SCAN_LIMIT);
  for (let offset = 0; offset < rows.length; offset += 100) {
    await env.DELIVERY_QUEUE.sendBatch(
      rows.slice(offset, offset + 100).map((row) => ({
        body: buildDeliverEndpointMessage(row.id),
      })),
    );
  }
  return rows.length;
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

      await enqueueDeliveryResolutionJobs(
        db,
        env.DELIVERY_QUEUE,
        slice.map((recipientActorApId) => ({
          activityId,
          recipientActorApId,
        })),
        { reopenTerminal: true },
      );
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
  const body = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "fanout_followers" as const,
    activityId,
    followeeApId,
    scheduledAt: nowIso(),
  };
  const db = (env as Partial<Env>).DB_INSTANCE;
  if (db) {
    const queue = queueAvailable(env) ? env.DELIVERY_QUEUE : undefined;
    await enqueueDeliveryFanoutJob(
      db,
      queue,
      deliveryFanoutIntentFromMessage(body),
    );
    if (!queue) reportProducerUnavailable("enqueueFanoutToFollowers");
    else producerUnavailableReported = false;
    return;
  }
  await sendQueueMessage(env, body);
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

  if (db) {
    const queue = queueAvailable(env) ? env.DELIVERY_QUEUE : undefined;
    await enqueueDeliveryResolutionJobs(db, queue, [
      { activityId, recipientActorApId },
    ]);
    if (!queue) reportProducerUnavailable("enqueueDeliveryToActor");
    else producerUnavailableReported = false;
    return;
  }

  await sendQueueMessage(
    env,
    buildResolveActorMessage(activityId, recipientActorApId),
  );
}

/**
 * Enqueue several distinct activities to the same actor without one Queue RPC
 * per activity. Cloudflare Queues accepts at most 100 messages per sendBatch;
 * keep the provider-neutral port bounded to that same size. Replaying a batch
 * is safe: endpoint resolution later derives the durable delivery-job id from
 * activity id + endpoint and upserts it idempotently.
 */
export async function enqueueDeliveriesToActor(
  env: Env,
  activityIds: readonly string[],
  recipientActorApId: string,
): Promise<void> {
  if (activityIds.length === 0) return;
  const db = (env as Partial<Env>).DB_INSTANCE;
  const intents = activityIds.map((activityId) => ({
    activityId,
    recipientActorApId,
  }));
  if (db && (await isActorBlocked(db, recipientActorApId))) {
    log.info("Skipping outbound deliveries to blocked actor", {
      event: "delivery.blocklist.actor_batch_skip",
      actor: recipientActorApId,
      activityCount: activityIds.length,
    });
    emitMetric("delivery.blocklist.actor_batch_skip", activityIds.length, {});
    return;
  }

  if (db) await persistDeliveryResolutionJobs(db, intents);
  if (!queueAvailable(env)) {
    reportProducerUnavailable("enqueueDeliveriesToActor");
    // This batched path is used by account Move after its pending edges and
    // outbound activities have already committed. A silent no-op would make
    // those local users follow a destination that never learned about them,
    // with no remaining old edges from which to reconstruct delivery. Throw so
    // the inbound dispatch stays retryable and can resume the durable activity
    // namespace after the operator restores the producer bindings.
    throw new Error(
      "DELIVERY_QUEUE and DELIVERY_DLQ bindings are required for batched delivery",
    );
  }
  producerUnavailableReported = false;

  if (db) {
    await enqueueDeliveryResolutionJobs(db, env.DELIVERY_QUEUE, intents);
    return;
  }

  const SEND_BATCH_SIZE = 100;
  for (let offset = 0; offset < activityIds.length; offset += SEND_BATCH_SIZE) {
    await env.DELIVERY_QUEUE.sendBatch(
      activityIds.slice(offset, offset + SEND_BATCH_SIZE).map((activityId) => ({
        body: buildResolveActorMessage(activityId, recipientActorApId),
      })),
    );
  }
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
  const body = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "fanout_community" as const,
    activityId,
    communityApId,
    ...(announceActivityId ? { announceActivityId } : {}),
    scheduledAt: nowIso(),
  };
  const db = (env as Partial<Env>).DB_INSTANCE;
  if (db) {
    const queue = queueAvailable(env) ? env.DELIVERY_QUEUE : undefined;
    await enqueueDeliveryFanoutJob(
      db,
      queue,
      deliveryFanoutIntentFromMessage(body),
    );
    if (!queue) reportProducerUnavailable("enqueueFanoutToCommunity");
    else producerUnavailableReported = false;
    return;
  }
  await sendQueueMessage(env, body);
}

// ---------------------------------------------------------------------------
// Batch handlers (top-level entry points for queue consumers)
// ---------------------------------------------------------------------------

export async function handleDeliveryQueueBatch(
  batch: IQueueBatch<DeliveryQueueMessageV1>,
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
        case "notification_push":
          await processNotificationPushJob(env, body, message);
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
    (m: IQueueMessage<DeliveryQueueMessageV1>) =>
      isDeliveryQueueMessageV1(m.body) && m.body.type === "deliver_endpoint",
  ) as Array<IQueueMessage<DeliveryQueueMessageV1>>;
  await runWithConcurrency(
    deliveryMessages,
    BULKHEAD_GLOBAL_CONCURRENCY,
    async (m: IQueueMessage<DeliveryQueueMessageV1>) => {
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

  // Community fanout can create local inbox rows inside this consumer rather
  // than an HTTP request. Flush the same DB-triggered outbox choke point here.
  try {
    await enqueuePendingDeliveryFanoutJobs(env);
    await enqueuePendingDeliveryEndpointJobs(env);
    await enqueuePendingDeliveryResolutionJobs(env);
  } catch (error) {
    log.error("Failed to enqueue durable federation outbox", {
      event: "delivery.outbox.enqueue_failed",
      error,
    });
  }
  try {
    await enqueuePendingNotificationPushJobs(env);
  } catch (error) {
    log.error("Failed to enqueue notification push outbox", {
      event: "notification.push.enqueue_failed",
      error,
    });
  }
  // Same choke point feeds the realtime stream (federated + fanout inserts).
  const { sweepRealtimeNotifications } =
    await import("../../runtime/realtime-hub.ts");
  await sweepRealtimeNotifications(env);
}

export async function handleDeliveryDlqBatch(
  batch: IQueueBatch<DeliveryDlqMessageV1>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    // The configured DLQ receives both app-built DeliveryDlqMessageV1 bodies
    // and Cloudflare's raw original MAIN-queue bodies. The batch generic can
    // express only one of those at a time, so narrow the runtime union from
    // unknown through the two wire validators below.
    const body: unknown = message.body;
    if (!isDeliveryDlqMessageV1(body)) {
      // Not an app-built `dlq` message. Cloudflare Queues also delivers here
      // the RAW original body of any MAIN-queue message that exhausted its
      // retries (automatic dead-lettering). Those must NOT be silently acked as
      // "invalid": a lost fanout/resolve drops local notifications or delivery
      // planning, and a lost notification_push strands its durable outbox row.
      if (isDeliveryQueueMessageV1(body)) {
        try {
          await handleAutoDeadLetteredMessage(env, body);
          message.ack();
        } catch (error) {
          log.warn("Failed to recover auto-dead-lettered message", {
            event: "delivery.dlq.auto_recovery_failed",
            messageType: body.type,
            error,
          });
          emitMetric("delivery.dlq.auto_recovery_failed", 1, {
            message_type: body.type,
          });
          // Keep the raw DLQ message alive until its durable repair or bounded
          // MAIN-queue redrive succeeds.
          message.retry({ delaySeconds: 60 });
        }
        continue;
      }
      log.warn("Invalid DLQ message format, skipping", {
        event: "delivery.dlq.invalid_message",
        bodyPreview: JSON.stringify(body).slice(0, 200),
      });
      emitMetric("delivery.dlq.invalid_message", 1, {});
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
      await sendQueueMessageRequired(
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
      // The dead-letter row is already the durable evidence that delivery did
      // not complete. ACKing its DLQ message here used to discard the only
      // trigger that can revive it after a transient main-queue outage, leaving
      // the ActivityPub delivery permanently dead_letter. Ask Cloudflare
      // Queues to redeliver this exact DLQ message instead; the successful path
      // below remains the sole ACK point.
      message.retry({ delaySeconds: 60 });
      continue;
    }

    message.ack();
  }
}

/**
 * Recover / account for a MAIN-queue message that Cloudflare auto-dead-lettered
 * (retries exhausted with the raw body). `notification_push` rows are durable,
 * so reset the job to retry through the outbox instead of stranding it;
 * idempotent federation work is sent back to MAIN with a bounded generation.
 */
async function handleAutoDeadLetteredMessage(
  env: Env,
  body: DeliveryQueueMessageV1,
): Promise<void> {
  if (body.type === "notification_push") {
    try {
      const recovered = await recoverDeadLetteredNotificationPushJob(
        env.DB_INSTANCE,
        body.jobId,
      );
      log.error("notification_push dead-lettered; reset durable outbox row", {
        event: "delivery.dlq.notification_push_recovered",
        jobId: body.jobId,
        recovered,
      });
      emitMetric("delivery.dlq.notification_push_recovered", 1, {});
    } catch (error) {
      log.error("Failed to recover dead-lettered notification_push", {
        event: "delivery.dlq.notification_push_recover_failed",
        jobId: body.jobId,
        error,
      });
      emitMetric("delivery.dlq.notification_push_recover_failed", 1, {});
      throw error;
    }
    return;
  }

  const autoDlqAttempt = body.autoDlqAttempt ?? 0;
  if (autoDlqAttempt >= MAX_AUTO_DLQ_REDRIVES) {
    if (body.type === "fanout_followers" || body.type === "fanout_community") {
      const db = (env as Partial<Env>).DB_INSTANCE;
      if (db) {
        await failDeliveryFanoutJob(
          db,
          deliveryFanoutIntentFromMessage(body),
          `Queue delivery exhausted after ${autoDlqAttempt} automatic redrives`,
        );
      }
    }
    log.error("Delivery message exhausted automatic DLQ redrives; dropping", {
      event: "delivery.dlq.auto_redrive_exhausted",
      messageType: body.type,
      autoDlqAttempt,
    });
    emitMetric("delivery.dlq.auto_redrive_exhausted", 1, {
      message_type: body.type,
    });
    return;
  }

  // Fanout pages preserve their cursor/stage, resolve preserves its own fetch
  // attempt, and deliver/reconcile preserve the durable job generation. Their
  // handlers are idempotent (stable inbox/job keys plus CAS), so replay the
  // exact semantic position with only the transport-redrive generation and
  // schedule timestamp changed.
  const redriven = {
    ...body,
    autoDlqAttempt: autoDlqAttempt + 1,
    scheduledAt: nowIso(),
  } as DeliveryQueueMessageV1;
  await sendQueueMessageRequired(env, redriven, 60);
  log.error("Delivery message auto-dead-lettered; bounded redrive scheduled", {
    event: "delivery.dlq.auto_redrive_scheduled",
    messageType: body.type,
    autoDlqAttempt: autoDlqAttempt + 1,
  });
  emitMetric("delivery.dlq.auto_redrive_scheduled", 1, {
    message_type: body.type,
  });
}
