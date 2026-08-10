/**
 * Queue batch processing - handles fanout, actor resolution, reconciliation,
 * and batch dispatch of delivery messages.
 */

import type { Env } from "../../types.ts";
import type { IQueueMessage } from "../../runtime/queue.ts";
import type { Database } from "../../../db/index.ts";
import { and, eq, or, sql } from "drizzle-orm";
import {
  activities,
  actorCache,
  communityMembers,
  deliveryQueue,
  follows,
  inbox as inboxTable,
  insertMany,
  runBatch,
  type D1Statement,
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
  enqueuePendingDeliveryEndpointJobs,
  MAX_RECONCILE_ATTEMPTS,
  nowIso,
  type QueueEnv,
  requireQueue,
  sendQueueMessage,
  upsertDeliveryJob,
} from "./queue.ts";
import { logger } from "../logger.ts";
import {
  claimDeliveryResolutionJob,
  completeDeliveryResolutionJob,
  enqueueDeliveryResolutionJobs,
  enqueuePendingDeliveryResolutionJobs,
  MAX_RESOLVE_ATTEMPTS,
  retryDeliveryResolutionJob,
} from "./resolution-outbox.ts";
import {
  completeDeliveryFanoutJob,
  deliveryFanoutIntentFromMessage,
  getDeliveryFanoutState,
  resetDeliveryFanoutJob,
} from "./fanout-outbox.ts";

const DELIVERY_HTTP_TIMEOUT_MS = 8000;
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
  queue: QueueEnv["DELIVERY_QUEUE"] | undefined,
  baseUrl: string,
  activityId: string,
  followeeApId: string,
  startCursor: string | null = null,
): Promise<{
  processed: number;
  capped: boolean;
  nextCursor: string | null;
}> {
  // Page through accepted followers with a keyset cursor instead of loading
  // every row into memory at once. Each page is planned and dispatched in
  // ≤100-message chunks before the next page is read, bounding both memory
  // and per-call batch size.
  let cursor: string | null = startCursor;
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

      // Persist every durable first-hop row before the first Queue RPC. Queue
      // messages are only wakeups; losing or lacking the producer must never
      // erase the delivery authority for an irreversible account teardown.
      await enqueueDeliveryResolutionJobs(
        db,
        undefined,
        planned.unknownRecipients.map((recipientActorApId) => ({
          activityId,
          recipientActorApId,
        })),
      );

      if (queue) {
        await sendQueueBatchChunked(queue, deliverRequests);
        await enqueueDeliveryResolutionJobs(
          db,
          queue,
          planned.unknownRecipients.map((recipientActorApId) => ({
            activityId,
            recipientActorApId,
          })),
        );
      }
    }

    processed += page.length;

    if (page.length < FANOUT_FOLLOWER_PAGE_SIZE) break;
    if (processed >= FANOUT_MAX_FOLLOWERS) {
      capped = true;
      break;
    }
  }

  return { processed, capped, nextCursor: capped ? cursor : null };
}

/**
 * Synchronously snapshot an actor's follower inboxes and enqueue per-endpoint
 * delivery jobs for `activityId`, BEFORE the caller deletes the `follows`
 * rows. Use this from teardown paths (account deletion) where the async
 * `fanout_followers` consumer would otherwise run after the follower graph is
 * gone and reach zero remote followers.
 *
 * Persistence does not depend on Queue bindings: Queue messages are wakeups,
 * while delivery_queue / delivery_resolutions remain the retry authority after
 * the follower graph is erased. The full graph is snapshotted before any
 * producer RPC, so a producer outage cannot leave only the first page durable.
 */
