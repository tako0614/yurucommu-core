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
  type DeliveryDeliverEndpointMessageV1,
  type DeliveryQueueMessageV1,
  type DeliveryDlqMessageV1,
  isDeliveryQueueMessageV1,
  isDeliveryDlqMessageV1,
} from './types';
import {
  computeDeliveryJobId,
  computeRetryDelaySeconds,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from './utils';

const DELIVERY_HTTP_TIMEOUT_MS = 8000;

// Bulkhead: per-domain concurrent delivery limit (Phase 3)
const BULKHEAD_PER_DOMAIN = 3;
// Global concurrency for delivery execution within a single batch.
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

function queueAvailable(env: Env): env is Env & { DELIVERY_QUEUE: Queue<DeliveryQueueMessageV1>; DELIVERY_DLQ: Queue<DeliveryDlqMessageV1> } {
  return Boolean((env as unknown as { DELIVERY_QUEUE?: unknown }).DELIVERY_QUEUE) && Boolean((env as unknown as { DELIVERY_DLQ?: unknown }).DELIVERY_DLQ);
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

  const startedAt = Date.now();
  let response: Response | null = null;
  let error: unknown = null;
  try {
    const headers = await signRequest(params.sender.privateKeyPem, keyId, 'POST', inbox, params.body);
    response = await fetchWithTimeout(inbox, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/activity+json',
        'X-Yurucommu-Shadow-Probe': '1',
      },
      body: params.body,
      timeout: DELIVERY_HTTP_TIMEOUT_MS,
    });
  } catch (e) {
    error = e;
  }
  const latencyMs = Date.now() - startedAt;

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

export async function enqueueFanoutToFollowers(env: Env, activityId: string, followeeApId: string): Promise<void> {
  if (!queueAvailable(env)) {
    console.warn('[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Skipping enqueueFanoutToFollowers.');
    return;
  }

  const msg: DeliveryQueueMessageV1 = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: 'fanout_followers',
    activityId,
    followeeApId,
    scheduledAt: nowIso(),
  };
  await env.DELIVERY_QUEUE.send(msg);
}

export async function enqueueDeliveryToActor(env: Env, activityId: string, recipientActorApId: string): Promise<void> {
  if (!queueAvailable(env)) {
    console.warn('[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Skipping enqueueDeliveryToActor.');
    return;
  }

  const msg: DeliveryQueueMessageV1 = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: 'resolve_actor',
    activityId,
    recipientActorApId,
    scheduledAt: nowIso(),
  };
  await env.DELIVERY_QUEUE.send(msg);
}

async function sendDeliverEndpointMessage(env: Env, jobId: string, delaySeconds: number): Promise<void> {
  if (!queueAvailable(env)) return;
  const msg: DeliveryQueueMessageV1 = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: 'deliver_endpoint',
    jobId,
    scheduledAt: nowIso(),
  };
  await env.DELIVERY_QUEUE.send(msg, { delaySeconds });
}

async function sendResolveActorMessage(env: Env, activityId: string, recipientActorApId: string, delaySeconds: number): Promise<void> {
  if (!queueAvailable(env)) return;
  const msg: DeliveryQueueMessageV1 = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: 'resolve_actor',
    activityId,
    recipientActorApId,
    scheduledAt: nowIso(),
  };
  await env.DELIVERY_QUEUE.send(msg, { delaySeconds });
}

async function sendReconcileJobMessage(env: Env, jobId: string, reconcileAttempt: number, delaySeconds: number): Promise<void> {
  if (!queueAvailable(env)) return;
  const msg: DeliveryQueueMessageV1 = {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: 'reconcile_job',
    jobId,
    reconcileAttempt,
    scheduledAt: nowIso(),
  };
  await env.DELIVERY_QUEUE.send(msg, { delaySeconds });
}

async function sendDlqMessage(env: Env, payload: DeliveryDlqMessageV1): Promise<void> {
  if (!queueAvailable(env)) return;
  await env.DELIVERY_DLQ.send(payload);
}

async function resolveSigningActor(
  prisma: PrismaClient,
  actorApId: string
): Promise<{ apId: string; privateKeyPem: string } | null> {
  const person = await prisma.actor.findUnique({
    where: { apId: actorApId },
    select: { apId: true, privateKeyPem: true },
  });
  if (person?.privateKeyPem) return { apId: person.apId, privateKeyPem: person.privateKeyPem };

  const group = await prisma.community.findUnique({
    where: { apId: actorApId },
    select: { apId: true, privateKeyPem: true },
  });
  if (group?.privateKeyPem) return { apId: group.apId, privateKeyPem: group.privateKeyPem };

  const instanceActor = await prisma.instanceActor.findUnique({
    where: { apId: actorApId },
    select: { apId: true, privateKeyPem: true },
  });
  if (instanceActor?.privateKeyPem) return { apId: instanceActor.apId, privateKeyPem: instanceActor.privateKeyPem };

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

  await prisma.actorCache.upsert({
    where: { apId: data.id },
    update: {
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
    },
    create: {
      apId: data.id,
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
    },
  });
}

