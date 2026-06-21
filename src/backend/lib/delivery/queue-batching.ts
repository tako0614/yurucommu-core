/**
 * Queue batch processing - handles fanout, actor resolution, reconciliation,
 * and batch dispatch of delivery messages.
 */

import type { Message, MessageBatch } from "@cloudflare/workers-types";
import type { Env } from "../../types.ts";
import type { Database } from "../../../db/index.ts";
import { and, eq, or, sql } from "drizzle-orm";
import {
  activities,
  actorCache,
  communityMembers,
  deliveryQueue,
  follows,
  inbox as inboxTable,
} from "../../../db/index.ts";
import { isLocal, isSafeRemoteUrl } from "../../federation-helpers.ts";
import { isActorBlocked } from "../blocklist.ts";
import { planEndpointsFromActorCache } from "./planner.ts";
import {
  fetchAndUpsertActorCache,
  getInstanceFetchSignerByDb,
} from "../activitypub-actor-cache.ts";
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryFanoutCommunityMessageV1,
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
// Cap on resolve_actor self-requeues (each ~60s apart) before giving up on a
// permanently-unresolvable recipient — otherwise a dead host churns one queue
// message every 60s forever.
const MAX_RESOLVE_ATTEMPTS = 8;

const log = logger.child({ component: "delivery.batching" });

async function fetchAndCacheRemoteActor(
  db: Database,
  actorApId: string,
): Promise<void> {
  await fetchAndUpsertActorCache(db, actorApId, {
    timeout: DELIVERY_HTTP_TIMEOUT_MS,
    mode: "upsert",
    // Sign as the instance actor so resolving a delivery target on a
    // secure-mode instance doesn't 401 (unsigned otherwise).
    signer: (await getInstanceFetchSignerByDb(db)) ?? undefined,
  });
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

/**
 * Page through the accepted-follower graph of `followeeApId`, plan each page's
 * remote recipients against the actor cache, and enqueue `deliver_endpoint`
 * (known endpoints) + `resolve_actor` (unknown recipients) jobs directly.
 *
 * This is the shared core of follower fan-out. It is deliberately decoupled
 * from the queue message so it can also be driven SYNCHRONOUSLY by callers
 * that must capture a follower snapshot before the `follows` rows are deleted
 * (e.g. account deletion teardown in routes/actors.ts): the async
 * `fanout_followers` consumer would otherwise read an already-emptied graph
 * and deliver the Delete(actor) to zero followers.
 *
 * Returns the number of follower rows scanned and whether the per-invocation
 * cap was hit (so callers can log the same capped warning).
 */
export async function enqueueFollowerEndpointDeliveries(
  db: Database,
  queue: QueueEnv["DELIVERY_QUEUE"],
  baseUrl: string,
  activityId: string,
  followeeApId: string,
): Promise<{ processed: number; capped: boolean }> {
  // Page through accepted followers with a keyset cursor instead of loading
  // every row into memory at once. Each page is planned and dispatched in
  // ≤100-message chunks before the next page is read, bounding both memory
  // and per-call batch size.
  let cursor: string | null = null;
  let processed = 0;
  let capped = false;

  while (processed < FANOUT_MAX_FOLLOWERS) {
    const conditions = [
      eq(follows.followingApId, followeeApId),
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
          followee: followeeApId,
          activity: activityId,
        },
      });

      const deliverRequests: Array<{ body: DeliveryQueueMessageV1 }> = [];
      for (const group of planned.groups) {
        const jobId = await computeDeliveryJobId(activityId, group.endpoint);
        await upsertDeliveryJob(db, jobId, activityId, group.endpoint);
        deliverRequests.push({ body: buildDeliverEndpointMessage(jobId) });
      }

      const resolveRequests = planned.unknownRecipients.map((apId) => ({
        body: buildResolveActorMessage(activityId, apId),
      }));

      await sendQueueBatchChunked(queue, deliverRequests);
      await sendQueueBatchChunked(queue, resolveRequests);
    }

    processed += page.length;

    if (page.length < FANOUT_FOLLOWER_PAGE_SIZE) break;
    if (processed >= FANOUT_MAX_FOLLOWERS) {
      capped = true;
      break;
    }
  }

  return { processed, capped };
}

/**
 * Synchronously snapshot an actor's follower inboxes and enqueue per-endpoint
 * delivery jobs for `activityId`, BEFORE the caller deletes the `follows`
 * rows. Use this from teardown paths (account deletion) where the async
 * `fanout_followers` consumer would otherwise run after the follower graph is
 * gone and reach zero remote followers.
 *
 * Best-effort and queue-aware: if the delivery queue bindings are missing it
 * is a no-op (mirrors enqueueFanoutToFollowers' silent producer-unavailable
 * behavior). Never throws into the caller's teardown transaction — the caller
 * still wraps it so federation can never block local deletion.
 */
