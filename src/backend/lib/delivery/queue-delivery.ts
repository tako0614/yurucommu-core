/**
 * Delivery endpoint processing - handles the actual HTTP delivery of ActivityPub activities.
 * Includes signing, circuit breaker checks, retry logic, and dead-letter handling.
 */

import type { Message } from '@cloudflare/workers-types';
import type { Env } from '../../types.ts';
import type { Database } from '../../../db/index.ts';
import { eq, and, notInArray, sql } from 'drizzle-orm';
import { actorCache, actors, communities, instanceActor, activities, deliveryQueue } from '../../../db/index.ts';
import { isSafeRemoteUrl, signRequest, fetchWithTimeout } from '../../federation-helpers.ts';
import { emitMetric } from './metrics.ts';
import { checkCircuit, recordCircuitFailure, recordCircuitSuccess } from './circuit.ts';
import {
  type DeliveryDeliverEndpointMessageV1,
  type DeliveryQueueMessageV1,
} from './types.ts';
import {
  computeRetryDelaySeconds,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from './transformers.ts';
import {
  type Bulkhead,
  type QueueEnv,
  requireQueue,
  sendQueueMessage,
  sendDlqMessage,
  buildDeliverEndpointMessage,
  buildReconcileJobMessage,
  nowIso,
  enqueueResolveForEndpointActors,
} from './queue.ts';

const DELIVERY_HTTP_TIMEOUT_MS = 8000;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';

type TimedFetchResult = {
  response: Response | null;
  error: unknown;
  latencyMs: number;
};

async function timedFetch(url: string, init: RequestInit & { timeout: number }): Promise<TimedFetchResult> {
  const startedAt = Date.now();
  let response: Response | null = null;
  let error: unknown = null;
  try {
    response = await fetchWithTimeout(url, init);
  } catch (e) {
    error = e;
  }
  return { response, error, latencyMs: Date.now() - startedAt };
}

function buildErrorMessage(response: Response | null, error: unknown): string {
  if (response) return `HTTP ${response.status}`;
  if (error instanceof Error) return error.message;
  return 'delivery_error';
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseSampleRate(value: string | undefined): number {
  if (!value) return 1.0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0, Math.min(1, n));
}

async function resolveSigningActor(
  db: Database,
  actorApId: string
): Promise<{ apId: string; privateKeyPem: string } | null> {
  // Check actors table
  const actorRow = await db.select({ apId: actors.apId, privateKeyPem: actors.privateKeyPem })
    .from(actors)
    .where(eq(actors.apId, actorApId))
    .get();
  if (actorRow?.privateKeyPem) return { apId: actorRow.apId, privateKeyPem: actorRow.privateKeyPem };

  // Check communities table
  const communityRow = await db.select({ apId: communities.apId, privateKeyPem: communities.privateKeyPem })
    .from(communities)
    .where(eq(communities.apId, actorApId))
    .get();
  if (communityRow?.privateKeyPem) return { apId: communityRow.apId, privateKeyPem: communityRow.privateKeyPem };

  // Check instanceActor table
  const instanceRow = await db.select({ apId: instanceActor.apId, privateKeyPem: instanceActor.privateKeyPem })
    .from(instanceActor)
    .where(eq(instanceActor.apId, actorApId))
    .get();
  if (instanceRow?.privateKeyPem) return { apId: instanceRow.apId, privateKeyPem: instanceRow.privateKeyPem };

  return null;
}

async function failJob(
  db: Database,
  jobId: string,
  error: string,
  message: Message<DeliveryQueueMessageV1>
): Promise<void> {
  await db.update(deliveryQueue)
    .set({ status: 'failed', error, lastAttemptAt: nowIso(), processingStartedAt: null })
    .where(eq(deliveryQueue.id, jobId));
  message.ack();
}

async function incrementDeliveryAttempts(db: Database, jobId: string): Promise<number> {
  await db.update(deliveryQueue)
    .set({ attempts: sql`${deliveryQueue.attempts} + 1` })
    .where(eq(deliveryQueue.id, jobId));
  const updated = await db.select({ attempts: deliveryQueue.attempts })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, jobId))
    .get();
  return updated?.attempts ?? 0;
}