async function upsertDeliveryJob(prisma: PrismaClient, jobId: string, activityId: string, endpoint: string): Promise<void> {
  await prisma.deliveryQueue.upsert({
    where: { id: jobId },
    update: {
      inboxUrl: endpoint,
      activityApId: activityId,
    },
    create: {
      id: jobId,
      inboxUrl: endpoint,
      activityApId: activityId,
      attempts: 0,
      nextAttemptAt: nowIso(),
      status: 'pending',
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
        body: {
          version: DELIVERY_QUEUE_MESSAGE_VERSION,
          type: 'resolve_actor',
          activityId,
          recipientActorApId: recipientApId,
          scheduledAt: nowIso(),
        } satisfies DeliveryQueueMessageV1,
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

async function processFanoutFollowers(prisma: PrismaClient, env: Env, msg: { activityId: string; followeeApId: string }, message: Message<DeliveryQueueMessageV1>): Promise<void> {
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

  if (!queueAvailable(env)) {
    console.warn('[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Dropping fanout job.');
    message.ack();
    return;
  }

  // Enqueue endpoint delivery jobs.
  const deliverRequests: Array<{ body: DeliveryQueueMessageV1; delaySeconds?: number }> = [];
  for (const group of planned.groups) {
    const endpoint = group.endpoint;
    const jobId = await computeDeliveryJobId(msg.activityId, endpoint);
    await upsertDeliveryJob(prisma, jobId, msg.activityId, endpoint);
    deliverRequests.push({
      body: {
        version: DELIVERY_QUEUE_MESSAGE_VERSION,
        type: 'deliver_endpoint',
        jobId,
        scheduledAt: nowIso(),
      },
    });
  }

  // Enqueue resolve jobs for unknown/stale recipients (refresh actor_cache via network).
  const resolveRequests = planned.unknownRecipients.map((apId) => ({
    body: {
      version: DELIVERY_QUEUE_MESSAGE_VERSION,
      type: 'resolve_actor',
      activityId: msg.activityId,
      recipientActorApId: apId,
      scheduledAt: nowIso(),
    } satisfies DeliveryQueueMessageV1,
  }));

  if (deliverRequests.length > 0) {
    await env.DELIVERY_QUEUE.sendBatch(deliverRequests);
  }
  if (resolveRequests.length > 0) {
    await env.DELIVERY_QUEUE.sendBatch(resolveRequests);
  }

  message.ack();
}

async function processResolveActor(prisma: PrismaClient, env: Env, msg: { activityId: string; recipientActorApId: string }, message: Message<DeliveryQueueMessageV1>): Promise<void> {
  if (!queueAvailable(env)) {
    console.warn('[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Dropping resolve_actor job.');
    message.ack();
    return;
  }

  // Refresh actor_cache if missing or stale.
  const cached = await prisma.actorCache.findUnique({
    where: { apId: msg.recipientActorApId },
    select: { apId: true, inbox: true, sharedInbox: true, lastFetchedAt: true },
  });
  const lastFetchedMs = safeParseIsoTimeMs(cached?.lastFetchedAt);
  const stale = lastFetchedMs === null || Date.now() - lastFetchedMs > 24 * 60 * 60 * 1000;
  if (!cached || stale) {
    try {
      await fetchAndCacheRemoteActor(prisma, msg.recipientActorApId);
    } catch (e) {
      console.warn('[DeliveryQueue] resolve_actor fetch failed:', e);
      // Backoff a bit before retrying the actor resolution.
      await sendResolveActorMessage(env, msg.activityId, msg.recipientActorApId, 60);
      message.ack();
      return;
    }
  }

  const row = await prisma.actorCache.findUnique({
    where: { apId: msg.recipientActorApId },
    select: { inbox: true, sharedInbox: true },
  });
  const endpoint = row?.sharedInbox && isSafeRemoteUrl(row.sharedInbox)
    ? row.sharedInbox
    : row?.inbox && isSafeRemoteUrl(row.inbox)
      ? row.inbox
      : null;

  if (!endpoint) {
    console.warn('[DeliveryQueue] Could not resolve endpoint for actor:', msg.recipientActorApId);
    message.ack();
    return;
  }

  const jobId = await computeDeliveryJobId(msg.activityId, endpoint);
  await upsertDeliveryJob(prisma, jobId, msg.activityId, endpoint);
  await sendDeliverEndpointMessage(env, jobId, 0);
  message.ack();
}

async function processReconcileJob(prisma: PrismaClient, env: Env, msg: { jobId: string; reconcileAttempt: number }, message: Message<DeliveryQueueMessageV1>): Promise<void> {
  if (!queueAvailable(env)) {
    console.warn('[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Dropping reconcile job.');
    message.ack();
    return;
  }

  const MAX_RECONCILE_ATTEMPTS = 5;
  if (msg.reconcileAttempt > MAX_RECONCILE_ATTEMPTS) {
    message.ack();
    return;
  }

  const job = await prisma.deliveryQueue.findUnique({
    where: { id: msg.jobId },
    select: {
      id: true,
      status: true,
      activityApId: true,
      inboxUrl: true,
    },
  });
  if (!job) {
    message.ack();
    return;
  }

  if (job.status === 'delivered') {
    message.ack();
    return;
  }

  // Reset and re-enqueue.
  await prisma.deliveryQueue.update({
    where: { id: msg.jobId },
    data: {
      status: 'pending',
      attempts: 0,
      error: null,
      lastAttemptAt: null,
      processingStartedAt: null,
      nextAttemptAt: nowIso(),
    },
  });

  await sendDeliverEndpointMessage(env, msg.jobId, 0);
  message.ack();
}

async function processDeliverEndpoint(
  prisma: PrismaClient,
  env: Env,
  msg: { jobId: string; scheduledAt: string },
  message: Message<DeliveryQueueMessageV1>,
  bulkhead: Bulkhead
): Promise<void> {
  if (!queueAvailable(env)) {
    console.warn('[DeliveryQueue] Missing DELIVERY_QUEUE/DELIVERY_DLQ bindings. Dropping deliver job.');
    message.ack();
    return;
  }

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
  if (!job) {
    message.ack();
    return;
  }

  if (job.status === 'delivered' || job.status === 'dead_letter' || job.status === 'failed') {
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
    await sendDeliverEndpointMessage(env, job.id, deferSeconds);
    message.ack();
    return;
  }

  // Avoid duplicate execution (stale processing recovery).
  if (job.status === 'processing') {
    const startedMs = safeParseIsoTimeMs(job.processingStartedAt);
    const STALE_PROCESSING_MS = 2 * 60 * 1000;
    if (startedMs !== null && Date.now() - startedMs < STALE_PROCESSING_MS) {
      // Another worker is likely processing it; re-check later.
      await sendDeliverEndpointMessage(env, job.id, 30);
      message.ack();
      return;
    }
  }

  const endpoint = job.inboxUrl;
  const host = safeEndpointHost(endpoint);
  if (!host) {
    await prisma.deliveryQueue.update({
      where: { id: job.id },
      data: { status: 'failed', error: 'invalid_endpoint', lastAttemptAt: nowIso() },
    });
    message.ack();
    return;
  }

  // Circuit breaker (Phase 3)
  const circuit = await checkCircuit(prisma, endpoint);
  if (!circuit.allow) {
    emitMetric('delivery_circuit_open_count', 1, { endpoint_host: host });
    await sendDeliverEndpointMessage(env, job.id, circuit.deferSeconds);
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
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: { status: 'failed', error: 'activity_not_found', lastAttemptAt: nowIso() },
      });
      message.ack();
      return;
    }

    const sender = await resolveSigningActor(prisma, activity.actorApId);
    if (!sender) {
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: { status: 'failed', error: 'signing_actor_not_found', lastAttemptAt: nowIso() },
      });
      message.ack();
      return;
    }

    const body = activity.rawJson;
    const keyId = `${sender.apId}#main-key`;
    const headers = await signRequest(sender.privateKeyPem, keyId, 'POST', endpoint, body);

    const startedAt = Date.now();
    let response: Response | null = null;
    let error: unknown = null;
    try {
      response = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/activity+json' },
        body,
        timeout: DELIVERY_HTTP_TIMEOUT_MS,
      });
    } catch (e) {
      error = e;
    }
    const latencyMs = Date.now() - startedAt;

    // Per-attempt latency point.
    emitMetric('delivery_latency_ms', latencyMs, {
      endpoint_host: host,
      ok: response?.ok ?? false,
      status: response?.status ?? null,
    });

    if (response?.ok) {
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: {
          status: 'delivered',
          deliveredAt: nowIso(),
          error: null,
          lastAttemptAt: nowIso(),
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
    const errorMessage = response
      ? `HTTP ${response.status}`
      : error instanceof Error
        ? error.message
        : 'delivery_error';

    // 404/410: expire endpoint cache immediately (contract).
    if (status === 404 || status === 410) {
      try {
        // Move to re-resolution queue: re-fetch affected actors and re-plan endpoints.
        await enqueueResolveForEndpointActors(prisma, env, job.activityApId, endpoint);

        await prisma.actorCache.updateMany({
          where: { sharedInbox: endpoint },
          data: { sharedInbox: null, lastFetchedAt: '1970-01-01T00:00:00.000Z' },
        });
        await prisma.actorCache.updateMany({
          where: { inbox: endpoint },
          data: { lastFetchedAt: '1970-01-01T00:00:00.000Z' },
        });
      } catch (e) {
        console.warn('[DeliveryQueue] endpoint invalidation failed:', e);
      }
    }

    // Non-retryable 4xx (except 429) => permanent failure.
    const nonRetryable = status !== null && status >= 400 && status < 500 && status !== 429;
    if (nonRetryable) {
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: errorMessage,
          lastAttemptAt: nowIso(),
          processingStartedAt: null,
        },
      });
      emitMetric('delivery_success', 0, { endpoint_host: host, non_retryable: true, status });
      await recordCircuitFailure(prisma, endpoint);
      message.ack();
      return;
    }

    // Retryable failure.
    const nextAttempts = job.attempts + 1;
    if (nextAttempts >= DELIVERY_MAX_ATTEMPTS) {
      await prisma.deliveryQueue.update({
        where: { id: job.id },
        data: {
          status: 'dead_letter',
          attempts: nextAttempts,
          error: errorMessage,
          lastAttemptAt: nowIso(),
          processingStartedAt: null,
        },
      });
      emitMetric('delivery_dead_letter', 1, { endpoint_host: host });
      await recordCircuitFailure(prisma, endpoint);

      await sendDlqMessage(env, {
        version: DELIVERY_QUEUE_MESSAGE_VERSION,
        type: 'dlq',
        jobId: job.id,
        activityId: job.activityApId,
        endpoint,
        attempts: nextAttempts,
        lastError: errorMessage,
        deadLetteredAt: nowIso(),
      });

      message.ack();
      return;
    }

    const delaySeconds = computeRetryDelaySeconds(nextAttempts);
    const nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toISOString();

    await prisma.deliveryQueue.update({
      where: { id: job.id },
      data: {
        status: 'retry_wait',
        attempts: nextAttempts,
        error: errorMessage,
        lastAttemptAt: nowIso(),
        processingStartedAt: null,
        nextAttemptAt,
      },
    });

    emitMetric('delivery_success', 0, { endpoint_host: host, status: status ?? null });
    await recordCircuitFailure(prisma, endpoint);

    await sendDeliverEndpointMessage(env, job.id, delaySeconds);
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
      if (body.type === 'fanout_followers') {
        await processFanoutFollowers(prisma, env, { activityId: body.activityId, followeeApId: body.followeeApId }, message);
      } else if (body.type === 'resolve_actor') {
        await processResolveActor(prisma, env, { activityId: body.activityId, recipientActorApId: body.recipientActorApId }, message);
      } else if (body.type === 'reconcile_job') {
        await processReconcileJob(prisma, env, { jobId: body.jobId, reconcileAttempt: body.reconcileAttempt }, message);
      } else {
        message.ack();
      }
    } catch (e) {
      console.error('[DeliveryQueue] Non-delivery message failed:', e);
      // Let queue config handle retry of planner/resolver (best-effort).
      message.retry({ delaySeconds: 60 });
    }
  }

  // Deliver endpoint messages with bulkhead+concurrency.
  const deliveryMessages = batch.messages.filter((m) => isDeliveryQueueMessageV1(m.body) && m.body.type === 'deliver_endpoint') as Array<Message<DeliveryQueueMessageV1>>;
  await runWithConcurrency(deliveryMessages, BULKHEAD_GLOBAL_CONCURRENCY, async (m) => {
    const body = m.body as DeliveryDeliverEndpointMessageV1;
    try {
      await processDeliverEndpoint(prisma, env, { jobId: body.jobId, scheduledAt: body.scheduledAt }, m, bulkhead);
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
      await sendReconcileJobMessage(env, body.jobId, 1, 6 * 60 * 60);
    } catch (e) {
      console.warn('[DeliveryDLQ] Failed to schedule reconciliation:', e);
    }

    message.ack();
  }
}
