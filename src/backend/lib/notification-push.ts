import type { Message } from "@cloudflare/workers-types";
import { and, asc, eq, exists, inArray, lte, ne, sql } from "drizzle-orm";

import {
  activities,
  affectedRowCount,
  communityMembers,
  inbox,
  notificationPushers,
  notificationPushJobs,
  objectRecipients,
  objects,
  type Database,
} from "../../db/index.ts";
import type { Actor, Env } from "../types.ts";
import {
  isLoopbackGatewayUrl,
  normalizeGatewayUrl,
  type JsonObject,
  type ParsedNotificationPusherDeleteRequest,
  type ParsedNotificationPusherSetRequest,
  type SocialNotificationProduct,
} from "./notification-pusher-contract.ts";
import {
  DELIVERY_QUEUE_MESSAGE_VERSION,
  type DeliveryNotificationPushMessageV1,
  type DeliveryQueueMessageV1,
} from "./delivery/types.ts";
import { excludeBlockedMutedAuthors } from "./feed-exclude.ts";
import {
  NOTIFICATION_ACTIVITY_TYPES,
  notificationEligibilityWhere,
} from "./notification-eligibility.ts";
import { yurumeUnreadCounts } from "./unread-counts.ts";
import { logger } from "./logger.ts";
import { generateId } from "./oauth-utils.ts";

const log = logger.child({ component: "notification.push" });

export const MAX_NOTIFICATION_PUSHERS_PER_PRODUCT = 16;
export const MAX_NOTIFICATION_PUSHERS_PER_APP = 8;
export const MAX_NOTIFICATION_PUSH_DISPATCH = 16;
export const MAX_NOTIFICATION_PUSH_ATTEMPTS = 5;
export const NOTIFICATION_PUSHER_RETENTION_DAYS = 90;
export const NOTIFICATION_PUSH_JOB_RETENTION_DAYS = 90;
export const MAX_NOTIFICATION_PUSH_JOB_PURGE = 50;
export const MAX_NOTIFICATION_PUSHER_PURGE = 50;

const DEFAULT_GATEWAY_TIMEOUT_MS = 10_000;
const MAX_GATEWAY_RESPONSE_BYTES = 64 * 1024;
const MAX_QUEUE_SCAN = 50;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
// A 'queued'/'processing' row whose queue message is GONE (auto-dead-lettered
// after max retries with the raw body, dropped after queue retention, consumer
// down long enough) is otherwise unreachable: the sweep sends only
// pending/retry_wait and message-based recovery needs a message. Reclaim such
// rows to 'pending' once they are far staler than any live in-flight state —
// a live processing owner refreshes its lease before every gateway call
// (≤ ~40s between touches) and a queued message is consumed or dead-lettered
// within minutes.
const STALE_INFLIGHT_RECLAIM_MS = 15 * 60 * 1000;

export interface NotificationPusherRegistrationResponse {
  readonly id: string;
  readonly kind: "http";
  readonly app_id: string;
  readonly app_display_name?: string;
  readonly device_display_name?: string;
  readonly profile_tag?: string;
  readonly lang?: string;
  readonly data: JsonObject;
  readonly gateway_url: string;
  readonly product: SocialNotificationProduct;
  readonly scope: string | null;
  readonly registered_at: string;
  readonly last_seen_at: string;
}

type StoredPusher = {
  id: string;
  actorApId: string;
  product: string;
  appId: string;
  pushkey: string;
  pushkeyHash: string;
  dataJson: string;
  gatewayUrl: string;
};

type GatewayResult = {
  retryIds: string[];
  retryAfterSeconds: number;
  error: string | null;
};

type NotificationPushFormat = "event_id_only" | "full";

type GatewayDispatchGroup = {
  gatewayUrl: string;
  format: NotificationPushFormat;
  pushers: StoredPusher[];
};

type ProcessingLease = {
  jobId: string;
  processingToken: string;
};

export function isNotificationGatewayAllowed(env: Env, value: string): boolean {
  const normalized = normalizeGatewayUrl(value);
  if (!normalized) return false;
  if (isLoopbackGatewayUrl(normalized)) {
    return isTruthy(env.YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK);
  }
  const host = new URL(normalized).hostname.toLowerCase();
  const allowed = new Set(
    (env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean),
  );
  return allowed.has(host);
}