export async function snapshotAndEnqueueFollowerDeliveries(
  db: Database,
  env: Env,
  activityId: string,
  followeeApId: string,
): Promise<void> {
  const queueEnv = env as Partial<QueueEnv>;
  const queue =
    queueEnv.DELIVERY_QUEUE && queueEnv.DELIVERY_DLQ
      ? queueEnv.DELIVERY_QUEUE
      : undefined;
  if (!queue) {
    log.warn(
      "Delivery queue unavailable; follower snapshot persisted without wakeups",
      {
        event: "delivery.fanout.snapshot_queue_unavailable",
        followee: followeeApId,
        activityId,
      },
    );
  }

  let cursor: string | null = null;
  let processed = 0;
  do {
    const page = await enqueueFollowerEndpointDeliveries(
      db,
      undefined,
      env.APP_URL,
      activityId,
      followeeApId,
      cursor,
    );
    processed += page.processed;
    cursor = page.nextCursor;
  } while (cursor !== null);

  if (processed > FANOUT_MAX_FOLLOWERS) {
    log.info("Follower snapshot continued across bounded pages", {
      event: "delivery.fanout.snapshot_continued",
      followee: followeeApId,
      activityId,
      processed,
    });
  }

  if (queue) {
    // Publish only after every follower page is durable. These bounded sweeps
    // wake the first tranche immediately; request/queue/cron recovery drains
    // any remaining rows from the same outboxes.
    try {
      await enqueuePendingDeliveryEndpointJobs(env, new Date(), {
        includeFreshPending: true,
      });
      await enqueuePendingDeliveryResolutionJobs(env);
    } catch (error) {
      log.error("Follower snapshot persisted but Queue wakeup failed", {
        event: "delivery.fanout.snapshot_wakeup_failed",
        followee: followeeApId,
        activityId,
        error,
      });
    }
  }
}