export async function snapshotAndEnqueueFollowerDeliveries(
  db: Database,
  env: Env,
  activityId: string,
  followeeApId: string,
): Promise<void> {
  const queue = (env as Partial<QueueEnv>).DELIVERY_QUEUE;
  if (!queue) {
    log.warn("Delivery queue unavailable; follower snapshot delivery skipped", {
      event: "delivery.fanout.snapshot_queue_unavailable",
      followee: followeeApId,
      activityId,
    });
    return;
  }

  const { processed, capped } = await enqueueFollowerEndpointDeliveries(
    db,
    queue,
    env.APP_URL,
    activityId,
    followeeApId,
  );

  if (capped) {
    log.warn("Follower snapshot delivery capped at max followers", {
      event: "delivery.fanout.snapshot_capped",
      followee: followeeApId,
      activityId,
      processed,
      max: FANOUT_MAX_FOLLOWERS,
    });
  }
}

export async function processFanoutFollowers(
  db: Database,
  env: Env,
  msg: DeliveryFanoutFollowersMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  if (!requireQueue(env, "fanout", message)) return;
  const queueEnv = env as QueueEnv;

  const { processed, capped } = await enqueueFollowerEndpointDeliveries(
    db,
    queueEnv.DELIVERY_QUEUE,
    env.APP_URL,
    msg.activityId,
    msg.followeeApId,
  );

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

/**
 * Fan an activity out to a community's audience instead of the author's
 * personal follower graph. The community is a Group-style actor:
 *
 *  - LOCAL recipients (accepted `communityMembers` hosted on this server,
 *    excluding the author) receive an inbox entry directly, so local members
 *    see the post even though it never touched the author's follower set.
 *  - REMOTE recipients (remote `communityMembers` plus accepted followers of
 *    the community actor in `follows`) are planned to their inbox/sharedInbox
 *    endpoints and delivered like a normal remote fan-out.
 *
 * This keeps reach == community: a community post is delivered to community
 * members, never to the author's plain followers.
 */
export async function processFanoutCommunity(
  db: Database,
  env: Env,
  msg: DeliveryFanoutCommunityMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  const baseUrl = env.APP_URL;

  if (!requireQueue(env, "fanout_community", message)) return;
  const queueEnv = env as QueueEnv;

  // Resolve the activity's author so we never echo the post back into the
  // author's own inbox.
  const activityRow = await db
    .select({ actorApId: activities.actorApId })
    .from(activities)
    .where(eq(activities.apId, msg.activityId))
    .get();
  const authorApId = activityRow?.actorApId ?? null;

  // ----- 1. Local members: deliver to their inbox directly. ----------------
  let memberCursor: string | null = null;
  while (true) {
    const conditions = [eq(communityMembers.communityApId, msg.communityApId)];
    if (memberCursor !== null) {
      conditions.push(sql`${communityMembers.actorApId} > ${memberCursor}`);
    }
    const page = await db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(and(...conditions))
      .orderBy(communityMembers.actorApId)
      .limit(FANOUT_FOLLOWER_PAGE_SIZE);

    if (page.length === 0) break;
    memberCursor = page[page.length - 1].actorApId;

    const localRecipients = page
      .map((m) => m.actorApId)
      .filter((apId) => isLocal(apId, baseUrl) && apId !== authorApId);

    if (localRecipients.length > 0) {
      const now = nowIso();
      await db
        .insert(inboxTable)
        .values(
          localRecipients.map((actorApId) => ({
            actorApId,
            activityApId: msg.activityId,
            read: 0,
            createdAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    if (page.length < FANOUT_FOLLOWER_PAGE_SIZE) break;
  }

  // ----- 2. Remote recipients: plan endpoints and deliver. -----------------
  // Remote members of the community plus accepted followers of the community
  // actor. A community member set is typically modest; followers of the
  // community actor capture remote servers that follow the Group to receive
  // its activities. Both are deduped before planning.
  const remoteRecipients = new Set<string>();

  // Remote community members.
  {
    let cursor: string | null = null;
    let processed = 0;
    while (processed < FANOUT_MAX_FOLLOWERS) {
      const conditions = [
        eq(communityMembers.communityApId, msg.communityApId),
      ];
      if (cursor !== null) {
        conditions.push(sql`${communityMembers.actorApId} > ${cursor}`);
      }
      const page = await db
        .select({ actorApId: communityMembers.actorApId })
        .from(communityMembers)
        .where(and(...conditions))
        .orderBy(communityMembers.actorApId)
        .limit(FANOUT_FOLLOWER_PAGE_SIZE);
      if (page.length === 0) break;
      cursor = page[page.length - 1].actorApId;
      for (const m of page) {
        if (!isLocal(m.actorApId, baseUrl) && m.actorApId !== authorApId) {
          remoteRecipients.add(m.actorApId);
        }
      }
      processed += page.length;
      if (page.length < FANOUT_FOLLOWER_PAGE_SIZE) break;
    }
  }

  // Accepted followers of the community actor.
  {
    let cursor: string | null = null;
    let processed = 0;
    while (processed < FANOUT_MAX_FOLLOWERS) {
      const conditions = [
        eq(follows.followingApId, msg.communityApId),
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
      for (const f of page) {
        if (
          !isLocal(f.followerApId, baseUrl) &&
          f.followerApId !== authorApId
        ) {
          remoteRecipients.add(f.followerApId);
        }
      }
      processed += page.length;
      if (page.length < FANOUT_FOLLOWER_PAGE_SIZE) break;
    }
  }

  const remoteList = [...remoteRecipients];
  if (remoteList.length > 0) {
    // Announce-relay: remote followers receive the GROUP's Announce of the post
    // (when present) rather than the raw author activity, so it is attributed
    // to the community. Local members above kept the raw `activityId`.
    const remoteActivityId = msg.announceActivityId ?? msg.activityId;
    const planned = await planEndpointsFromActorCache(db, remoteList, {
      metricTags: {
        community: msg.communityApId,
        activity: remoteActivityId,
      },
    });

    const deliverRequests: Array<{ body: DeliveryQueueMessageV1 }> = [];
    for (const group of planned.groups) {
      const jobId = await computeDeliveryJobId(
        remoteActivityId,
        group.endpoint,
      );
      await upsertDeliveryJob(db, jobId, remoteActivityId, group.endpoint);
      deliverRequests.push({ body: buildDeliverEndpointMessage(jobId) });
    }

    const resolveRequests = planned.unknownRecipients.map((apId) => ({
      body: buildResolveActorMessage(remoteActivityId, apId),
    }));

    await sendQueueBatchChunked(queueEnv.DELIVERY_QUEUE, deliverRequests);
    await sendQueueBatchChunked(queueEnv.DELIVERY_QUEUE, resolveRequests);
  }

  // TODO(remote-inbox-optimization): when the community has a large remote
  // footprint, prefer delivering once to each remote server's shared inbox via
  // the community's own followers collection rather than expanding the full
  // member/follower set here. Local delivery and community audience/addressing
  // are already correct; this is purely a remote fan-out efficiency follow-up.

  message.ack();
}

export async function processResolveActor(
  db: Database,
  env: Env,
  msg: DeliveryResolveActorMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  if (!requireQueue(env, "resolve_actor", message)) return;

  // Defense-in-depth: the fanout/enqueue side already drops blocked recipients
  // via planEndpointsFromActorCache, but enforce the operator blocklist at the
  // resolve seam too so a re-resolved actor (or a domain blocked after enqueue)
  // never gets a delivery job. ACK silently — same posture as the inbox handler.
  if (await isActorBlocked(db, msg.recipientActorApId)) {
    message.ack();
    return;
  }

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
      // Bound the retry: a permanently-unresolvable recipient (dead host,
      // persistent 5xx, SSRF-blocked) must NOT re-enqueue a fresh resolve_actor
      // every 60s forever. Give up after MAX_RESOLVE_ATTEMPTS so the activity is
      // dropped for that recipient instead of churning the queue indefinitely.
      const nextAttempt = (msg.attempts ?? 0) + 1;
      if (nextAttempt > MAX_RESOLVE_ATTEMPTS) {
        log.warn("resolve_actor giving up after max attempts", {
          event: "delivery.resolve_actor.exhausted",
          actor: msg.recipientActorApId,
          activityId: msg.activityId,
          attempts: nextAttempt,
          error: e,
        });
        message.ack();
        return;
      }
      log.warn("resolve_actor fetch failed", {
        event: "delivery.resolve_actor.failed",
        actor: msg.recipientActorApId,
        activityId: msg.activityId,
        attempt: nextAttempt,
        error: e,
      });
      await sendQueueMessage(
        env,
        buildResolveActorMessage(
          msg.activityId,
          msg.recipientActorApId,
          nextAttempt,
        ),
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
      // Reset the attempt budget: a reconciled (dead-lettered) job still carries
      // attempts at its max, so without this its first retryable failure would
      // immediately re-dead-letter it with no real retry budget.
      attempts: 0,
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