export async function registerNotificationPusher(
  db: Database,
  actor: Actor,
  input: ParsedNotificationPusherSetRequest,
): Promise<NotificationPusherRegistrationResponse> {
  const now = new Date().toISOString();
  const pushkeyHash = await sha256Hex(input.pusher.pushkey);

  // The device key is globally unique inside product+app. Reassigning that row
  // is one atomic upsert, so concurrent logins cannot leave duplicate owners.
  const existing = await db
    .select({
      id: notificationPushers.id,
      actorApId: notificationPushers.actorApId,
    })
    .from(notificationPushers)
    .where(
      and(
        eq(notificationPushers.product, input.product),
        eq(notificationPushers.appId, input.pusher.app_id),
        eq(notificationPushers.pushkeyHash, pushkeyHash),
      ),
    )
    .get();

  const sameActor = existing?.actorApId === actor.ap_id;
  if (!sameActor) {
    await enforcePusherQuota(
      db,
      actor.ap_id,
      input.product,
      input.pusher.app_id,
    );
  }
  const registrationId = sameActor ? existing.id : generateId(16);

  await db
    .insert(notificationPushers)
    .values({
      id: registrationId,
      actorApId: actor.ap_id,
      product: input.product,
      scope: input.scope,
      kind: "http",
      appId: input.pusher.app_id,
      pushkey: input.pusher.pushkey,
      pushkeyHash,
      appDisplayName: input.pusher.app_display_name ?? null,
      deviceDisplayName: input.pusher.device_display_name ?? null,
      profileTag: input.pusher.profile_tag ?? null,
      lang: input.pusher.lang ?? null,
      dataJson: JSON.stringify(input.storedData),
      gatewayUrl: input.gatewayUrl,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
        notificationPushers.product,
        notificationPushers.appId,
        notificationPushers.pushkeyHash,
      ],
      set: {
        id: registrationId,
        actorApId: actor.ap_id,
        kind: "http",
        pushkey: input.pusher.pushkey,
        scope: input.scope,
        appDisplayName: input.pusher.app_display_name ?? null,
        deviceDisplayName: input.pusher.device_display_name ?? null,
        profileTag: input.pusher.profile_tag ?? null,
        lang: input.pusher.lang ?? null,
        dataJson: JSON.stringify(input.storedData),
        gatewayUrl: input.gatewayUrl,
        ...(sameActor ? {} : { createdAt: now }),
        updatedAt: now,
        lastSeenAt: now,
      },
    });

  const row = await db
    .select()
    .from(notificationPushers)
    .where(
      and(
        eq(notificationPushers.actorApId, actor.ap_id),
        eq(notificationPushers.product, input.product),
        eq(notificationPushers.appId, input.pusher.app_id),
        eq(notificationPushers.pushkeyHash, pushkeyHash),
      ),
    )
    .get();
  if (!row) throw new Error("Failed to register notification pusher");
  return {
    id: row.id,
    kind: "http",
    app_id: row.appId,
    ...(row.appDisplayName ? { app_display_name: row.appDisplayName } : {}),
    ...(row.deviceDisplayName
      ? { device_display_name: row.deviceDisplayName }
      : {}),
    ...(row.profileTag ? { profile_tag: row.profileTag } : {}),
    ...(row.lang ? { lang: row.lang } : {}),
    data: parseStoredData(row.dataJson),
    gateway_url: row.gatewayUrl,
    product: input.product,
    scope: row.scope,
    registered_at: row.createdAt,
    last_seen_at: row.lastSeenAt,
  };
}

export async function deleteNotificationPusher(
  db: Database,
  actor: Actor,
  input: ParsedNotificationPusherDeleteRequest,
): Promise<void> {
  const hash = await sha256Hex(input.pushkey);
  await db
    .delete(notificationPushers)
    .where(
      and(
        eq(notificationPushers.actorApId, actor.ap_id),
        eq(notificationPushers.product, input.product),
        eq(notificationPushers.appId, input.appId),
        eq(notificationPushers.pushkeyHash, hash),
        eq(notificationPushers.pushkey, input.pushkey),
        input.scope === null
          ? undefined
          : eq(notificationPushers.scope, input.scope),
      ),
    );
}

