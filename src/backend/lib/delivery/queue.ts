import type { Message, MessageBatch, Queue } from '@cloudflare/workers-types';
import type { Env } from '../../types';
import { getPrismaD1 } from '../db';
import type { PrismaClient } from '../../../generated/prisma';
import { isLocal, isSafeRemoteUrl, signRequest, fetchWithTimeout } from '../../utils';
import { emitMetric } from './metrics';
import { planEndpointsFromActorCache } from './planner';
import { checkCircuit, recordCircuitFailure, recordCircuitSuccess } from './circuit';
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryFanoutFollowersMessageV1,
  type DeliveryResolveActorMessageV1,
  type DeliveryDeliverEndpointMessageV1,
  type DeliveryReconcileJobMessageV1,
  type DeliveryQueueMessageV1,
  type DeliveryDlqMessageV1,
  isDeliveryQueueMessageV1,
  isDeliveryDlqMessageV1,
} from './types';
import {
  computeDeliveryJobId,
  computeRetryDelaySeconds,
  DELIVERY_ENDPOINT_CACHE_TTL_MS,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from './utils';

const DELIVERY_HTTP_TIMEOUT_MS = 8000;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const EPOCH_ISO = '1970-01-01T00:00:00.000Z';
const BULKHEAD_PER_DOMAIN = 3;
const BULKHEAD_GLOBAL_CONCURRENCY = 10;
const MAX_RECONCILE_ATTEMPTS = 5;
const TERMINAL_JOB_STATUSES: readonly string[] = ['delivered', 'dead_letter', 'failed'];

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

class Bulkhead {
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

function nowIso(): string {
  return new Date().toISOString();
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'P2002';
}

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

type QueueEnv = Env & { DELIVERY_QUEUE: Queue<DeliveryQueueMessageV1>; DELIVERY_DLQ: Queue<DeliveryDlqMessageV1> };

function queueAvailable(env: Env): env is QueueEnv {
  return Boolean((env as unknown as { DELIVERY_QUEUE?: unknown }).DELIVERY_QUEUE) && Boolean((env as unknown as { DELIVERY_DLQ?: unknown }).DELIVERY_DLQ);
}

function requireQueue(env: Env, label: string, message: Message<DeliveryQueueMessageV1>): env is QueueEnv {
  if (queueAvailable(env)) return true;
  console.warn(`[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Dropping ${label} job.`);
  message.ack();
  return false;
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

async function maybeShadowProbeInbox(
  prisma: PrismaClient,
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

  // Find a representative actor inbox for this sharedInbox. This is a shadow probe only and
  // must be restricted to a controlled/staging host to avoid duplicate side effects.
  const rep = await prisma.actorCache.findFirst({
    where: { sharedInbox: params.sharedInboxEndpoint },
    select: { apId: true, inbox: true },
  });
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

// --- Queue message builders & senders ---

async function sendQueueMessage(env: Env, body: DeliveryQueueMessageV1, delaySeconds?: number): Promise<void> {
  if (!queueAvailable(env)) return;
  await env.DELIVERY_QUEUE.send(body, delaySeconds ? { delaySeconds } : undefined);
}

async function sendDlqMessage(env: Env, payload: DeliveryDlqMessageV1): Promise<void> {
  if (!queueAvailable(env)) return;
  await env.DELIVERY_DLQ.send(payload);
}

function buildDeliverEndpointMessage(jobId: string): DeliveryQueueMessageV1 {
  return { version: DELIVERY_QUEUE_MESSAGE_VERSION, type: 'deliver_endpoint', jobId, scheduledAt: nowIso() };
}

function buildResolveActorMessage(activityId: string, recipientActorApId: string): DeliveryQueueMessageV1 {
  return { version: DELIVERY_QUEUE_MESSAGE_VERSION, type: 'resolve_actor', activityId, recipientActorApId, scheduledAt: nowIso() };
}

function buildReconcileJobMessage(jobId: string, reconcileAttempt: number): DeliveryQueueMessageV1 {
  return { version: DELIVERY_QUEUE_MESSAGE_VERSION, type: 'reconcile_job', jobId, reconcileAttempt, scheduledAt: nowIso() };
}

// --- Public enqueue entry points ---

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

async function failJob(
  prisma: PrismaClient,
  jobId: string,
  error: string,
  message: Message<DeliveryQueueMessageV1>
): Promise<void> {
  await prisma.deliveryQueue.update({
    where: { id: jobId },
    data: { status: 'failed', error, lastAttemptAt: nowIso(), processingStartedAt: null },
  });
  message.ack();
}

function resolvePreferredEndpoint(row: { inbox: string | null; sharedInbox: string | null } | null): string | null {
  if (row?.sharedInbox && isSafeRemoteUrl(row.sharedInbox)) return row.sharedInbox;
  if (row?.inbox && isSafeRemoteUrl(row.inbox)) return row.inbox;
  return null;
}

async function resolveSigningActor(
  prisma: PrismaClient,
  actorApId: string
): Promise<{ apId: string; privateKeyPem: string } | null> {
  const tables = [prisma.actor, prisma.community, prisma.instanceActor] as const;
  for (const table of tables) {
    const row = await (table as { findUnique: typeof prisma.actor.findUnique }).findUnique({
      where: { apId: actorApId },
      select: { apId: true, privateKeyPem: true },
    });
    if (row?.privateKeyPem) return { apId: row.apId, privateKeyPem: row.privateKeyPem };
  }
  return null;
}

async function fetchAndCacheRemoteActor(prisma: PrismaClient, actorApId: string): Promise<void> {
  if (!isSafeRemoteUrl(actorApId)) return;

  type RemoteActorDoc = {
    id: string;
    type?: string;
    preferredUsername?: string;
    name?: string;
    summary?: string;
    icon?: { url?: string };
    inbox?: string;
    outbox?: string;
    followers?: string;
    following?: string;
    publicKey?: { id?: string; publicKeyPem?: string };
    endpoints?: { sharedInbox?: string };
  };

  const res = await fetchWithTimeout(actorApId, {
    headers: { 'Accept': 'application/activity+json, application/ld+json' },
    timeout: DELIVERY_HTTP_TIMEOUT_MS,
  });
  if (!res.ok) return;

  const data = await res.json() as RemoteActorDoc;
  if (!data?.id || data.id !== actorApId) return;
  if (!data?.inbox || !isSafeRemoteUrl(data.inbox)) return;

  const actorFields = {
    type: data.type || 'Person',
    preferredUsername: data.preferredUsername || null,
    name: data.name || null,
    summary: data.summary || null,
    iconUrl: data.icon?.url || null,
    inbox: data.inbox,
    outbox: data.outbox || null,
    followersUrl: data.followers || null,
    followingUrl: data.following || null,
    sharedInbox: data.endpoints?.sharedInbox || null,
    publicKeyId: data.publicKey?.id || null,
    publicKeyPem: data.publicKey?.publicKeyPem || null,
    rawJson: JSON.stringify(data),
    lastFetchedAt: nowIso(),
  };

  await prisma.actorCache.upsert({
    where: { apId: data.id },
    update: actorFields,
    create: { apId: data.id, ...actorFields },
  });
}

async function upsertDeliveryJob(prisma: PrismaClient, jobId: string, activityId: string, endpoint: string): Promise<void> {
  try {
    await prisma.deliveryQueue.create({
      data: {
        id: jobId,
        inboxUrl: endpoint,
        activityApId: activityId,
        attempts: 0,
        nextAttemptAt: nowIso(),
        status: 'pending',
      },
    });
    return;
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }
  }

  // Guard against overwriting in-flight or completed jobs.
  await prisma.deliveryQueue.updateMany({
    where: {
      id: jobId,
      status: { notIn: ['processing', 'delivered'] },
    },
    data: {
      inboxUrl: endpoint,
      activityApId: activityId,
    },
  });
}

async function enqueueResolveForEndpointActors(
  prisma: PrismaClient,
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
    const page: Array<{ apId: string }> = await prisma.actorCache.findMany({
      where: {
        OR: [
          { sharedInbox: endpoint },
          { inbox: endpoint },
        ],
      },
      select: { apId: true },
      orderBy: { apId: 'asc' },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { apId: cursor }, skip: 1 } : {}),
    });

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

async function processFanoutFollowers(prisma: PrismaClient, env: Env, msg: DeliveryFanoutFollowersMessageV1, message: Message<DeliveryQueueMessageV1>): Promise<void> {
  const baseUrl = env.APP_URL;

  const followers = await prisma.follow.findMany({
    where: {
      followingApId: msg.followeeApId,
      status: 'accepted',
    },
    select: { followerApId: true },
    distinct: ['followerApId'],
  });
  const recipientApIds = followers
    .map((f) => f.followerApId)
    .filter((apId) => !isLocal(apId, baseUrl));

  const planned = await planEndpointsFromActorCache(prisma, recipientApIds, {
    metricTags: {
      followee: msg.followeeApId,
      activity: msg.activityId,
    },
  });

  if (!requireQueue(env, 'fanout', message)) return;

  const deliverRequests: Array<{ body: DeliveryQueueMessageV1 }> = [];
  for (const group of planned.groups) {
    const jobId = await computeDeliveryJobId(msg.activityId, group.endpoint);
    await upsertDeliveryJob(prisma, jobId, msg.activityId, group.endpoint);
    deliverRequests.push({ body: buildDeliverEndpointMessage(jobId) });
  }

  const resolveRequests = planned.unknownRecipients.map((apId) => ({
    body: buildResolveActorMessage(msg.activityId, apId),
  }));

  if (deliverRequests.length > 0) await env.DELIVERY_QUEUE.sendBatch(deliverRequests);
  if (resolveRequests.length > 0) await env.DELIVERY_QUEUE.sendBatch(resolveRequests);

  message.ack();
}

async function processResolveActor(prisma: PrismaClient, env: Env, msg: DeliveryResolveActorMessageV1, message: Message<DeliveryQueueMessageV1>): Promise<void> {
  if (!requireQueue(env, 'resolve_actor', message)) return;

  const cached = await prisma.actorCache.findUnique({
    where: { apId: msg.recipientActorApId },
    select: { apId: true, inbox: true, sharedInbox: true, lastFetchedAt: true },
  });
  const lastFetchedMs = safeParseIsoTimeMs(cached?.lastFetchedAt);
  const stale = lastFetchedMs === null || Date.now() - lastFetchedMs > DELIVERY_ENDPOINT_CACHE_TTL_MS;
  if (!cached || stale) {
    try {
      await fetchAndCacheRemoteActor(prisma, msg.recipientActorApId);
    } catch (e) {
      console.warn('[DeliveryQueue] resolve_actor fetch failed:', e);
      await sendQueueMessage(env, buildResolveActorMessage(msg.activityId, msg.recipientActorApId), 60);
      message.ack();
      return;
    }
  }

  const row = await prisma.actorCache.findUnique({
    where: { apId: msg.recipientActorApId },
    select: { inbox: true, sharedInbox: true },
  });
  const endpoint = resolvePreferredEndpoint(row);

  if (!endpoint) {
    console.warn('[DeliveryQueue] Could not resolve endpoint for actor:', msg.recipientActorApId);
    message.ack();
    return;
  }

  const jobId = await computeDeliveryJobId(msg.activityId, endpoint);
  await upsertDeliveryJob(prisma, jobId, msg.activityId, endpoint);
  await sendQueueMessage(env, buildDeliverEndpointMessage(jobId));
  message.ack();
}

async function processReconcileJob(prisma: PrismaClient, env: Env, msg: DeliveryReconcileJobMessageV1, message: Message<DeliveryQueueMessageV1>): Promise<void> {
  if (!requireQueue(env, 'reconcile', message)) return;

  if (msg.reconcileAttempt > MAX_RECONCILE_ATTEMPTS) {
    message.ack();
    return;
  }

  const job = await prisma.deliveryQueue.findUnique({
    where: { id: msg.jobId },
    select: { id: true, status: true },
  });

  if (!job || job.status === 'delivered') {
    message.ack();
    return;
  }

  await prisma.deliveryQueue.update({
    where: { id: msg.jobId },
    data: {
      status: 'pending',
      error: null,
      lastAttemptAt: null,
      processingStartedAt: null,
      nextAttemptAt: nowIso(),
    },
  });

  await sendQueueMessage(env, buildDeliverEndpointMessage(msg.jobId));
  message.ack();
}

async function processDeliverEndpoint(
  prisma: PrismaClient,
  env: Env,
  msg: DeliveryDeliverEndpointMessageV1,
  message: Message<DeliveryQueueMessageV1>,
  bulkhead: Bulkhead
): Promise<void> {
  if (!requireQueue(env, 'deliver_endpoint', message)) return;

  const job = await prisma.deliveryQueue.findUnique({
    where: { id: msg.jobId },
    select: {
      id: true,
      activityApId: true,
      inboxUrl: true,
      attempts: true,
      status: true,
      nextAttemptAt: true,
      processingStartedAt: true,
    },
  });

  if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) {
    message.ack();
    return;
  }

  // Queue lag metric (p50/p95/p99 derived downstream).
  const scheduledMs = safeParseIsoTimeMs(msg.scheduledAt);
  if (scheduledMs !== null) {
    emitMetric('delivery_queue_lag_seconds', Math.max(0, (Date.now() - scheduledMs) / 1000), {
      endpoint_host: safeEndpointHost(job.inboxUrl) ?? 'unknown',
    });
  }

  // Respect job scheduling stored in DB (defense against early delivery).
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
    await failJob(prisma, job.id, 'invalid_endpoint', message);
    return;
  }

  // Circuit breaker (Phase 3)
  const circuit = await checkCircuit(prisma, endpoint);
  if (!circuit.allow) {
    emitMetric('delivery_circuit_open_count', 1, { endpoint_host: host });
    await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), circuit.deferSeconds);
    message.ack();
    return;
  }

  await bulkhead.acquire(host);
  try {
    // Mark processing (best-effort).
    await prisma.deliveryQueue.update({
      where: { id: job.id },
      data: {
        status: 'processing',
        processingStartedAt: nowIso(),
      },
    });

    const activity = await prisma.activity.findUnique({
      where: { apId: job.activityApId },
      select: { rawJson: true, actorApId: true },
    });
    if (!activity) {
      await failJob(prisma, job.id, 'activity_not_found', message);
      return;
    }

    const sender = await resolveSigningActor(prisma, activity.actorApId);
    if (!sender) {
      await failJob(prisma, job.id, 'signing_actor_not_found', message);
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
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: {
          status: 'delivered',
          deliveredAt: now,
          error: null,
          lastAttemptAt: now,
          processingStartedAt: null,
        },
      });
      emitMetric('delivery_success', 1, { endpoint_host: host });
      await recordCircuitSuccess(prisma, endpoint);

      // Phase 1 shadow (staging-only): optional inbox probe for sharedInbox endpoints.
      // This must never affect delivery job outcome.
      if (job.attempts === 0) {
        try {
          await maybeShadowProbeInbox(prisma, env, {
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

    // 404/410: expire endpoint cache immediately (contract).
    if (status === 404 || status === 410) {
      try {
        await enqueueResolveForEndpointActors(prisma, env, job.activityApId, endpoint);
        await prisma.actorCache.updateMany({
          where: { sharedInbox: endpoint },
          data: { sharedInbox: null, lastFetchedAt: EPOCH_ISO },
        });
        await prisma.actorCache.updateMany({
          where: { inbox: endpoint },
          data: { lastFetchedAt: EPOCH_ISO },
        });
      } catch (e) {
        console.warn('[DeliveryQueue] endpoint invalidation failed:', e);
      }
    }

    // Non-retryable 4xx (except 429) => permanent failure.
    const nonRetryable = status !== null && status >= 400 && status < 500 && status !== 429;
    if (nonRetryable) {
      await failJob(prisma, job.id, errorMessage, message);
      emitMetric('delivery_success', 0, { endpoint_host: host, non_retryable: true, status });
      await recordCircuitFailure(prisma, endpoint);
      return;
    }

    // Retryable failure.
    const nextAttempts = await incrementDeliveryAttempts(prisma, job.id);
    await recordCircuitFailure(prisma, endpoint);

    if (nextAttempts >= DELIVERY_MAX_ATTEMPTS) {
      const now = nowIso();
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: { status: 'dead_letter', error: errorMessage, lastAttemptAt: now, processingStartedAt: null },
      });
      emitMetric('delivery_dead_letter', 1, { endpoint_host: host });

      await sendDlqMessage(env, {
        version: DELIVERY_QUEUE_MESSAGE_VERSION,
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
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

    await prisma.deliveryQueue.update({
      where: { id: job.id },
      data: { status: 'retry_wait', error: errorMessage, lastAttemptAt: nowIso(), processingStartedAt: null, nextAttemptAt },
    });

    emitMetric('delivery_success', 0, { endpoint_host: host, status: status ?? null });
    await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), delaySeconds);
    message.ack();
  } finally {
    bulkhead.release(host);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = items.slice();
  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) break;
        await fn(item);
      }
    })());
  }

  await Promise.all(workers);
}

