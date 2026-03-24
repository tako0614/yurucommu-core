/**
 * Queue batch processing - handles fanout, actor resolution, reconciliation,
 * and batch dispatch of delivery messages.
 */

import type { Message, MessageBatch } from '@cloudflare/workers-types';
import type { Env } from '../../types';
import type { Database } from '../../../db';
import { eq, and, or, sql } from 'drizzle-orm';
import { actorCache, follows, deliveryQueue } from '../../../db';
import { isLocal, isSafeRemoteUrl, fetchWithTimeout } from '../../utils';
import { planEndpointsFromActorCache } from './planner';
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryFanoutFollowersMessageV1,
  type DeliveryResolveActorMessageV1,
  type DeliveryReconcileJobMessageV1,
  type DeliveryQueueMessageV1,
} from './types';
import {
  DELIVERY_ENDPOINT_CACHE_TTL_MS,
  safeParseIsoTimeMs,
} from './utils';
import {
  type QueueEnv,
  requireQueue,
  sendQueueMessage,
  buildDeliverEndpointMessage,
  buildResolveActorMessage,
  nowIso,
  upsertDeliveryJob,
} from './queue';

const DELIVERY_HTTP_TIMEOUT_MS = 8000;
const MAX_RECONCILE_ATTEMPTS = 5;

async function fetchAndCacheRemoteActor(db: Database, actorApId: string): Promise<void> {
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

  await db.insert(actorCache)
    .values({ apId: data.id, ...actorFields })
    .onConflictDoUpdate({ target: actorCache.apId, set: actorFields });
}

function resolvePreferredEndpoint(row: { inbox: string | null; sharedInbox: string | null } | null): string | null {
  if (row?.sharedInbox && isSafeRemoteUrl(row.sharedInbox)) return row.sharedInbox;
  if (row?.inbox && isSafeRemoteUrl(row.inbox)) return row.inbox;
  return null;
}

export async function processFanoutFollowers(
  db: Database,
  env: Env,
  msg: DeliveryFanoutFollowersMessageV1,
  message: Message<DeliveryQueueMessageV1>
): Promise<void> {
  const baseUrl = env.APP_URL;

  const followerRows = await db.select({ followerApId: follows.followerApId })
    .from(follows)
    .where(
      and(
        eq(follows.followingApId, msg.followeeApId),
        eq(follows.status, 'accepted'),
      )
    );
  // Deduplicate followerApId
  const recipientApIds = [...new Set(followerRows.map((f) => f.followerApId))]
    .filter((apId) => !isLocal(apId, baseUrl));

  const planned = await planEndpointsFromActorCache(db, recipientApIds, {
    metricTags: {
      followee: msg.followeeApId,
      activity: msg.activityId,
    },
  });

  if (!requireQueue(env, 'fanout', message)) return;

  const deliverRequests: Array<{ body: DeliveryQueueMessageV1 }> = [];
  for (const group of planned.groups) {
    const { computeDeliveryJobId } = await import('./utils');
    const jobId = await computeDeliveryJobId(msg.activityId, group.endpoint);
    await upsertDeliveryJob(db, jobId, msg.activityId, group.endpoint);
    deliverRequests.push({ body: buildDeliverEndpointMessage(jobId) });
  }

  const resolveRequests = planned.unknownRecipients.map((apId) => ({
    body: buildResolveActorMessage(msg.activityId, apId),
  }));

  const queueEnv = env as QueueEnv;
  if (deliverRequests.length > 0) await queueEnv.DELIVERY_QUEUE.sendBatch(deliverRequests);
  if (resolveRequests.length > 0) await queueEnv.DELIVERY_QUEUE.sendBatch(resolveRequests);

  message.ack();
}

export async function processResolveActor(
  db: Database,
  env: Env,
  msg: DeliveryResolveActorMessageV1,
  message: Message<DeliveryQueueMessageV1>
): Promise<void> {
  if (!requireQueue(env, 'resolve_actor', message)) return;

  const cached = await db.select({
    apId: actorCache.apId,
    inbox: actorCache.inbox,
    sharedInbox: actorCache.sharedInbox,
    lastFetchedAt: actorCache.lastFetchedAt,
  })
    .from(actorCache)
    .where(eq(actorCache.apId, msg.recipientActorApId))
    .get();
  const lastFetchedMs = safeParseIsoTimeMs(cached?.lastFetchedAt ?? null);
  const stale = lastFetchedMs === null || Date.now() - lastFetchedMs > DELIVERY_ENDPOINT_CACHE_TTL_MS;
  if (!cached || stale) {
    try {
      await fetchAndCacheRemoteActor(db, msg.recipientActorApId);
    } catch (e) {
      console.warn('[DeliveryQueue] resolve_actor fetch failed:', e);
      await sendQueueMessage(env, buildResolveActorMessage(msg.activityId, msg.recipientActorApId), 60);
      message.ack();
      return;
    }
  }

  const row = await db.select({ inbox: actorCache.inbox, sharedInbox: actorCache.sharedInbox })
    .from(actorCache)
    .where(eq(actorCache.apId, msg.recipientActorApId))
    .get();
  const endpoint = resolvePreferredEndpoint(row ?? null);

  if (!endpoint) {
    console.warn('[DeliveryQueue] Could not resolve endpoint for actor:', msg.recipientActorApId);
    message.ack();
    return;
  }

  const { computeDeliveryJobId } = await import('./utils');
  const jobId = await computeDeliveryJobId(msg.activityId, endpoint);
  await upsertDeliveryJob(db, jobId, msg.activityId, endpoint);
  await sendQueueMessage(env, buildDeliverEndpointMessage(jobId));
  message.ack();
}

export async function processReconcileJob(
  db: Database,
  env: Env,
  msg: DeliveryReconcileJobMessageV1,
  message: Message<DeliveryQueueMessageV1>
): Promise<void> {
  if (!requireQueue(env, 'reconcile', message)) return;

  if (msg.reconcileAttempt > MAX_RECONCILE_ATTEMPTS) {
    message.ack();
    return;
  }

  const job = await db.select({ id: deliveryQueue.id, status: deliveryQueue.status })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, msg.jobId))
    .get();

  if (!job || job.status === 'delivered') {
    message.ack();
    return;
  }

  await db.update(deliveryQueue)
    .set({
      status: 'pending',
      error: null,
      lastAttemptAt: null,
      processingStartedAt: null,
      nextAttemptAt: nowIso(),
    })
    .where(eq(deliveryQueue.id, msg.jobId));

  await sendQueueMessage(env, buildDeliverEndpointMessage(msg.jobId));
  message.ack();
}

export async function runWithConcurrency<T>(
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