async function enforcePusherQuota(
  db: Database,
  actorApId: string,
  product: SocialNotificationProduct,
  appId: string,
): Promise<void> {
  const [sameApp, sameProduct] = await Promise.all([
    db
      .select({ id: notificationPushers.id })
      .from(notificationPushers)
      .where(
        and(
          eq(notificationPushers.actorApId, actorApId),
          eq(notificationPushers.product, product),
          eq(notificationPushers.appId, appId),
        ),
      )
      .orderBy(asc(notificationPushers.createdAt)),
    db
      .select({ id: notificationPushers.id })
      .from(notificationPushers)
      .where(
        and(
          eq(notificationPushers.actorApId, actorApId),
          eq(notificationPushers.product, product),
        ),
      )
      .orderBy(asc(notificationPushers.createdAt)),
  ]);
  const evict = new Set<string>();
  for (const row of sameApp.slice(
    0,
    Math.max(0, sameApp.length + 1 - MAX_NOTIFICATION_PUSHERS_PER_APP),
  )) {
    evict.add(row.id);
  }
  const remainingProduct = sameProduct.filter((row) => !evict.has(row.id));
  for (const row of remainingProduct.slice(
    0,
    Math.max(
      0,
      remainingProduct.length + 1 - MAX_NOTIFICATION_PUSHERS_PER_PRODUCT,
    ),
  )) {
    evict.add(row.id);
  }
  if (evict.size > 0) {
    await db
      .delete(notificationPushers)
      .where(inArray(notificationPushers.id, [...evict]));
  }
}

export function buildNotificationPushMessage(
  jobId: string,
): DeliveryNotificationPushMessageV1 {
  return {
    version: DELIVERY_QUEUE_MESSAGE_VERSION,
    type: "notification_push",
    jobId,
    scheduledAt: new Date().toISOString(),
  };
}

/** Enqueue durable outbox rows. Safe to call after every request/queue batch. */
export async function enqueuePendingNotificationPushJobs(
  env: Env,
): Promise<number> {
  const db = env.DB_INSTANCE;
  // Expired rows are retained long enough to preserve the deterministic job
  // idempotency window, then removed opportunistically in a bounded batch.
  // This runs even without a Queue binding so disabled push delivery cannot
  // turn the outbox ledger into unbounded storage. Stale pushers are purged
  // here too (bounded), NOT inside per-job processing.
  await purgeExpiredNotificationPushJobs(db);
  await purgeExpiredNotificationPushers(db);
  if (!env.DELIVERY_QUEUE) return 0;
  const now = new Date().toISOString();

  // Reclaim in-flight rows whose queue message is gone (see
  // STALE_INFLIGHT_RECLAIM_MS). The reclaim consumes one attempt so a
  // crash-looping job terminates at the same MAX_NOTIFICATION_PUSH_ATTEMPTS
  // budget instead of ping-ponging forever.
  const staleCutoff = new Date(
    Date.now() - STALE_INFLIGHT_RECLAIM_MS,
  ).toISOString();
  await db
    .update(notificationPushJobs)
    .set({
      status: sql`CASE WHEN ${notificationPushJobs.attempts} + 1 >= ${MAX_NOTIFICATION_PUSH_ATTEMPTS} THEN 'failed' ELSE 'pending' END`,
      attempts: sql`${notificationPushJobs.attempts} + 1`,
      processingToken: null,
      lastError: sql`COALESCE(${notificationPushJobs.lastError}, 'reclaimed stale in-flight push job')`,
      updatedAt: now,
    })
    .where(
      and(
        inArray(notificationPushJobs.status, ["queued", "processing"]),
        lte(notificationPushJobs.updatedAt, staleCutoff),
      ),
    );

  // The trigger creates a job for EVERY unread inbox insert, including
  // recipients with zero pushers. Only enqueue jobs that can actually deliver;
  // pusher-less rows stay pending (no queue traffic, no processing cycle) and
  // age out through the retention purge above.
  const actorHasPusher = exists(
    db
      .select({ id: notificationPushers.id })
      .from(notificationPushers)
      .where(eq(notificationPushers.actorApId, notificationPushJobs.actorApId)),
  );
  const rows = await db
    .select({ id: notificationPushJobs.id })
    .from(notificationPushJobs)
    .where(
      and(
        inArray(notificationPushJobs.status, ["pending", "retry_wait"]),
        lte(notificationPushJobs.nextAttemptAt, now),
        actorHasPusher,
      ),
    )
    .orderBy(asc(notificationPushJobs.createdAt))
    .limit(MAX_QUEUE_SCAN);
  if (rows.length === 0) return 0;

  await env.DELIVERY_QUEUE.sendBatch(
    rows.map((row) => ({ body: buildNotificationPushMessage(row.id) })),
  );
  await db
    .update(notificationPushJobs)
    .set({ status: "queued", processingToken: null, updatedAt: now })
    .where(
      and(
        inArray(
          notificationPushJobs.id,
          rows.map((row) => row.id),
        ),
        inArray(notificationPushJobs.status, ["pending", "retry_wait"]),
      ),
    );
  return rows.length;
}