async function incrementDeliveryAttempts(prisma: PrismaClient, jobId: string): Promise<number> {
  const updated = await prisma.deliveryQueue.update({
    where: { id: jobId },
    data: {
      attempts: { increment: 1 },
    },
    select: { attempts: true },
  });
  return updated.attempts;
}

export async function handleDeliveryQueueBatch(
  batch: MessageBatch<DeliveryQueueMessageV1>,
  env: Env
): Promise<void> {
  const prisma = env.PRISMA ?? getPrismaD1(env.DB);
  const bulkhead = new Bulkhead(BULKHEAD_GLOBAL_CONCURRENCY, BULKHEAD_PER_DOMAIN);

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
          await processFanoutFollowers(prisma, env, body, message);
          break;
        case 'resolve_actor':
          await processResolveActor(prisma, env, body, message);
          break;
        case 'reconcile_job':
          await processReconcileJob(prisma, env, body, message);
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
      await processDeliverEndpoint(prisma, env, m.body as DeliveryDeliverEndpointMessageV1, m, bulkhead);
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
  const prisma = env.PRISMA ?? getPrismaD1(env.DB);

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
    // Schedule a re-attempt after 6h. The reconcile job will reset and re-enqueue.
    try {
      await sendQueueMessage(env, buildReconcileJobMessage(body.jobId, 1), 6 * 60 * 60);
    } catch (e) {
      console.warn('[DeliveryDLQ] Failed to schedule reconciliation:', e);
    }

    message.ack();
  }
}
