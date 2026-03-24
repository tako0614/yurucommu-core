/**
 * Core queue management - message builders, public enqueue entry points,
 * and the batch handler that dispatches to sub-modules.
 */

import type { Message, MessageBatch, Queue } from '@cloudflare/workers-types';
import type { Env } from '../../types';
import { getDb, type Database } from '../../../db';
import { eq, and, or, notInArray, sql } from 'drizzle-orm';
import { actorCache, deliveryQueue } from '../../../db';
import { isSafeRemoteUrl } from '../../utils';
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryQueueMessageV1,
  type DeliveryDlqMessageV1,
  type DeliveryDeliverEndpointMessageV1,
  isDeliveryQueueMessageV1,
  isDeliveryDlqMessageV1,
} from './types';
import {
  computeDeliveryJobId,
  safeEndpointHost,
} from './utils';

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

export type QueueEnv = Env & { DELIVERY_QUEUE: Queue<DeliveryQueueMessageV1>; DELIVERY_DLQ: Queue<DeliveryDlqMessageV1> };

function queueAvailable(env: Env): env is QueueEnv {
  return Boolean((env as unknown as { DELIVERY_QUEUE?: unknown }).DELIVERY_QUEUE) && Boolean((env as unknown as { DELIVERY_DLQ?: unknown }).DELIVERY_DLQ);
}

export function requireQueue(env: Env, label: string, message: Message<DeliveryQueueMessageV1>): env is QueueEnv {
  if (queueAvailable(env)) return true;
  console.warn(`[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Dropping ${label} job.`);
  message.ack();
  return false;
}

// ---------------------------------------------------------------------------
// Queue message builders & senders
// ---------------------------------------------------------------------------

export async function sendQueueMessage(env: Env, body: DeliveryQueueMessageV1, delaySeconds?: number): Promise<void> {
  if (!queueAvailable(env)) return;
  await env.DELIVERY_QUEUE.send(body, delaySeconds ? { delaySeconds } : undefined);
}

export async function sendDlqMessage(env: Env, payload: DeliveryDlqMessageV1): Promise<void> {
  if (!queueAvailable(env)) return;
  await env.DELIVERY_DLQ.send(payload);
}

export function buildDeliverEndpointMessage(jobId: string): DeliveryQueueMessageV1 {
  return { version: DELIVERY_QUEUE_MESSAGE_VERSION, type: 'deliver_endpoint', jobId, scheduledAt: nowIso() };
}

export function buildResolveActorMessage(activityId: string, recipientActorApId: string): DeliveryQueueMessageV1 {
  return { version: DELIVERY_QUEUE_MESSAGE_VERSION, type: 'resolve_actor', activityId, recipientActorApId, scheduledAt: nowIso() };
}

export function buildReconcileJobMessage(jobId: string, reconcileAttempt: number): DeliveryQueueMessageV1 {
  return { version: DELIVERY_QUEUE_MESSAGE_VERSION, type: 'reconcile_job', jobId, reconcileAttempt, scheduledAt: nowIso() };
}

// ---------------------------------------------------------------------------
// Job management
// ---------------------------------------------------------------------------

export async function upsertDeliveryJob(db: Database, jobId: string, activityId: string, endpoint: string): Promise<void> {
  await db.insert(deliveryQueue)
    .values({
      id: jobId,
      inboxUrl: endpoint,
      activityApId: activityId,
      attempts: 0,
      nextAttemptAt: nowIso(),
      status: 'pending',
    })
    .onConflictDoNothing();

  // Guard against overwriting in-flight or completed jobs.
  await db.update(deliveryQueue)
    .set({
      inboxUrl: endpoint,
      activityApId: activityId,
    })
    .where(
      and(
        eq(deliveryQueue.id, jobId),
        notInArray(deliveryQueue.status, ['processing', 'delivered']),
      )
    );
}