/**
 * Reset a dead-lettered push job so the durable outbox can retry it. Called by
 * the DLQ consumer when a `notification_push` message exhausted its Cloudflare
 * Queue retries with the RAW body (automatic dead-lettering) — without this,
 * the job row would be stranded in 'queued'/'processing' forever. Consumes one
 * attempt so a permanently failing job still terminates at the attempts budget.
 */
export async function recoverDeadLetteredNotificationPushJob(
  db: Database,
  jobId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const recovered = await db
    .update(notificationPushJobs)
    .set({
      status: sql`CASE WHEN ${notificationPushJobs.attempts} + 1 >= ${MAX_NOTIFICATION_PUSH_ATTEMPTS} THEN 'failed' ELSE 'retry_wait' END`,
      attempts: sql`${notificationPushJobs.attempts} + 1`,
      processingToken: null,
      nextAttemptAt: now,
      lastError: sql`COALESCE(${notificationPushJobs.lastError}, 'queue message dead-lettered')`,
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationPushJobs.id, jobId),
        inArray(notificationPushJobs.status, [
          "pending",
          "queued",
          "processing",
          "retry_wait",
        ]),
      ),
    );
  return affectedRowCount(recovered) > 0;
}

/** Remove at most one bounded batch of pushers idle past the retention window. */
export async function purgeExpiredNotificationPushers(
  db: Database,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - NOTIFICATION_PUSHER_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const stale = await db
    .select({ id: notificationPushers.id })
    .from(notificationPushers)
    .where(lte(notificationPushers.lastSeenAt, cutoff))
    .orderBy(asc(notificationPushers.lastSeenAt), asc(notificationPushers.id))
    .limit(MAX_NOTIFICATION_PUSHER_PURGE);
  if (stale.length === 0) return 0;
  const deleted = await db.delete(notificationPushers).where(
    and(
      inArray(
        notificationPushers.id,
        stale.map((row) => row.id),
      ),
      lte(notificationPushers.lastSeenAt, cutoff),
    ),
  );
  return affectedRowCount(deleted);
}

/**
 * Remove at most one bounded batch of jobs past the retention window. ANY
 * status qualifies: terminal rows have served their idempotency window, a
 * pending row that old belongs to a pusher-less recipient (never enqueued —
 * see the sweep's actorHasPusher filter), and no live in-flight state survives
 * 90 days (stale queued/processing rows are reclaimed within minutes).
 */
export async function purgeExpiredNotificationPushJobs(
  db: Database,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - NOTIFICATION_PUSH_JOB_RETENTION_DAYS * 86_400_000,
  ).toISOString();
  const expired = await db
    .select({ id: notificationPushJobs.id })
    .from(notificationPushJobs)
    .where(lte(notificationPushJobs.updatedAt, cutoff))
    .orderBy(asc(notificationPushJobs.updatedAt), asc(notificationPushJobs.id))
    .limit(MAX_NOTIFICATION_PUSH_JOB_PURGE);
  if (expired.length === 0) return 0;

  const deleted = await db.delete(notificationPushJobs).where(
    and(
      inArray(
        notificationPushJobs.id,
        expired.map((row) => row.id),
      ),
      lte(notificationPushJobs.updatedAt, cutoff),
    ),
  );
  return affectedRowCount(deleted);
}

