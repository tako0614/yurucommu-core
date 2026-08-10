import type { Env } from "./types.ts";
import { enqueuePendingNotificationPushJobs } from "./lib/notification-push.ts";
import { enqueuePendingDeliveryFanoutJobs } from "./lib/delivery/fanout-outbox.ts";
import { enqueuePendingDeliveryEndpointJobs } from "./lib/delivery/queue.ts";
import { enqueuePendingDeliveryResolutionJobs } from "./lib/delivery/resolution-outbox.ts";
import { reapDrainedTombstones } from "./routes/actors.ts";
import { cleanupExpiredStories } from "./routes/stories/query-helpers.ts";
import { reapRemoteActorFetchFailures } from "./lib/activitypub-actor-cache.ts";
import { mirrorPendingStampAssets } from "./lib/stamp-mirror.ts";

export type YurucommuRetentionStep =
  | "expired_stories"
  | "drained_tombstones"
  | "remote_actor_fetch_failures"
  | "stamp_asset_mirrors"
  | "delivery_fanout"
  | "delivery_endpoint"
  | "delivery_resolution"
  | "notification_push";

export interface YurucommuRetentionResult {
  readonly expiredStories: number;
  readonly reapedTombstones: number;
  readonly reapedRemoteActorFetchFailures: number;
  readonly mirroredStampAssets: number;
  readonly enqueuedDeliveryFanoutJobs: number;
  readonly enqueuedDeliveryEndpointJobs: number;
  readonly enqueuedDeliveryResolutionJobs: number;
  readonly enqueuedNotificationPushJobs: number;
}

/**
 * Identifies the exact bounded retention step that failed. Scheduled callers
 * must reject the invocation instead of treating a partial or skipped sweep as
 * success; the original database/runtime error remains available as `cause`.
 */
export class YurucommuRetentionError extends Error {
  constructor(
    readonly step: YurucommuRetentionStep,
    cause: unknown,
  ) {
    super(`yurucommu retention failed at ${step}`, { cause });
    this.name = "YurucommuRetentionError";
  }
}

/**
 * Run one bounded retention pass against the already-materialized runtime.
 *
 * This deliberately reuses the same race-safe cleanup paths as request/queue
 * handling:
 * - Story expiry uses the canonical object cascade and purges its media last.
 * - Tombstones remain until every Delete delivery has drained.
 * - Federation delivery republishes pending follower/community fanout,
 *   due endpoint jobs, and unresolved-recipient outbox rows whose first Queue
 *   RPC or owning worker was lost.
 * - Notification push performs bounded pusher/job retention, stale-job
 *   recovery, and enqueues due durable outbox rows when a queue is available.
 *
 * Steps are awaited sequentially because D1 is the shared authority. Any
 * failure rejects with its exact step; callers must retry the cron invocation
 * rather than silently acknowledging incomplete retention.
 */
export async function runYurucommuRetention(
  env: Env,
): Promise<YurucommuRetentionResult> {
  if (!env?.DB_INSTANCE) {
    throw new TypeError("Yurucommu retention requires DB_INSTANCE");
  }

  const expiredStories = await retentionStep("expired_stories", () =>
    cleanupExpiredStories(env.DB_INSTANCE, env.MEDIA),
  );
  const reapedTombstones = await retentionStep("drained_tombstones", () =>
    reapDrainedTombstones(env.DB_INSTANCE),
  );
  const reapedRemoteActorFetchFailures = await retentionStep(
    "remote_actor_fetch_failures",
    () => reapRemoteActorFetchFailures(env.DB_INSTANCE),
  );
  const mirroredStampAssets = await retentionStep("stamp_asset_mirrors", () =>
    mirrorPendingStampAssets(env),
  );
  const enqueuedDeliveryFanoutJobs = await retentionStep(
    "delivery_fanout",
    () => enqueuePendingDeliveryFanoutJobs(env),
  );
  const enqueuedDeliveryEndpointJobs = await retentionStep(
    "delivery_endpoint",
    () => enqueuePendingDeliveryEndpointJobs(env),
  );
  const enqueuedDeliveryResolutionJobs = await retentionStep(
    "delivery_resolution",
    () => enqueuePendingDeliveryResolutionJobs(env),
  );
  const enqueuedNotificationPushJobs = await retentionStep(
    "notification_push",
    () => enqueuePendingNotificationPushJobs(env),
  );

  return {
    expiredStories,
    reapedTombstones,
    reapedRemoteActorFetchFailures,
    mirroredStampAssets,
    enqueuedDeliveryFanoutJobs,
    enqueuedDeliveryEndpointJobs,
    enqueuedDeliveryResolutionJobs,
    enqueuedNotificationPushJobs,
  };
}

async function retentionStep<T>(
  step: YurucommuRetentionStep,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (cause) {
    throw new YurucommuRetentionError(step, cause);
  }
}