export async function processFanoutFollowers(
  db: Database,
  env: Env,
  msg: DeliveryFanoutFollowersMessageV1,
  message: IQueueMessage<DeliveryQueueMessageV1>,
): Promise<void> {
  const intent = deliveryFanoutIntentFromMessage(msg);
  const outboxState = await getDeliveryFanoutState(db, intent);
  if (outboxState === "terminal") {
    message.ack();
    return;
  }
  const activityExists = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(eq(activities.apId, msg.activityId))
    .get();
  if (!activityExists) {
    await completeDeliveryFanoutJob(
      db,
      intent,
      "discarded",
      "Activity was deleted before fanout completed",
    );
    message.ack();
    return;
  }
  if (!requireQueue(env, "fanout", message)) {
    await resetDeliveryFanoutJob(db, intent, "Queue bindings unavailable");
    return;
  }
  const queueEnv = env as QueueEnv;

  const { processed, capped, nextCursor } =
    await enqueueFollowerEndpointDeliveries(
      db,
      queueEnv.DELIVERY_QUEUE,
      env.APP_URL,
      msg.activityId,
      msg.followeeApId,
      msg.cursor ?? null,
    );

  if (capped && nextCursor !== null) {
    // Send the continuation before ACK. If this send fails, Cloudflare retries
    // the current message; deterministic endpoint job ids make that safe.
    await sendQueueMessage(env, {
      version: DELIVERY_QUEUE_MESSAGE_VERSION,
      type: "fanout_followers",
      activityId: msg.activityId,
      followeeApId: msg.followeeApId,
      cursor: nextCursor,
      scheduledAt: nowIso(),
    });
    log.info("Follower fanout continued from stable cursor", {
      event: "delivery.fanout.continued",
      followee: msg.followeeApId,
      activityId: msg.activityId,
      processed,
      cursor: nextCursor,
    });
  }

  if (!capped) {
    await completeDeliveryFanoutJob(db, intent);
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
  message: IQueueMessage<DeliveryQueueMessageV1>,
): Promise<void> {
  const baseUrl = env.APP_URL;

  const intent = deliveryFanoutIntentFromMessage(msg);
  const outboxState = await getDeliveryFanoutState(db, intent);
  if (outboxState === "terminal") {
    message.ack();
    return;
  }

  const activityExists = await db
    .select({ apId: activities.apId, actorApId: activities.actorApId })
    .from(activities)
    .where(eq(activities.apId, msg.activityId))
    .get();
  if (!activityExists) {
    await completeDeliveryFanoutJob(
      db,
      intent,
      "discarded",
      "Activity was deleted before fanout completed",
    );
    message.ack();
    return;
  }

  if (!requireQueue(env, "fanout_community", message)) {
    await resetDeliveryFanoutJob(db, intent, "Queue bindings unavailable");
    return;
  }
  const queueEnv = env as QueueEnv;

  const authorApId = activityExists.actorApId;
  const stage = msg.stage ?? "local_members";
  const cursor = msg.cursor ?? null;
  const enqueueContinuation = async (
    nextStage: NonNullable<DeliveryFanoutCommunityMessageV1["stage"]>,
    nextCursor: string | null,
  ) => {
    await sendQueueMessage(env, {
      version: DELIVERY_QUEUE_MESSAGE_VERSION,
      type: "fanout_community",
      activityId: msg.activityId,
      communityApId: msg.communityApId,
      ...(msg.announceActivityId
        ? { announceActivityId: msg.announceActivityId }
        : {}),
      stage: nextStage,
      ...(nextCursor ? { cursor: nextCursor } : {}),
      scheduledAt: nowIso(),
    });
  };

  if (stage === "local_members") {
    const conditions = [eq(communityMembers.communityApId, msg.communityApId)];
    if (cursor !== null) {
      conditions.push(sql`${communityMembers.actorApId} > ${cursor}`);
    }
    const page = await db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(and(...conditions))
      .orderBy(communityMembers.actorApId)
      .limit(FANOUT_FOLLOWER_PAGE_SIZE);
    const localRecipients = page
      .map((row) => row.actorApId)
      .filter((apId) => isLocal(apId, baseUrl) && apId !== authorApId);
    if (localRecipients.length > 0) {
      const now = nowIso();
      const statements = insertMany(
        db,
        inboxTable,
        localRecipients.map((actorApId) => ({
          actorApId,
          activityApId: msg.activityId,
          read: 0,
          createdAt: now,
        })),
        { conflict: "ignore" },
      );
      if (statements.length > 0) {
        await runBatch(db, statements as [D1Statement, ...D1Statement[]]);
      }
    }
    if (page.length === FANOUT_FOLLOWER_PAGE_SIZE) {
      await enqueueContinuation(
        "local_members",
        page[page.length - 1].actorApId,
      );
    } else {
      await enqueueContinuation("remote_members", null);
    }
    message.ack();
    return;
  }

  let pageActorApIds: string[];
  if (stage === "remote_members") {
    const conditions = [eq(communityMembers.communityApId, msg.communityApId)];
    if (cursor !== null) {
      conditions.push(sql`${communityMembers.actorApId} > ${cursor}`);
    }
    const page = await db
      .select({ actorApId: communityMembers.actorApId })
      .from(communityMembers)
      .where(and(...conditions))
      .orderBy(communityMembers.actorApId)
      .limit(FANOUT_FOLLOWER_PAGE_SIZE);
    pageActorApIds = page.map((row) => row.actorApId);
  } else {
    const conditions = [
      eq(follows.followingApId, msg.communityApId),
      eq(follows.status, "accepted"),
    ];
    if (cursor !== null) {
      conditions.push(sql`${follows.followerApId} > ${cursor}`);
    }
    const page = await db
      .select({ actorApId: follows.followerApId })
      .from(follows)
      .where(and(...conditions))
      .orderBy(follows.followerApId)
      .limit(FANOUT_FOLLOWER_PAGE_SIZE);
    pageActorApIds = page.map((row) => row.actorApId);
  }

  const remoteRecipients = [...new Set(pageActorApIds)].filter(
    (apId) => !isLocal(apId, baseUrl) && apId !== authorApId,
  );
  if (remoteRecipients.length > 0) {
    // Announce-relay: remote recipients receive the Group's Announce (when
    // present); local members above retain the raw author Activity.
    const remoteActivityId = msg.announceActivityId ?? msg.activityId;
    const planned = await planEndpointsFromActorCache(db, remoteRecipients, {
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
    await sendQueueBatchChunked(queueEnv.DELIVERY_QUEUE, deliverRequests);
    await enqueueDeliveryResolutionJobs(
      db,
      queueEnv.DELIVERY_QUEUE,
      planned.unknownRecipients.map((recipientActorApId) => ({
        activityId: remoteActivityId,
        recipientActorApId,
      })),
    );
  }

  if (pageActorApIds.length === FANOUT_FOLLOWER_PAGE_SIZE) {
    await enqueueContinuation(stage, pageActorApIds[pageActorApIds.length - 1]);
  } else if (stage === "remote_members") {
    await enqueueContinuation("remote_followers", null);
  } else {
    await completeDeliveryFanoutJob(db, intent);
  }

  // TODO(remote-inbox-optimization): prefer one shared-inbox delivery per
  // remote server when a community has a very large remote footprint. The
  // stage/cursor lifecycle above is complete; this is an efficiency follow-up.
  message.ack();
}

export async function processResolveActor(
  db: Database,
  env: Env,
  msg: DeliveryResolveActorMessageV1,
  message: IQueueMessage<DeliveryQueueMessageV1>,
): Promise<void> {
  if (!requireQueue(env, "resolve_actor", message)) return;

  const resolutionClaim = await claimDeliveryResolutionJob(
    db,
    msg.activityId,
    msg.recipientActorApId,
  );
  if (resolutionClaim.state === "terminal") {
    message.ack();
    return;
  }
  if (
    resolutionClaim.state === "deferred" ||
    resolutionClaim.state === "busy"
  ) {
    message.retry({ delaySeconds: resolutionClaim.delaySeconds });
    return;
  }
  const managedClaim =
    resolutionClaim.state === "claimed" ? resolutionClaim : null;

  // A projection cascade may delete the Activity while an old resolve message
  // remains in flight. Never recreate delivery work for a deleted Activity.
  const activityExists = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(eq(activities.apId, msg.activityId))
    .get();
  if (!activityExists) {
    if (managedClaim) {
      await completeDeliveryResolutionJob(
        db,
        managedClaim,
        "discarded",
        "activity_not_found",
      );
    }
    message.ack();
    return;
  }

  // Defense-in-depth: the fanout/enqueue side already drops blocked recipients
  // via planEndpointsFromActorCache, but enforce the operator blocklist at the
  // resolve seam too so a re-resolved actor (or a domain blocked after enqueue)
  // never gets a delivery job. ACK silently — same posture as the inbox handler.
  if (await isActorBlocked(db, msg.recipientActorApId)) {
    if (managedClaim) {
      await completeDeliveryResolutionJob(
        db,
        managedClaim,
        "discarded",
        "recipient_blocked",
      );
    }
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
      if (managedClaim) {
        const result = await retryDeliveryResolutionJob(db, managedClaim, e);
        const nextAttempt = managedClaim.attempts + 1;
        if (!result.owned) {
          message.ack();
          return;
        }
        if (result.terminal) {
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
        // The retry intent is already durable. Ask the current queue message to
        // retry too; if that signal is lost, the outbox sweep republishes it.
        message.retry({ delaySeconds: 60 });
        return;
      }

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
    if (managedClaim) {
      await completeDeliveryResolutionJob(
        db,
        managedClaim,
        "discarded",
        "endpoint_unresolved",
      );
    }
    message.ack();
    return;
  }

  const jobId = await computeDeliveryJobId(msg.activityId, endpoint);
  await upsertDeliveryJob(db, jobId, msg.activityId, endpoint);
  await sendQueueMessage(env, buildDeliverEndpointMessage(jobId));
  if (managedClaim) {
    await completeDeliveryResolutionJob(db, managedClaim, "resolved");
  }
  message.ack();
}

export async function processReconcileJob(
  db: Database,
  env: Env,
  msg: DeliveryReconcileJobMessageV1,
  message: IQueueMessage<DeliveryQueueMessageV1>,
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

  // Carry the reconcile-cycle count forward on the revived delivery so that, if
  // it dead-letters again, the next DLQ message advances the budget (and the
  // loop terminates after MAX_RECONCILE_ATTEMPTS) instead of resetting to 1.
  await sendQueueMessage(
    env,
    buildDeliverEndpointMessage(msg.jobId, msg.reconcileAttempt),
  );
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