export async function processNotificationPushJob(
  env: Env,
  body: DeliveryNotificationPushMessageV1,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  const db = env.DB_INSTANCE;
  let job = await db
    .select()
    .from(notificationPushJobs)
    .where(eq(notificationPushJobs.id, body.jobId))
    .get();
  if (!job || job.status === "delivered" || job.status === "failed") {
    message.ack();
    return;
  }

  const processingAgeMs = Date.now() - Date.parse(job.updatedAt);
  if (job.status === "processing") {
    if (processingAgeMs < STALE_PROCESSING_MS) {
      message.retry({ delaySeconds: 30 });
      return;
    }
    // Reclaim a stale processing row through an actual status transition.
    // Updating processing -> processing lets two workers that read the same
    // stale row both satisfy the old broad claim predicate and duplicate a
    // push. Only the worker that wins this processing -> queued CAS may proceed.
    const reclaimedAt = new Date().toISOString();
    const reclaimed = await db
      .update(notificationPushJobs)
      .set({
        status: "queued",
        processingToken: null,
        updatedAt: reclaimedAt,
      })
      .where(
        and(
          eq(notificationPushJobs.id, job.id),
          eq(notificationPushJobs.status, "processing"),
          eq(notificationPushJobs.updatedAt, job.updatedAt),
        ),
      );
    if (affectedRowCount(reclaimed) === 0) {
      message.retry({ delaySeconds: 30 });
      return;
    }
    job = {
      ...job,
      status: "queued",
      processingToken: null,
      updatedAt: reclaimedAt,
    };
  }

  const now = new Date().toISOString();
  const processingToken = generateId(16);
  const claimed = await db
    .update(notificationPushJobs)
    .set({ status: "processing", processingToken, updatedAt: now })
    .where(
      and(
        eq(notificationPushJobs.id, job.id),
        eq(notificationPushJobs.status, job.status),
        eq(notificationPushJobs.updatedAt, job.updatedAt),
        // Honor the backoff schedule: a duplicate message that survived a
        // double-enqueue race must not claim a retry_wait row before its
        // nextAttemptAt, which would bypass exponential backoff / Retry-After
        // and hammer a gateway that is actively rate-limiting us.
        lte(notificationPushJobs.nextAttemptAt, now),
      ),
    );
  if (affectedRowCount(claimed) === 0) {
    // Another Queue delivery owns this job now, or it is not yet due. Do not
    // ack the competing message permanently: a retry lets it observe the
    // terminal row, become due, or recover if that owner crashes after claiming.
    message.retry({ delaySeconds: 30 });
    return;
  }
  const lease: ProcessingLease = { jobId: job.id, processingToken };

  try {
    const explicitProduct =
      job.product === "yurucommu" || job.product === "yurume"
        ? job.product
        : null;
    const event = await loadPushEvent(
      db,
      job.actorApId,
      job.activityApId,
      explicitProduct,
    );
    if (!event) {
      await finishJob(db, lease, "notification is no longer eligible");
      message.ack();
      return;
    }

    const product: SocialNotificationProduct =
      explicitProduct ??
      (event.visibility === "direct" ? "yurume" : "yurucommu");
    let pendingIds = parsePendingIds(job.pendingPusherIdsJson);
    if (pendingIds === null) {
      // Retention purge of idle pushers is a bounded sweep in
      // enqueuePendingNotificationPushJobs, NOT an unbounded all-actor DELETE
      // on this hot per-job path. Stale rows simply resolve to zero deliveries
      // here and get reaped by the sweep.
      pendingIds = (
        await db
          .select({ id: notificationPushers.id })
          .from(notificationPushers)
          .where(
            and(
              eq(notificationPushers.actorApId, job.actorApId),
              eq(notificationPushers.product, product),
              lte(notificationPushers.createdAt, job.createdAt),
            ),
          )
          .orderBy(asc(notificationPushers.createdAt))
          .limit(MAX_NOTIFICATION_PUSH_DISPATCH)
      ).map((row) => row.id);
      const pendingIdsUpdated = await db
        .update(notificationPushJobs)
        .set({
          pendingPusherIdsJson: JSON.stringify(pendingIds),
          updatedAt: now,
        })
        .where(processingLeaseWhere(lease));
      if (affectedRowCount(pendingIdsUpdated) === 0) {
        message.ack();
        return;
      }
    }

    if (pendingIds.length === 0) {
      await finishJob(db, lease, null);
      message.ack();
      return;
    }

    const pushers = (await db
      .select({
        id: notificationPushers.id,
        actorApId: notificationPushers.actorApId,
        product: notificationPushers.product,
        appId: notificationPushers.appId,
        pushkey: notificationPushers.pushkey,
        pushkeyHash: notificationPushers.pushkeyHash,
        dataJson: notificationPushers.dataJson,
        gatewayUrl: notificationPushers.gatewayUrl,
      })
      .from(notificationPushers)
      .where(
        and(
          inArray(notificationPushers.id, pendingIds),
          eq(notificationPushers.actorApId, job.actorApId),
          eq(notificationPushers.product, product),
        ),
      )) as StoredPusher[];
    if (pushers.length === 0) {
      await finishJob(db, lease, null);
      message.ack();
      return;
    }

    const unread = await unreadCountForProduct(db, job.actorApId, product);
    const grouped = groupByGatewayAndFormat(pushers);
    const retryIds: string[] = [];
    let retryAfterSeconds = 0;
    const errors: string[] = [];
    for (const group of grouped.values()) {
      // A job can fan out to sixteen different gateways. Refresh the durable
      // lease before each bounded network call so a healthy worker cannot age
      // past the stale-reclaim window while progressing through that fanout.
      if (!(await refreshProcessingLease(db, lease))) {
        message.ack();
        return;
      }
      const outcome = await deliverGatewayGroup(
        env,
        db,
        group.gatewayUrl,
        group.pushers,
        group.format,
        {
          id: event.activityApId,
          type: event.visibility === "direct" ? "dm" : event.type.toLowerCase(),
          sender: event.actorApId,
          scopeId: event.objectApId,
          unread,
        },
      );
      retryIds.push(...outcome.retryIds);
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        outcome.retryAfterSeconds,
      );
      if (outcome.error) errors.push(outcome.error);
    }

    if (retryIds.length === 0) {
      await finishJob(db, lease, errors.length > 0 ? errors.join("; ") : null);
      message.ack();
      return;
    }

    const attempts = job.attempts + 1;
    const lastError =
      errors.join("; ").slice(0, 1024) || "retryable gateway failure";
    if (attempts >= MAX_NOTIFICATION_PUSH_ATTEMPTS) {
      const failed = await db
        .update(notificationPushJobs)
        .set({
          status: "failed",
          processingToken: null,
          attempts,
          pendingPusherIdsJson: JSON.stringify([...new Set(retryIds)]),
          lastError,
          updatedAt: new Date().toISOString(),
        })
        .where(processingLeaseWhere(lease));
      if (affectedRowCount(failed) === 0) {
        message.ack();
        return;
      }
      log.error("Notification push exhausted its retry budget", {
        event: "notification.push.exhausted",
        jobId: job.id,
        attempts,
      });
      message.ack();
      return;
    }

    const delaySeconds = Math.max(
      retryAfterSeconds,
      Math.min(12 * 60 * 60, 30 * 2 ** Math.max(0, attempts - 1)),
    );
    const nextAttemptAt = new Date(
      Date.now() + delaySeconds * 1000,
    ).toISOString();
    const retryScheduled = await db
      .update(notificationPushJobs)
      .set({
        status: "retry_wait",
        processingToken: null,
        attempts,
        pendingPusherIdsJson: JSON.stringify([...new Set(retryIds)]),
        nextAttemptAt,
        lastError,
        updatedAt: new Date().toISOString(),
      })
      .where(processingLeaseWhere(lease));
    if (affectedRowCount(retryScheduled) === 0) {
      message.ack();
      return;
    }
    message.retry({ delaySeconds });
  } catch (error) {
    const attempts = job.attempts + 1;
    const errorText = error instanceof Error ? error.message : String(error);
    if (attempts >= MAX_NOTIFICATION_PUSH_ATTEMPTS) {
      const failed = await db
        .update(notificationPushJobs)
        .set({
          status: "failed",
          processingToken: null,
          attempts,
          lastError: errorText.slice(0, 1024),
          updatedAt: new Date().toISOString(),
        })
        .where(processingLeaseWhere(lease));
      if (affectedRowCount(failed) === 0) {
        message.ack();
        return;
      }
      message.ack();
      return;
    }
    const delaySeconds = Math.min(12 * 60 * 60, 30 * 2 ** (attempts - 1));
    const retryScheduled = await db
      .update(notificationPushJobs)
      .set({
        status: "retry_wait",
        processingToken: null,
        attempts,
        nextAttemptAt: new Date(Date.now() + delaySeconds * 1000).toISOString(),
        lastError: errorText.slice(0, 1024),
        updatedAt: new Date().toISOString(),
      })
      .where(processingLeaseWhere(lease));
    if (affectedRowCount(retryScheduled) === 0) {
      message.ack();
      return;
    }
    message.retry({ delaySeconds });
  }
}

