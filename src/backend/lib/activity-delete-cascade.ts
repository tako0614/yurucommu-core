import { and, inArray, notExists, or, type SQL } from "drizzle-orm";

import {
  activities,
  deliveryFanouts,
  deliveryQueue,
  deliveryResolutions,
  inboundActivityClaims,
  inbox,
  notificationArchived,
  notificationPushJobs,
  runBatch,
  type Database,
  type D1Statement,
} from "../../db/index.ts";

/**
 * A write-time fence for deleting an Activity actor's signing material.
 *
 * Preliminary reads are not sufficient: a fanout/resolution worker can
 * materialize an endpoint after the reaper checked delivery_queue and then
 * mark its own outbox terminal before the reaper checks that table. Reuse this
 * predicate on EVERY statement in the atomic cleanup batch so newly active
 * work stops the remaining deletes before the Activity or signer disappears.
 */
export function activityDeliveryDrainedGuard(
  db: Database,
  activityWhere: SQL,
): SQL {
  const targetActivityIds = () =>
    db.select({ apId: activities.apId }).from(activities).where(activityWhere);

  return and(
    notExists(
      db
        .select({ id: deliveryQueue.id })
        .from(deliveryQueue)
        .where(
          and(
            inArray(deliveryQueue.activityApId, targetActivityIds()),
            inArray(deliveryQueue.status, [
              "pending",
              "processing",
              "retry_wait",
            ]),
          ),
        ),
    ),
    notExists(
      db
        .select({ id: deliveryResolutions.id })
        .from(deliveryResolutions)
        .where(
          and(
            inArray(deliveryResolutions.activityApId, targetActivityIds()),
            inArray(deliveryResolutions.status, [
              "pending",
              "queued",
              "processing",
              "retry_wait",
            ]),
          ),
        ),
    ),
    notExists(
      db
        .select({ id: deliveryFanouts.id })
        .from(deliveryFanouts)
        .where(
          and(
            or(
              inArray(deliveryFanouts.activityApId, targetActivityIds()),
              inArray(
                deliveryFanouts.announceActivityApId,
                targetActivityIds(),
              ),
            ),
            inArray(deliveryFanouts.status, ["pending", "published"]),
          ),
        ),
    ),
  )!;
}

/**
 * Build the atomic cleanup unit for every durable projection of matching
 * activities while retaining the activity ledger rows themselves.
 *
 * The inbox FK/trigger only removes push jobs in selected non-terminal states;
 * delivery work, archived markers, in-flight/terminal push jobs, and inbound
 * claim leases otherwise survive. This projection-only form is also used when
 * an object is deleted but its historical Activity must remain available.
 */
export function activityProjectionDeleteStatements(
  db: Database,
  activityWhere: SQL,
  options: { readonly guard?: SQL } = {},
): readonly [D1Statement, ...D1Statement[]] {
  const targetActivityIds = () =>
    db.select({ apId: activities.apId }).from(activities).where(activityWhere);
  const guarded = (where: SQL): SQL =>
    options.guard ? and(where, options.guard)! : where;

  return [
    db
      .delete(notificationPushJobs)
      .where(
        guarded(
          inArray(notificationPushJobs.activityApId, targetActivityIds()),
        ),
      ) as D1Statement,
    db
      .delete(notificationArchived)
      .where(
        guarded(
          inArray(notificationArchived.activityApId, targetActivityIds()),
        ),
      ) as D1Statement,
    db
      .delete(inboundActivityClaims)
      .where(
        guarded(
          inArray(inboundActivityClaims.activityApId, targetActivityIds()),
        ),
      ) as D1Statement,
    db
      .delete(deliveryQueue)
      .where(
        guarded(inArray(deliveryQueue.activityApId, targetActivityIds())),
      ) as D1Statement,
    db
      .delete(deliveryResolutions)
      .where(
        guarded(inArray(deliveryResolutions.activityApId, targetActivityIds())),
      ) as D1Statement,
    db
      .delete(deliveryFanouts)
      .where(
        guarded(inArray(deliveryFanouts.activityApId, targetActivityIds())),
      ) as D1Statement,
    // Keep the secondary Announce reference in its own statement. Combining
    // both predicates with OR duplicates every bound value in D1, so a normal
    // 90-id cascade would exceed the platform's 100-parameter ceiling.
    db
      .delete(deliveryFanouts)
      .where(
        guarded(
          inArray(deliveryFanouts.announceActivityApId, targetActivityIds()),
        ),
      ) as D1Statement,
    db
      .delete(inbox)
      .where(
        guarded(inArray(inbox.activityApId, targetActivityIds())),
      ) as D1Statement,
  ];
}

/**
 * Build one atomic hard-delete unit for activities and every durable
 * projection keyed by their AP IDs.
 *
 * Keep the activities rows until the final statement so every preceding
 * subquery sees the same target set. Semantic edges (`likes`, `announces`,
 * `follows`) are intentionally caller-owned because removing them also
 * requires domain-specific counter repair.
 */
export function activityDeleteCascadeStatements(
  db: Database,
  activityWhere: SQL,
  options: { readonly guard?: SQL } = {},
): readonly [D1Statement, ...D1Statement[]] {
  return [
    ...activityProjectionDeleteStatements(db, activityWhere, options),
    db
      .delete(activities)
      .where(
        options.guard ? and(activityWhere, options.guard) : activityWhere,
      ) as D1Statement,
  ];
}

/**
 * Atomically hard-delete matching activities and all of their projections.
 * A failed final activity delete rolls the preceding cleanup back, so the
 * caller can retry the same idempotent predicate without partial state.
 */
export async function deleteActivitiesCascade(
  db: Database,
  activityWhere: SQL,
): Promise<void> {
  await runBatch(db, activityDeleteCascadeStatements(db, activityWhere));
}
