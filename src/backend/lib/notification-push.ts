import type { IQueueMessage } from "../runtime/queue.ts";
import { and, asc, eq, exists, inArray, lte, ne, or, sql } from "drizzle-orm";

import {
  activities,
  actorCache,
  actors,
  affectedRowCount,
  communityMembers,
  inbox,
  notificationPushers,
  notificationPushJobs,
  objectRecipients,
  objects,
  sessions,
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
import { excludeModeratedActors } from "./feed-exclude.ts";
import {
  NOTIFICATION_ACTIVITY_TYPES,
  notificationEligibilityWhere,
} from "./notification-eligibility.ts";
import { yurumeUnreadCounts } from "./unread-counts.ts";
import { logger } from "./logger.ts";
import { generateId } from "./oauth-utils.ts";
import { base64UrlDecode } from "./web-push/bytes.ts";
import { getInstanceVapidKeyPair } from "./web-push/vapid.ts";
import { instanceWebPushTopic } from "./web-push/topic.ts";
import { assertSafeRemoteUrlResolved, nodeLookupAll } from "./ssrf.ts";
import {
  DEFAULT_WEB_PUSH_TTL_SECONDS,
  sendWebPush,
  type WebPushUrgency,
} from "./web-push/send.ts";
import { buildDeclarativeWebPushMessage } from "./web-push/payload.ts";

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

interface NotificationPusherRegistrationCommon {
  readonly id: string;
  readonly app_id: string;
  readonly app_display_name?: string;
  readonly device_display_name?: string;
  readonly profile_tag?: string;
  readonly lang?: string;
  readonly product: SocialNotificationProduct;
  readonly scope: string | null;
  readonly registered_at: string;
  readonly last_seen_at: string;
}

export type NotificationPusherRegistrationResponse =
  | (NotificationPusherRegistrationCommon & {
      readonly kind: "http";
      readonly data: JsonObject;
      readonly gateway_url: string;
    })
  | (NotificationPusherRegistrationCommon & {
      readonly kind: "webpush";
      /** The endpoint only; the auth secret is never echoed. */
      readonly data: { readonly url: string };
    });

type StoredPusher = {
  id: string;
  actorApId: string;
  product: string;
  kind: string;
  appId: string;
  pushkey: string;
  pushkeyHash: string;
  lang: string | null;
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

/**
 * A `webpush` endpoint is any public HTTPS push service (FCM, Mozilla, Apple,
 * a relay) — the gateway host allowlist does not apply. The URL rule is the
 * gateway one (no IP literals or private/loopback names, port 443); plain
 * HTTP loopback is accepted only behind the explicit development flag.
 */
export function isWebPushEndpointAllowed(env: Env, value: string): boolean {
  const normalized = normalizeGatewayUrl(value);
  if (!normalized) return false;
  if (isLoopbackGatewayUrl(normalized)) {
    return isTruthy(env.YURUCOMMU_NOTIFICATION_PUSH_ALLOW_INSECURE_LOOPBACK);
  }
  return new URL(normalized).protocol === "https:";
}

/**
 * A `webpush` registration names a subscription (p256dh) already registered
 * to another account, without presenting that subscription's endpoint and
 * auth secret. The route answers 409.
 */
export class NotificationPusherConflictError extends Error {
  override name = "NotificationPusherConflictError";
  constructor() {
    super("This push subscription is registered to another account");
  }
}

export interface NotificationPusherRegistrationContext {
  /**
   * Stored key of the session making the request (`sessions.id`). Required
   * for `webpush`: the subscription stops receiving when that session ends.
   */
  readonly sessionKey?: string | null;
}

export async function registerNotificationPusher(
  db: Database,
  actor: Actor,
  input: ParsedNotificationPusherSetRequest,
  context: NotificationPusherRegistrationContext = {},
): Promise<NotificationPusherRegistrationResponse> {
  const now = new Date().toISOString();
  const pushkeyHash = await sha256Hex(input.pusher.pushkey);
  const webPush = input.pusher.kind === "webpush";
  const webPushAuth =
    input.pusher.kind === "webpush" ? input.pusher.data.auth : null;
  if (webPush && !context.sessionKey) {
    throw new Error("A webpush pusher must be registered from a session");
  }
  // `webpush` rows remember the registering session (server-owned data_json;
  // never echoed) so delivery stops once that session ends.
  const storedData: JsonObject = webPush
    ? { ...input.storedData, session: context.sessionKey! }
    : input.storedData;

  // The device key is globally unique inside product+app. Reassigning that row
  // is one atomic upsert, so concurrent logins cannot leave duplicate owners.
  const existing = await db
    .select({
      id: notificationPushers.id,
      actorApId: notificationPushers.actorApId,
      kind: notificationPushers.kind,
      gatewayUrl: notificationPushers.gatewayUrl,
      dataJson: notificationPushers.dataJson,
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
  // For `webpush` the pushkey is the subscription's p256dh, which is not a
  // bearer secret the way a native device token is. Another account may take
  // the row over only by presenting the same subscription — its endpoint and
  // auth secret — which is what the same browser signing in to a different
  // account does. Anything else would let one account silence another's
  // device by registering its p256dh.
  if (
    webPush &&
    existing &&
    !sameActor &&
    !(
      existing.kind === "webpush" &&
      existing.gatewayUrl === input.gatewayUrl &&
      parseStoredData(existing.dataJson).auth === webPushAuth
    )
  ) {
    throw new NotificationPusherConflictError();
  }
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
      kind: input.pusher.kind,
      appId: input.pusher.app_id,
      pushkey: input.pusher.pushkey,
      pushkeyHash,
      appDisplayName: input.pusher.app_display_name ?? null,
      deviceDisplayName: input.pusher.device_display_name ?? null,
      profileTag: input.pusher.profile_tag ?? null,
      lang: input.pusher.lang ?? null,
      dataJson: JSON.stringify(storedData),
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
      // The same rule inside the upsert, so a concurrent registration cannot
      // slip a different subscription under the check above.
      ...(webPush
        ? {
            setWhere: or(
              eq(notificationPushers.actorApId, actor.ap_id),
              and(
                eq(notificationPushers.kind, "webpush"),
                eq(notificationPushers.gatewayUrl, input.gatewayUrl),
                sql`CASE WHEN json_valid(${notificationPushers.dataJson}) THEN json_extract(${notificationPushers.dataJson}, '$.auth') ELSE NULL END = ${webPushAuth}`,
              ),
            ),
          }
        : {}),
      set: {
        id: registrationId,
        actorApId: actor.ap_id,
        kind: input.pusher.kind,
        pushkey: input.pusher.pushkey,
        scope: input.scope,
        appDisplayName: input.pusher.app_display_name ?? null,
        deviceDisplayName: input.pusher.device_display_name ?? null,
        profileTag: input.pusher.profile_tag ?? null,
        lang: input.pusher.lang ?? null,
        dataJson: JSON.stringify(storedData),
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
  if (!row) {
    if (webPush) throw new NotificationPusherConflictError();
    throw new Error("Failed to register notification pusher");
  }
  const common: NotificationPusherRegistrationCommon = {
    id: row.id,
    app_id: row.appId,
    ...(row.appDisplayName ? { app_display_name: row.appDisplayName } : {}),
    ...(row.deviceDisplayName
      ? { device_display_name: row.deviceDisplayName }
      : {}),
    ...(row.profileTag ? { profile_tag: row.profileTag } : {}),
    ...(row.lang ? { lang: row.lang } : {}),
    product: input.product,
    scope: row.scope,
    registered_at: row.createdAt,
    last_seen_at: row.lastSeenAt,
  };
  if (row.kind === "webpush") {
    return { ...common, kind: "webpush", data: { url: row.gatewayUrl } };
  }
  return {
    ...common,
    kind: "http",
    data: parseStoredData(row.dataJson),
    gateway_url: row.gatewayUrl,
  };
}

/**
 * Remove the `webpush` subscriptions one session registered. Logout calls it
 * so the device stops at once; delivery independently skips and removes rows
 * whose session has ended (rotation, revocation, expiry, teardown).
 */
export async function deleteSessionWebPushers(
  db: Database,
  actorApId: string,
  sessionKey: string,
): Promise<number> {
  const deleted = await db
    .delete(notificationPushers)
    .where(
      and(
        eq(notificationPushers.actorApId, actorApId),
        eq(notificationPushers.kind, "webpush"),
        sql`CASE WHEN json_valid(${notificationPushers.dataJson}) THEN json_extract(${notificationPushers.dataJson}, '$.session') ELSE NULL END = ${sessionKey}`,
      ),
    );
  return affectedRowCount(deleted);
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
  message: IQueueMessage<DeliveryQueueMessageV1>,
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
  // Pushers of this job that reached a final answer (delivered, removed, or a
  // permanent failure). If the job throws part-way, the retry is narrowed to
  // the rest so nobody gets the same notification twice.
  const settledIds = new Set<string>();
  let dispatchIds: string[] | null = null;

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

    dispatchIds = pendingIds;
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
        kind: notificationPushers.kind,
        appId: notificationPushers.appId,
        pushkey: notificationPushers.pushkey,
        pushkeyHash: notificationPushers.pushkeyHash,
        lang: notificationPushers.lang,
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
    const webPushers = pushers.filter((row) => row.kind === "webpush");
    const grouped = groupByGatewayAndFormat(
      pushers.filter((row) => row.kind !== "webpush"),
    );
    // A pending id whose row no longer loads (deleted since) is settled; so is
    // every pusher whose attempt below reaches a final answer.
    const loadedIds = new Set(pushers.map((row) => row.id));
    for (const id of pendingIds) {
      if (!loadedIds.has(id)) settledIds.add(id);
    }
    const retryIds: string[] = [];
    let retryAfterSeconds = 0;
    const errors: string[] = [];
    const record = (ids: readonly string[], outcome: GatewayResult) => {
      const retry = new Set(outcome.retryIds);
      for (const id of ids) {
        if (!retry.has(id)) settledIds.add(id);
      }
      retryIds.push(...outcome.retryIds);
      retryAfterSeconds = Math.max(
        retryAfterSeconds,
        outcome.retryAfterSeconds,
      );
      if (outcome.error) errors.push(outcome.error);
    };
    // An exception while handling one pusher must not make the job resend to
    // pushers that already got the message: it retries only that pusher.
    const thrown = (ids: readonly string[], error: unknown): GatewayResult => ({
      retryIds: [...ids],
      retryAfterSeconds: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    if (webPushers.length > 0) {
      let content: WebPushContent | null = null;
      try {
        content = await buildWebPushContent(
          db,
          env,
          job.actorApId,
          product,
          event,
          unread,
        );
      } catch (error) {
        const ids = webPushers.map((row) => row.id);
        record(ids, thrown(ids, error));
      }
      for (const row of content ? webPushers : []) {
        // Same lease heartbeat as the gateway fanout: one bounded network
        // call per subscription.
        if (!(await refreshProcessingLease(db, lease))) {
          message.ack();
          return;
        }
        let outcome: GatewayResult;
        try {
          outcome = await deliverWebPushPusher(env, db, row, content!);
        } catch (error) {
          outcome = thrown([row.id], error);
        }
        record([row.id], outcome);
      }
    }
    for (const group of grouped.values()) {
      // A job can fan out to sixteen different gateways. Refresh the durable
      // lease before each bounded network call so a healthy worker cannot age
      // past the stale-reclaim window while progressing through that fanout.
      if (!(await refreshProcessingLease(db, lease))) {
        message.ack();
        return;
      }
      const ids = group.pushers.map((row) => row.id);
      let outcome: GatewayResult;
      try {
        outcome = await deliverGatewayGroup(
          env,
          db,
          group.gatewayUrl,
          group.pushers,
          group.format,
          {
            id: event.activityApId,
            type:
              event.visibility === "direct" ? "dm" : event.type.toLowerCase(),
            sender: event.actorApId,
            scopeId: event.objectApId,
            unread,
          },
        );
      } catch (error) {
        outcome = thrown(ids, error);
      }
      record(ids, outcome);
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
    const remaining =
      dispatchIds && settledIds.size > 0
        ? {
            pendingPusherIdsJson: JSON.stringify(
              dispatchIds.filter((id) => !settledIds.has(id)),
            ),
          }
        : {};
    if (attempts >= MAX_NOTIFICATION_PUSH_ATTEMPTS) {
      const failed = await db
        .update(notificationPushJobs)
        .set({
          status: "failed",
          processingToken: null,
          attempts,
          ...remaining,
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
        ...remaining,
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

type PushEvent = NonNullable<Awaited<ReturnType<typeof loadPushEvent>>>;

interface WebPushContent {
  readonly appOrigin: string | null;
  readonly title: string;
  readonly navigate: string;
  readonly tag: string;
  readonly topic?: string;
  readonly urgency: WebPushUrgency;
  readonly ttlSeconds: number;
  readonly unread: number;
  /** Body per language family ("ja" | "en"). */
  readonly body: (lang: string | null) => string;
}

const WEB_PUSH_TITLES: Record<SocialNotificationProduct, string> = {
  yurucommu: "Yurucommu",
  yurume: "Yurumeet",
};

/**
 * Declarative Web Push content for one event. The message is end-to-end
 * encrypted to the subscribing device, so it may carry the sender's name; it
 * never carries the post or message text, which may be long or sensitive on a
 * lock screen.
 */
async function buildWebPushContent(
  db: Database,
  env: Env,
  recipientApId: string,
  product: SocialNotificationProduct,
  event: PushEvent,
  unread: number,
): Promise<WebPushContent> {
  const appOrigin = webPushAppOrigin(env);
  const sender = await senderDisplayName(db, event.actorApId);
  const direct = event.visibility === "direct";
  const talk = product === "yurume" && !direct;
  const conversation = direct
    ? (event.conversation ?? event.objectApId ?? event.activityApId)
    : null;
  // Topic is visible to the push service (and a relay's collapse key), so it
  // is a keyed MAC over (recipient, conversation), never a plain hash of the
  // guessable conversation id. See web-push/topic.ts.
  const topic = conversation
    ? ((await instanceWebPushTopic(env, recipientApId, conversation)) ??
      undefined)
    : undefined;
  return {
    appOrigin,
    title: WEB_PUSH_TITLES[product],
    navigate: product === "yurume" ? "/" : "/notifications",
    tag: direct
      ? topic
        ? `dm-${topic}`
        : "dm"
      : product === "yurume"
        ? "talk"
        : "notifications",
    ...(topic ? { topic } : {}),
    urgency: direct || talk ? "high" : "normal",
    ttlSeconds: DEFAULT_WEB_PUSH_TTL_SECONDS,
    unread,
    body: (lang) =>
      webPushBody(event.type, direct, talk, sender, languageFamily(lang)),
  };
}

function webPushBody(
  activityType: string,
  direct: boolean,
  talk: boolean,
  sender: string | null,
  lang: "ja" | "en",
): string {
  const ja = lang === "ja";
  if (!sender) {
    if (direct || talk) {
      return ja ? "新しいメッセージがあります" : "You have a new message";
    }
    return ja ? "新しい通知があります" : "You have a new notification";
  }
  if (direct) {
    return ja ? `${sender}さんからメッセージ` : `Message from ${sender}`;
  }
  if (talk) {
    return ja
      ? `${sender}さんがトークに投稿しました`
      : `${sender} posted in a talk`;
  }
  switch (activityType) {
    case "Follow":
      return ja
        ? `${sender}さんがあなたをフォローしました`
        : `${sender} followed you`;
    case "Like":
      return ja
        ? `${sender}さんがあなたの投稿にいいねしました`
        : `${sender} liked your post`;
    case "Announce":
      return ja
        ? `${sender}さんがあなたの投稿をリポストしました`
        : `${sender} reposted your post`;
    default:
      return ja
        ? `${sender}さんがあなた宛てに投稿しました`
        : `${sender} posted to you`;
  }
}

function languageFamily(lang: string | null): "ja" | "en" {
  if (!lang) return "ja";
  return lang.trim().toLowerCase().startsWith("ja") ? "ja" : "en";
}

async function senderDisplayName(
  db: Database,
  actorApId: string,
): Promise<string | null> {
  const local = await db
    .select({ name: actors.name, username: actors.preferredUsername })
    .from(actors)
    .where(eq(actors.apId, actorApId))
    .get();
  const remote = local
    ? undefined
    : await db
        .select({
          name: actorCache.name,
          username: actorCache.preferredUsername,
        })
        .from(actorCache)
        .where(eq(actorCache.apId, actorApId))
        .get();
  const row = local ?? remote;
  const name = (row?.name ?? "").replace(/\s+/g, " ").trim();
  const username = (row?.username ?? "").trim();
  const display = name || username;
  return display ? [...display].slice(0, 64).join("") : null;
}

function webPushAppOrigin(env: Env): string | null {
  try {
    const url = new URL(env.APP_URL);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/**
 * Send one Declarative Web Push message to one `webpush` pusher and map the
 * push service's answer onto the outbox channels: 2xx done; 404/410 delete
 * the registration; timeout/408/429/5xx retry (Retry-After honored);
 * 3xx and other 4xx (403 included) recorded as failed, kept, not retried.
 */
async function deliverWebPushPusher(
  env: Env,
  db: Database,
  row: StoredPusher,
  content: WebPushContent,
): Promise<GatewayResult> {
  const failed = (error: string): GatewayResult => ({
    retryIds: [],
    retryAfterSeconds: 0,
    error,
  });
  if (!content.appOrigin) return failed("web push needs a valid APP_URL");
  const vapid = await getInstanceVapidKeyPair(env);
  if (!vapid) {
    return failed("web push is unavailable: ENCRYPTION_KEY is not valid");
  }
  if (!isWebPushEndpointAllowed(env, row.gatewayUrl)) {
    return failed("web push endpoint is no longer allowed");
  }
  const stored = parseStoredData(row.dataJson);
  // A browser subscription belongs to the session that registered it: the
  // message names the sender on a lock screen, so a signed-out or expired
  // session must stop receiving. Logout, session rotation, revocation,
  // expiry and account teardown all end here without separate hooks.
  if (!(await webPushSessionIsLive(db, row, stored))) {
    await deletePusherRow(db, row);
    log.info("Removed a web push subscription whose session has ended", {
      event: "notification.push.webpush_session_ended",
    });
    return { retryIds: [], retryAfterSeconds: 0, error: null };
  }
  const p256dh = base64UrlDecode(row.pushkey);
  const auth =
    typeof stored.auth === "string" ? base64UrlDecode(stored.auth) : null;
  if (!p256dh || !auth) return failed("web push subscription keys are invalid");
  const resolved = await checkWebPushEndpointResolved(env, row.gatewayUrl);
  if (!resolved.ok) {
    return resolved.retry
      ? { retryIds: [row.id], retryAfterSeconds: 0, error: resolved.error }
      : failed(resolved.error);
  }

  const { bytes } = buildDeclarativeWebPushMessage({
    appOrigin: content.appOrigin,
    title: content.title,
    body: content.body(row.lang),
    navigate: content.navigate,
    tag: content.tag,
    appBadge: content.unread,
    ...(row.lang ? { lang: row.lang } : {}),
  });
  const outcome = await sendWebPush(
    { endpoint: row.gatewayUrl, p256dh, auth },
    {
      payload: bytes,
      ttlSeconds: content.ttlSeconds,
      urgency: content.urgency,
      ...(content.topic ? { topic: content.topic } : {}),
    },
    {
      vapid,
      subject: content.appOrigin,
      timeoutMs: parseTimeout(
        env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TIMEOUT_MS,
      ),
    },
  );
  switch (outcome.kind) {
    case "delivered":
      return { retryIds: [], retryAfterSeconds: 0, error: null };
    case "gone":
      await deletePusherRow(db, row);
      return { retryIds: [], retryAfterSeconds: 0, error: null };
    case "retry":
      return {
        retryIds: [row.id],
        retryAfterSeconds: outcome.retryAfterSeconds,
        error: `web push: ${outcome.error}`,
      };
    case "failed":
      log.warn("Web push delivery failed permanently for this attempt", {
        event: "notification.push.webpush_failed",
        status: outcome.status,
        endpointOrigin: new URL(row.gatewayUrl).origin,
      });
      return failed(`web push: ${outcome.error}`);
  }
}

/** Delete exactly this stored pusher row (no-op if it changed owner since). */
async function deletePusherRow(db: Database, row: StoredPusher): Promise<void> {
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

/**
 * The session a `webpush` row is bound to (`data_json.session`, the session's
 * stored key) still exists for the same member and has not expired. A row
 * without a binding is treated as ended: every registration stores one.
 */
async function webPushSessionIsLive(
  db: Database,
  row: StoredPusher,
  stored: JsonObject,
): Promise<boolean> {
  const sessionKey = typeof stored.session === "string" ? stored.session : "";
  if (!sessionKey) return false;
  const session = await db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(
      and(eq(sessions.id, sessionKey), eq(sessions.memberId, row.actorApId)),
    )
    .get();
  if (!session) return false;
  const expiresMs = Date.parse(session.expiresAt);
  return Number.isFinite(expiresMs) && expiresMs > Date.now();
}

type HostResolver = (hostname: string) => Promise<string[]>;

let webPushEndpointResolverOverride: HostResolver | null | undefined;

/**
 * Test hook for the send-time DNS check: a resolver to use instead of the
 * runtime's, null to skip the check, undefined to restore the default.
 */
export function setWebPushEndpointResolverForTests(
  resolver: HostResolver | null | undefined,
): void {
  webPushEndpointResolverOverride = resolver;
}

/**
 * The resolver the send-time check uses. On Bun/Node (self-host) it is the
 * host resolver that `fetch` itself uses, so a name such as
 * `127.0.0.1.nip.io` that points into private address space is refused. On
 * Cloudflare Workers there is no host resolver to compare with and `fetch`
 * cannot connect to private address space, so the check is skipped there.
 * The connection is not pinned to the checked addresses; a record that flips
 * between the check and the request is outside this check (as for federation).
 */
function webPushEndpointResolver(): HostResolver | null {
  if (webPushEndpointResolverOverride !== undefined) {
    return webPushEndpointResolverOverride;
  }
  if (
    (globalThis as { navigator?: { userAgent?: string } }).navigator
      ?.userAgent === "Cloudflare-Workers"
  ) {
    return null;
  }
  return (globalThis as { process?: unknown }).process ? nodeLookupAll : null;
}

class WebPushEndpointLookupError extends Error {
  override name = "WebPushEndpointLookupError";
}

type EndpointResolution =
  | { readonly ok: true }
  | { readonly ok: false; readonly retry: boolean; readonly error: string };

/**
 * Resolve the endpoint's host and refuse private, loopback, link-local and
 * other non-public addresses (`assertSafeRemoteUrlResolved`). A lookup that
 * fails or times out is retried later; a non-public answer is a permanent
 * failure for this attempt. Messages never include the endpoint URL, whose
 * path is the device's push token.
 */
async function checkWebPushEndpointResolved(
  env: Env,
  endpoint: string,
): Promise<EndpointResolution> {
  // Plain-HTTP loopback endpoints exist only behind the development flag,
  // which isWebPushEndpointAllowed has already checked.
  if (isLoopbackGatewayUrl(endpoint)) return { ok: true };
  const resolver = webPushEndpointResolver();
  if (!resolver) return { ok: true };
  const timeoutMs = parseTimeout(
    env.YURUCOMMU_NOTIFICATION_PUSH_GATEWAY_TIMEOUT_MS,
  );
  try {
    await assertSafeRemoteUrlResolved(endpoint, {
      allowLocalSubstrateRemoteFetches: false,
      remoteResolver: async (hostname) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          return await Promise.race([
            resolver(hostname),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("DNS lookup timed out")),
                timeoutMs,
              );
            }),
          ]);
        } catch (error) {
          throw new WebPushEndpointLookupError(
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      },
    });
    return { ok: true };
  } catch (error) {
    if (
      error instanceof WebPushEndpointLookupError ||
      (error instanceof Error &&
        error.message.startsWith("Failed to resolve hostname"))
    ) {
      return {
        ok: false,
        retry: true,
        error: "web push endpoint DNS lookup failed",
      };
    }
    return {
      ok: false,
      retry: false,
      error: "web push endpoint resolves to a non-public address",
    };
  }
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
          excludeModeratedActors(actorApId, activities.actorApId),
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