export async function enqueueResolveForEndpointActors(
  db: Database,
  env: Env,
  activityId: string,
  endpoint: string
): Promise<number> {
  if (!queueAvailable(env)) return 0;

  const PAGE_SIZE = 200;
  const SEND_BATCH_SIZE = 100;
  const MAX_ACTORS = 2000;

  let cursor: string | null = null;
  let enqueued = 0;

  while (enqueued < MAX_ACTORS) {
    let query = db.select({ apId: actorCache.apId })
      .from(actorCache)
      .where(or(eq(actorCache.sharedInbox, endpoint), eq(actorCache.inbox, endpoint)))
      .orderBy(actorCache.apId)
      .limit(PAGE_SIZE);

    if (cursor) {
      query = db.select({ apId: actorCache.apId })
        .from(actorCache)
        .where(
          and(
            or(eq(actorCache.sharedInbox, endpoint), eq(actorCache.inbox, endpoint)),
            sql`${actorCache.apId} > ${cursor}`,
          )
        )
        .orderBy(actorCache.apId)
        .limit(PAGE_SIZE);
    }

    const page = await query;

    if (page.length === 0) break;

    for (let i = 0; i < page.length && enqueued < MAX_ACTORS; i += SEND_BATCH_SIZE) {
      const slice = page
        .slice(i, i + SEND_BATCH_SIZE)
        .map((r) => r.apId)
        .filter((apId) => isSafeRemoteUrl(apId));

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
    console.warn('[DeliveryQueue] endpoint invalidation affected many actors; capped re-resolution enqueue:', {
      endpoint,
      activityId,
      enqueued,
      max: MAX_ACTORS,
    });
  }

  return enqueued;
}

// ---------------------------------------------------------------------------
// Public enqueue entry points
// ---------------------------------------------------------------------------

export async function enqueueFanoutToFollowers(env: Env, activityId: string, followeeApId: string): Promise<void> {
  await sendQueueMessage(env, {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: 'fanout_followers',
    activityId,
    followeeApId,
    scheduledAt: nowIso(),
  });
}

export async function enqueueDeliveryToActor(env: Env, activityId: string, recipientActorApId: string): Promise<void> {
  await sendQueueMessage(env, buildResolveActorMessage(activityId, recipientActorApId));
}

// ---------------------------------------------------------------------------
// Batch handlers (top-level entry points for queue consumers)
// ---------------------------------------------------------------------------

export async function handleDeliveryQueueBatch(
  batch: MessageBatch<DeliveryQueueMessageV1>,
  env: Env
): Promise<void> {
  const db = (env as { PRISMA?: Database }).PRISMA ?? getDb(env.DB);
  const bulkhead = new Bulkhead(BULKHEAD_GLOBAL_CONCURRENCY, BULKHEAD_PER_DOMAIN);

  // Lazy import sub-modules to avoid circular dependencies at module level
  const { processFanoutFollowers, processResolveActor, processReconcileJob, runWithConcurrency } = await import('./queue-batching');
  const { processDeliverEndpoint } = await import('./queue-delivery');

  // Process non-delivery messages first (planning/resolution).
  for (const message of batch.messages) {
    const body = message.body;
    if (!isDeliveryQueueMessageV1(body)) {
      console.warn('[DeliveryQueue] Invalid message format, skipping:', JSON.stringify(body).slice(0, 200));
      message.ack();
      continue;
    }

    if (body.type === 'deliver_endpoint') {
      // handled later with concurrency
      continue;
    }

    try {
      switch (body.type) {
        case 'fanout_followers':
          await processFanoutFollowers(db, env, body, message);
          break;
        case 'resolve_actor':
          await processResolveActor(db, env, body, message);
          break;
        case 'reconcile_job':
          await processReconcileJob(db, env, body, message);
          break;
        default:
          message.ack();
      }
    } catch (e) {
      console.error('[DeliveryQueue] Non-delivery message failed:', e);
      message.retry({ delaySeconds: 60 });
    }
  }

  // Deliver endpoint messages with bulkhead+concurrency.
  const deliveryMessages = batch.messages.filter((m) => isDeliveryQueueMessageV1(m.body) && m.body.type === 'deliver_endpoint') as Array<Message<DeliveryQueueMessageV1>>;
  await runWithConcurrency(deliveryMessages, BULKHEAD_GLOBAL_CONCURRENCY, async (m) => {
    try {
      await processDeliverEndpoint(db, env, m.body as DeliveryDeliverEndpointMessageV1, m, bulkhead);
    } catch (e) {
      console.error('[DeliveryQueue] deliver_endpoint failed:', e);
      m.retry({ delaySeconds: 60 });
    }
  });
}

export async function handleDeliveryDlqBatch(
  batch: MessageBatch<DeliveryDlqMessageV1>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    const body = message.body;
    if (!isDeliveryDlqMessageV1(body)) {
      console.warn('[DeliveryDLQ] Invalid message format, skipping:', JSON.stringify(body).slice(0, 200));
      message.ack();
      continue;
    }

    // Structured log for alerting/monitoring.
    console.error('[DeliveryDLQ] job dead-lettered:', {
      jobId: body.jobId,
      activityId: body.activityId,
      endpoint: body.endpoint,
      attempts: body.attempts,
      lastError: body.lastError,
      deadLetteredAt: body.deadLetteredAt,
    });

    // Phase 3: periodic reconciliation (best-effort).
    try {
      await sendQueueMessage(env, buildReconcileJobMessage(body.jobId, 1), 6 * 60 * 60);
    } catch (e) {
      console.warn('[DeliveryDLQ] Failed to schedule reconciliation:', e);
    }

    message.ack();
  }
}
