/**
 * Queue batch processing - handles fanout, actor resolution, reconciliation,
 * and batch dispatch of delivery messages.
 */

import type { Message, MessageBatch } from "@cloudflare/workers-types";
import type { Env } from "../../types.ts";
import type { Database } from "../../../db/index.ts";
import { and, eq, or, sql } from "drizzle-orm";
import { actorCache, deliveryQueue, follows } from "../../../db/index.ts";
import {
  fetchWithTimeout,
  isLocal,
  isSafeRemoteUrl,
} from "../../federation-helpers.ts";
import { planEndpointsFromActorCache } from "./planner.ts";
import { tryParseRemoteActor } from "../activitypub-validators.ts";
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryFanoutFollowersMessageV1,
  type DeliveryQueueMessageV1,
  type DeliveryReconcileJobMessageV1,
  type DeliveryResolveActorMessageV1,
} from "./types.ts";
import {
  computeDeliveryJobId,
  DELIVERY_ENDPOINT_CACHE_TTL_MS,
  safeParseIsoTimeMs,
} from "./transformers.ts";
import {
  buildDeliverEndpointMessage,
  buildResolveActorMessage,
  nowIso,
  type QueueEnv,
  requireQueue,
  sendQueueMessage,
  upsertDeliveryJob,
} from "./queue.ts";
import { logger } from "../logger.ts";

const DELIVERY_HTTP_TIMEOUT_MS = 8000;
const MAX_RECONCILE_ATTEMPTS = 5;

const log = logger.child({ component: "delivery.batching" });