async function maybeShadowProbeInbox(
  db: Database,
  env: Env,
  params: {
    activityId: string;
    sharedInboxEndpoint: string;
    endpointHost: string;
    sender: { apId: string; privateKeyPem: string };
    body: string;
  }
): Promise<void> {
  const allowedHosts = parseCommaSeparated(env.DELIVERY_SHADOW_PROBE_HOSTS);
  if (allowedHosts.length === 0) return;
  if (!allowedHosts.includes(params.endpointHost)) return;

  const sampleRate = parseSampleRate(env.DELIVERY_SHADOW_PROBE_SAMPLE_RATE);
  if (sampleRate <= 0) return;
  if (sampleRate < 1 && Math.random() > sampleRate) return;

  const rep = await db.select({ apId: actorCache.apId, inbox: actorCache.inbox })
    .from(actorCache)
    .where(eq(actorCache.sharedInbox, params.sharedInboxEndpoint))
    .limit(1)
    .get();
  const inbox = rep?.inbox;
  if (!inbox || !isSafeRemoteUrl(inbox)) return;

  const inboxHost = safeEndpointHost(inbox);
  const keyId = `${params.sender.apId}#main-key`;
  const headers = await signRequest(params.sender.privateKeyPem, keyId, 'POST', inbox, params.body);

  const { response, error, latencyMs } = await timedFetch(inbox, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/activity+json',
      'X-Yurucommu-Shadow-Probe': '1',
    },
    body: params.body,
    timeout: DELIVERY_HTTP_TIMEOUT_MS,
  });

  emitMetric('delivery_shadow_probe_inbox_latency_ms', latencyMs, {
    endpoint_host: params.endpointHost,
    inbox_host: inboxHost ?? 'unknown',
    ok: response?.ok ?? false,
    status: response?.status ?? null,
  });
  emitMetric('delivery_shadow_probe_inbox_ok', response?.ok ? 1 : 0, {
    endpoint_host: params.endpointHost,
    inbox_host: inboxHost ?? 'unknown',
    status: response?.status ?? null,
    error: error instanceof Error ? error.message : null,
  });
}