async function deliverGatewayGroup(
  env: Env,
  db: Database,
  gatewayUrl: string,
  pushers: StoredPusher[],
  format: NotificationPushFormat,
  event: {
    id: string;
    type: string;
    sender: string;
    scopeId: string | null;
    unread: number;
  },
): Promise<GatewayResult> {
  if (!isNotificationGatewayAllowed(env, gatewayUrl)) {
    return {
      retryIds: [],
      retryAfterSeconds: 0,
      error: "gateway is no longer operator-allowed",
    };
  }
  const data = pushers.map((row) => normalizedStoredData(row.dataJson));
  const eventIdOnly = format === "event_id_only";
  const payload = {
    notification: {
      event_id: event.id,
      room_id: event.scopeId ?? undefined,
      counts: { unread: event.unread },
      ...(!eventIdOnly
        ? {
            type: event.type,
            sender: event.sender,
            user_is_target: true,
            prio: "high",
          }
        : {}),
      devices: pushers.map((row, index) => ({
        app_id: row.appId,
        pushkey: row.pushkey,
        pushkey_ts: Math.floor(Date.now() / 1000),
        data: data[index],
      })),
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    parseTimeout(env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TIMEOUT_MS),
  );
  let response: Response;
  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    const canonical = normalizeGatewayUrl(
      env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_URL,
    );
    if (
      canonical === normalizeGatewayUrl(gatewayUrl) &&
      env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TOKEN &&
      new URL(gatewayUrl).protocol === "https:"
    ) {
      headers.set(
        "Authorization",
        `Bearer ${env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TOKEN}`,
      );
    }
    response = await fetch(gatewayUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "error",
      signal: controller.signal,
    });
  } catch (error) {
    return {
      retryIds: pushers.map((row) => row.id),
      retryAfterSeconds: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429 || response.status >= 500) {
    return {
      retryIds: pushers.map((row) => row.id),
      retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      error: `gateway HTTP ${response.status}`,
    };
  }
  if (!response.ok) {
    return {
      retryIds: [],
      retryAfterSeconds: 0,
      error: `gateway HTTP ${response.status}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await readResponseText(response, MAX_GATEWAY_RESPONSE_BYTES),
    );
  } catch (error) {
    return {
      retryIds: pushers.map((row) => row.id),
      retryAfterSeconds: 0,
      error:
        error instanceof Error ? error.message : "invalid gateway response",
    };
  }
  if (!parsed || typeof parsed !== "object") {
    return {
      retryIds: pushers.map((row) => row.id),
      retryAfterSeconds: 0,
      error: "invalid gateway response",
    };
  }
  const responseBody = parsed as Record<string, unknown>;
  const rejected = stringArray(responseBody.rejected);
  const retryable = stringArray(responseBody.retryable);
  const failed = stringArray(responseBody.failed);
  if (!rejected || !retryable || !failed) {
    return {
      retryIds: pushers.map((row) => row.id),
      retryAfterSeconds: 0,
      error: "invalid gateway result arrays",
    };
  }

  const byPushkey = new Map(pushers.map((row) => [row.pushkey, row]));
  for (const pushkey of rejected) {
    const row = byPushkey.get(pushkey);
    if (!row) continue;
    await db
      .delete(notificationPushers)
      .where(
        and(
          eq(notificationPushers.id, row.id),
          eq(notificationPushers.actorApId, row.actorApId),
          eq(notificationPushers.product, row.product),
          eq(notificationPushers.pushkeyHash, row.pushkeyHash),
          eq(notificationPushers.pushkey, row.pushkey),
        ),
      );
  }
  const terminal = new Set([...rejected, ...failed]);
  const retrySet = new Set(retryable);
  return {
    retryIds: pushers
      .filter((row) => retrySet.has(row.pushkey) && !terminal.has(row.pushkey))
      .map((row) => row.id),
    retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
    error: failed.length > 0 ? "gateway reported permanent failures" : null,
  };
}

async function loadPushEvent(
  db: Database,
  actorApId: string,
  activityApId: string,
  explicitProduct: SocialNotificationProduct | null,
) {
  const selectEvent = () =>
    db.select({
      activityApId: activities.apId,
      type: activities.type,
      actorApId: activities.actorApId,
      objectApId: activities.objectApId,
      objectType: objects.type,
      visibility: objects.visibility,
      conversation: objects.conversation,
    });

  if (explicitProduct !== null) {
    // Explicit jobs currently represent community talk, which intentionally
    // has no social-inbox row. It still observes per-recipient block/mute and
    // self-notification rules at delivery time.
    const currentCommunityMembership = db
      .select({ actorApId: communityMembers.actorApId })
      .from(objectRecipients)
      .innerJoin(
        communityMembers,
        eq(communityMembers.communityApId, objectRecipients.recipientApId),
      )
      .where(
        and(
          eq(objectRecipients.objectApId, activities.objectApId),
          eq(objectRecipients.type, "audience"),
          eq(communityMembers.actorApId, actorApId),
        ),
      );
    return selectEvent()
      .from(activities)
      .leftJoin(objects, eq(activities.objectApId, objects.apId))
      .where(
        and(
          eq(activities.apId, activityApId),
          ne(activities.actorApId, actorApId),
          inArray(activities.type, [...NOTIFICATION_ACTIVITY_TYPES]),
          exists(currentCommunityMembership),
          excludeBlockedMutedAuthors(db, actorApId, activities.actorApId),
        ),
      )
      .get();
  }

  // The inbox trigger intentionally captures every unread insert so it cannot
  // lose a notification in a route-specific crash window. Eligibility is
  // therefore re-checked here immediately before external delivery, using the
  // SAME shared predicate builder as the notification list/count. Direct
  // Creates remain eligible (archived DMs excepted) and route to Yurume below.
  return selectEvent()
    .from(inbox)
    .innerJoin(activities, eq(inbox.activityApId, activities.apId))
    .leftJoin(objects, eq(activities.objectApId, objects.apId))
    .where(
      and(
        eq(inbox.actorApId, actorApId),
        eq(inbox.activityApId, activityApId),
        ...notificationEligibilityWhere(db, actorApId, {
          direct: "unless-dm-archived",
        }),
      ),
    )
    .get();
}

/** Product-specific unread badge included in the event-id-only push payload. */
async function unreadCountForProduct(
  db: Database,
  actorApId: string,
  product: SocialNotificationProduct,
): Promise<number> {
  if (product === "yurume") {
    // Reuse the SAME helper as GET /api/dm/unread/count so the badge a push
    // sets can never drift from the badge the client computes on open.
    return (await yurumeUnreadCounts(db, actorApId)).total;
  }

  // Reuse the SAME eligibility predicate as the notification list/badge. A
  // Yurume DM row must never inflate the Yurucommu app badge (direct: exclude).
  const row = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(inbox)
    .innerJoin(activities, eq(inbox.activityApId, activities.apId))
    .leftJoin(objects, eq(activities.objectApId, objects.apId))
    .where(
      and(
        eq(inbox.actorApId, actorApId),
        eq(inbox.read, 0),
        ...notificationEligibilityWhere(db, actorApId, { direct: "exclude" }),
      ),
    )
    .get();
  return Number(row?.count ?? 0);
}

async function finishJob(
  db: Database,
  lease: ProcessingLease,
  lastError: string | null,
): Promise<boolean> {
  const now = new Date().toISOString();
  const finished = await db
    .update(notificationPushJobs)
    .set({
      status: "delivered",
      processingToken: null,
      pendingPusherIdsJson: "[]",
      lastError,
      deliveredAt: now,
      updatedAt: now,
    })
    .where(processingLeaseWhere(lease));
  return affectedRowCount(finished) > 0;
}

function processingLeaseWhere(lease: ProcessingLease) {
  return and(
    eq(notificationPushJobs.id, lease.jobId),
    eq(notificationPushJobs.status, "processing"),
    eq(notificationPushJobs.processingToken, lease.processingToken),
  );
}

async function refreshProcessingLease(
  db: Database,
  lease: ProcessingLease,
): Promise<boolean> {
  const refreshed = await db
    .update(notificationPushJobs)
    .set({ updatedAt: new Date().toISOString() })
    .where(processingLeaseWhere(lease));
  return affectedRowCount(refreshed) > 0;
}

function groupByGatewayAndFormat(
  pushers: StoredPusher[],
): Map<string, GatewayDispatchGroup> {
  const result = new Map<string, GatewayDispatchGroup>();
  for (const row of pushers) {
    const format = notificationPushFormat(parseStoredData(row.dataJson));
    const key = JSON.stringify([row.gatewayUrl, format]);
    const group = result.get(key) ?? {
      gatewayUrl: row.gatewayUrl,
      format,
      pushers: [],
    };
    group.pushers.push(row);
    result.set(key, group);
  }
  return result;
}

function parsePendingIds(value: string | null): string[] | null {
  if (value === null) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    return [];
  }
}

function parseStoredData(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : {};
  } catch {
    return {};
  }
}

function notificationPushFormat(data: JsonObject): NotificationPushFormat {
  return data.format === "full" ? "full" : "event_id_only";
}

function normalizedStoredData(value: string): JsonObject {
  const data = parseStoredData(value);
  return { ...data, format: notificationPushFormat(data) };
}

function stringArray(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value;
}

function parseTimeout(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_GATEWAY_TIMEOUT_MS;
  return Math.max(250, Math.min(30_000, Math.floor(parsed)));
}

function parseRetryAfter(value: string | null): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(12 * 60 * 60, Math.ceil(seconds));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.min(
    12 * 60 * 60,
    Math.max(0, Math.ceil((timestamp - Date.now()) / 1000)),
  );
}

async function readResponseText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("gateway response is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