async function fetchAndCacheRemoteActor(
  db: Database,
  actorApId: string,
): Promise<void> {
  if (!isSafeRemoteUrl(actorApId)) return;

  const res = await fetchWithTimeout(actorApId, {
    headers: { Accept: "application/activity+json, application/ld+json" },
    timeout: DELIVERY_HTTP_TIMEOUT_MS,
  });
  if (!res.ok) return;

  const raw: unknown = await res.json();
  const data = tryParseRemoteActor(raw);
  if (!data || data.id !== actorApId) return;
  if (!data.inbox || !isSafeRemoteUrl(data.inbox)) return;

  const actorFields = {
    type: data.type || "Person",
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

  await db
    .insert(actorCache)
    .values({ apId: data.id, ...actorFields })
    .onConflictDoUpdate({ target: actorCache.apId, set: actorFields });
}

function resolvePreferredEndpoint(
  row: { inbox: string | null; sharedInbox: string | null } | null,
): string | null {
  if (row?.sharedInbox && isSafeRemoteUrl(row.sharedInbox)) {
    return row.sharedInbox;
  }
  if (row?.inbox && isSafeRemoteUrl(row.inbox)) return row.inbox;
  return null;
}

// Fan-out is paginated and chunked so a single popular-actor delivery cannot
// (a) materialize an unbounded follower set in one Worker invocation, nor
// (b) exceed Cloudflare Queues' 100-messages-per-`sendBatch` limit (which
// would throw before `message.ack()` and retry-loop forever). Mirrors the
// page/chunk/cap pattern in `enqueueResolveForEndpointActors`.
const FANOUT_FOLLOWER_PAGE_SIZE = 200;
const FANOUT_SEND_BATCH_SIZE = 100;
const FANOUT_MAX_FOLLOWERS = 20_000;

async function sendQueueBatchChunked(
  queue: QueueEnv["DELIVERY_QUEUE"],
  requests: Array<{ body: DeliveryQueueMessageV1 }>,
): Promise<void> {
  for (let i = 0; i < requests.length; i += FANOUT_SEND_BATCH_SIZE) {
    await queue.sendBatch(requests.slice(i, i + FANOUT_SEND_BATCH_SIZE));
  }
}

export async function processFanoutFollowers(
  db: Database,
  env: Env,
  msg: DeliveryFanoutFollowersMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  const baseUrl = env.APP_URL;

  if (!requireQueue(env, "fanout", message)) return;
  const queueEnv = env as QueueEnv;

  // Page through accepted followers with a keyset cursor instead of loading
  // every row into memory at once. Each page is planned and dispatched in
  // ≤100-message chunks before the next page is read, bounding both memory
  // and per-call batch size.
  let cursor: string | null = null;
  let processed = 0;
  let capped = false;

  while (processed < FANOUT_MAX_FOLLOWERS) {
    const conditions = [
      eq(follows.followingApId, msg.followeeApId),
      eq(follows.status, "accepted"),
    ];
    if (cursor !== null) {
      conditions.push(sql`${follows.followerApId} > ${cursor}`);
    }

    const page = await db
      .select({ followerApId: follows.followerApId })
      .from(follows)
      .where(and(...conditions))
      .orderBy(follows.followerApId)
      .limit(FANOUT_FOLLOWER_PAGE_SIZE);

    if (page.length === 0) break;

    cursor = page[page.length - 1].followerApId;

    // Deduplicate within the page and drop local recipients (no remote
    // delivery needed for local followers).
    const recipientApIds = [...new Set(page.map((f) => f.followerApId))].filter(
      (apId) => !isLocal(apId, baseUrl),
    );

    if (recipientApIds.length > 0) {
      const planned = await planEndpointsFromActorCache(db, recipientApIds, {
        metricTags: {
          followee: msg.followeeApId,
          activity: msg.activityId,
        },
      });

      const deliverRequests: Array<{ body: DeliveryQueueMessageV1 }> = [];
      for (const group of planned.groups) {
        const jobId = await computeDeliveryJobId(
          msg.activityId,
          group.endpoint,
        );
        await upsertDeliveryJob(db, jobId, msg.activityId, group.endpoint);
        deliverRequests.push({ body: buildDeliverEndpointMessage(jobId) });
      }

      const resolveRequests = planned.unknownRecipients.map((apId) => ({
        body: buildResolveActorMessage(msg.activityId, apId),
      }));

      await sendQueueBatchChunked(queueEnv.DELIVERY_QUEUE, deliverRequests);
      await sendQueueBatchChunked(queueEnv.DELIVERY_QUEUE, resolveRequests);
    }

    processed += page.length;

    if (page.length < FANOUT_FOLLOWER_PAGE_SIZE) break;
    if (processed >= FANOUT_MAX_FOLLOWERS) {
      capped = true;
      break;
    }
  }

  if (capped) {
    // Extremely large follower sets are capped per invocation to keep the
    // Worker within CPU/time limits. Endpoint-deduped delivery jobs are
    // idempotent (computeDeliveryJobId + upsertDeliveryJob), and the planner
    // re-enqueues any still-unknown recipients on the next fanout, so capped
    // followers are re-planned on the actor's next delivery rather than lost
    // silently.
    log.warn("Fanout capped at max followers for one invocation", {
      event: "delivery.fanout.capped",
      followee: msg.followeeApId,
      activityId: msg.activityId,
      processed,
      max: FANOUT_MAX_FOLLOWERS,
    });
  }

  message.ack();
}

export async function processResolveActor(
  db: Database,
  env: Env,
  msg: DeliveryResolveActorMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  if (!requireQueue(env, "resolve_actor", message)) return;

  const cached = await db
    .select({
      apId: actorCache.apId,
      inbox: actorCache.inbox,
      sharedInbox: actorCache.sharedInbox,
      lastFetchedAt: actorCache.lastFetchedAt,
    })
    .from(actorCache)
    .where(eq(actorCache.apId, msg.recipientActorApId))
    .get();
  const lastFetchedMs = safeParseIsoTimeMs(cached?.lastFetchedAt ?? null);
  const stale =
    lastFetchedMs === null ||
    Date.now() - lastFetchedMs > DELIVERY_ENDPOINT_CACHE_TTL_MS;
  if (!cached || stale) {
    try {
      await fetchAndCacheRemoteActor(db, msg.recipientActorApId);
    } catch (e) {
      log.warn("resolve_actor fetch failed", {
        event: "delivery.resolve_actor.failed",
        actor: msg.recipientActorApId,
        activityId: msg.activityId,
        error: e,
      });
      await sendQueueMessage(
        env,
        buildResolveActorMessage(msg.activityId, msg.recipientActorApId),
        60,
      );
      message.ack();
      return;
    }
  }

  const row = await db
    .select({
      inbox: actorCache.inbox,
      sharedInbox: actorCache.sharedInbox,
    })
    .from(actorCache)
    .where(eq(actorCache.apId, msg.recipientActorApId))
    .get();
  const endpoint = resolvePreferredEndpoint(row ?? null);

  if (!endpoint) {
    log.warn("Could not resolve endpoint for actor", {
      event: "delivery.endpoint.unresolved",
      actor: msg.recipientActorApId,
      activityId: msg.activityId,
    });
    message.ack();
    return;
  }

  const jobId = await computeDeliveryJobId(msg.activityId, endpoint);
  await upsertDeliveryJob(db, jobId, msg.activityId, endpoint);
  await sendQueueMessage(env, buildDeliverEndpointMessage(jobId));
  message.ack();
}

export async function processReconcileJob(
  db: Database,
  env: Env,
  msg: DeliveryReconcileJobMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  if (!requireQueue(env, "reconcile", message)) return;

  if (msg.reconcileAttempt > MAX_RECONCILE_ATTEMPTS) {
    message.ack();
    return;
  }

  const job = await db
    .select({
      id: deliveryQueue.id,
      status: deliveryQueue.status,
    })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, msg.jobId))
    .get();

  if (!job || job.status === "delivered") {
    message.ack();
    return;
  }

  await db
    .update(deliveryQueue)
    .set({
      status: "pending",
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
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.slice();
  const workers: Promise<void>[] = [];

  for (let i = 0; i < concurrency; i++) {
    workers.push(
      (async () => {
        while (queue.length > 0) {
          const item = queue.shift();
          if (!item) break;
          await fn(item);
        }
      })(),
    );
  }

  await Promise.all(workers);
}