export async function processDeliverEndpoint(
  db: Database,
  env: Env,
  msg: DeliveryDeliverEndpointMessageV1,
  message: Message<DeliveryQueueMessageV1>,
  bulkhead: Bulkhead
): Promise<void> {
  if (!requireQueue(env, 'deliver_endpoint', message)) return;

  const job = await db.select({
    id: deliveryQueue.id,
    activityApId: deliveryQueue.activityApId,
    inboxUrl: deliveryQueue.inboxUrl,
    attempts: deliveryQueue.attempts,
    status: deliveryQueue.status,
    nextAttemptAt: deliveryQueue.nextAttemptAt,
    processingStartedAt: deliveryQueue.processingStartedAt,
  })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, msg.jobId))
    .get();

  const TERMINAL_JOB_STATUSES: readonly string[] = ['delivered', 'dead_letter', 'failed'];

  if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) {
    message.ack();
    return;
  }

  // Queue lag metric
  const scheduledMs = safeParseIsoTimeMs(msg.scheduledAt);
  if (scheduledMs !== null) {
    emitMetric('delivery_queue_lag_seconds', Math.max(0, (Date.now() - scheduledMs) / 1000), {
      endpoint_host: safeEndpointHost(job.inboxUrl) ?? 'unknown',
    });
  }

  // Respect job scheduling stored in DB
  const nextAttemptMs = safeParseIsoTimeMs(job.nextAttemptAt);
  if (nextAttemptMs !== null && Date.now() < nextAttemptMs) {
    const deferSeconds = Math.max(1, Math.ceil((nextAttemptMs - Date.now()) / 1000));
    await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), deferSeconds);
    message.ack();
    return;
  }

  if (job.status === 'processing') {
    const startedMs = safeParseIsoTimeMs(job.processingStartedAt);
    if (startedMs !== null && Date.now() - startedMs < STALE_PROCESSING_MS) {
      await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), 30);
      message.ack();
      return;
    }
  }

  const endpoint = job.inboxUrl;
  const host = safeEndpointHost(endpoint);
  if (!host) {
    await failJob(db, job.id, 'invalid_endpoint', message);
    return;
  }

  // Circuit breaker
  const circuit = await checkCircuit(db, endpoint);
  if (!circuit.allow) {
    emitMetric('delivery_circuit_open_count', 1, { endpoint_host: host });
    await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), circuit.deferSeconds);
    message.ack();
    return;
  }

  await bulkhead.acquire(host);
  try {
    // Mark processing
    await db.update(deliveryQueue)
      .set({
        status: 'processing',
        processingStartedAt: nowIso(),
      })
      .where(eq(deliveryQueue.id, job.id));

    const activity = await db.select({ rawJson: activities.rawJson, actorApId: activities.actorApId })
      .from(activities)
      .where(eq(activities.apId, job.activityApId))
      .get();
    if (!activity) {
      await failJob(db, job.id, 'activity_not_found', message);
      return;
    }

    const sender = await resolveSigningActor(db, activity.actorApId);
    if (!sender) {
      await failJob(db, job.id, 'signing_actor_not_found', message);
      return;
    }

    const body = activity.rawJson;
    const keyId = `${sender.apId}#main-key`;
    const headers = await signRequest(sender.privateKeyPem, keyId, 'POST', endpoint, body);

    const { response, error, latencyMs } = await timedFetch(endpoint, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/activity+json' },
      body,
      timeout: DELIVERY_HTTP_TIMEOUT_MS,
    });

    emitMetric('delivery_latency_ms', latencyMs, {
      endpoint_host: host,
      ok: response?.ok ?? false,
      status: response?.status ?? null,
    });

    if (response?.ok) {
      const now = nowIso();
      await db.update(deliveryQueue)
        .set({
          status: 'delivered',
          deliveredAt: now,
          error: null,
          lastAttemptAt: now,
          processingStartedAt: null,
        })
        .where(eq(deliveryQueue.id, job.id));
      emitMetric('delivery_success', 1, { endpoint_host: host });
      await recordCircuitSuccess(db, endpoint);

      // Shadow probe (staging-only)
      if (job.attempts === 0) {
        try {
          await maybeShadowProbeInbox(db, env, {
            activityId: job.activityApId,
            sharedInboxEndpoint: endpoint,
            endpointHost: host,
            sender,
            body,
          });
        } catch (e) {
          console.warn('[DeliveryQueue] shadow probe failed:', e);
        }
      }

      message.ack();
      return;
    }

    const status = response?.status ?? null;
    const errorMessage = buildErrorMessage(response, error);

    // 404/410: expire endpoint cache immediately
    if (status === 404 || status === 410) {
      try {
        await enqueueResolveForEndpointActors(db, env, job.activityApId, endpoint);
        await db.update(actorCache)
          .set({ sharedInbox: null, lastFetchedAt: EPOCH_ISO })
          .where(eq(actorCache.sharedInbox, endpoint));
        await db.update(actorCache)
          .set({ lastFetchedAt: EPOCH_ISO })
          .where(eq(actorCache.inbox, endpoint));
      } catch (e) {
        console.warn('[DeliveryQueue] endpoint invalidation failed:', e);
      }
    }

    // Non-retryable 4xx (except 429) => permanent failure
    const nonRetryable = status !== null && status >= 400 && status < 500 && status !== 429;
    if (nonRetryable) {
      await failJob(db, job.id, errorMessage, message);
      emitMetric('delivery_success', 0, { endpoint_host: host, non_retryable: true, status });
      await recordCircuitFailure(db, endpoint);
      return;
    }

    // Retryable failure
    const nextAttempts = await incrementDeliveryAttempts(db, job.id);
    await recordCircuitFailure(db, endpoint);

    if (nextAttempts >= DELIVERY_MAX_ATTEMPTS) {
      const now = nowIso();
      await db.update(deliveryQueue)
        .set({ status: 'dead_letter', error: errorMessage, lastAttemptAt: now, processingStartedAt: null })
        .where(eq(deliveryQueue.id, job.id));
      emitMetric('delivery_dead_letter', 1, { endpoint_host: host });

      await sendDlqMessage(env, {
        version: 1,
        type: 'dlq',
        jobId: job.id,
        activityId: job.activityApId,
        endpoint,
        attempts: nextAttempts,
        lastError: errorMessage,
        deadLetteredAt: now,
      });

      message.ack();
      return;
    }

    const delaySeconds = computeRetryDelaySeconds(nextAttempts);
    const nextAttemptAtStr = new Date(Date.now() + delaySeconds * 1000).toISOString();

    await db.update(deliveryQueue)
      .set({ status: 'retry_wait', error: errorMessage, lastAttemptAt: nowIso(), processingStartedAt: null, nextAttemptAt: nextAttemptAtStr })
      .where(eq(deliveryQueue.id, job.id));

    emitMetric('delivery_success', 0, { endpoint_host: host, status: status ?? null });
    await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), delaySeconds);
    message.ack();
  } finally {
    bulkhead.release(host);
  }
}
