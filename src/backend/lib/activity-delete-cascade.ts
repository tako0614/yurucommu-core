import { inArray, type SQL } from "drizzle-orm";

import {
  activities,
  deliveryQueue,
  inboundActivityClaims,
  inbox,
  notificationArchived,
  notificationPushJobs,
  runBatch,
  type Database,
  type D1Statement,
} from "../../db/index.ts";

/**
 * Build one atomic hard-delete unit for activities and every durable
 * projection keyed by their AP IDs.
 *
 * The inbox FK/trigger only removes push jobs in selected non-terminal states;
 * delivery work, archived markers, in-flight/terminal push jobs, and inbound
 * claim leases otherwise survive as orphans. Keep the activities rows until
 * the final statement so every preceding subquery sees the same target set.
 * Semantic edges (`likes`, `announces`, `follows`) are intentionally caller-
 * owned because removing them also requires domain-specific counter repair.
 */
export function activityDeleteCascadeStatements(
  db: Database,
  activityWhere: SQL,
): readonly [D1Statement, ...D1Statement[]] {
  const targetActivityIds = () =>
    db.select({ apId: activities.apId }).from(activities).where(activityWhere);

  return [
    db
      .delete(notificationPushJobs)
      .where(
        inArray(notificationPushJobs.activityApId, targetActivityIds()),
      ) as D1Statement,
    db
      .delete(notificationArchived)
      .where(
        inArray(notificationArchived.activityApId, targetActivityIds()),
      ) as D1Statement,
    db
      .delete(inboundActivityClaims)
      .where(
        inArray(inboundActivityClaims.activityApId, targetActivityIds()),
      ) as D1Statement,
    db
      .delete(deliveryQueue)
      .where(
        inArray(deliveryQueue.activityApId, targetActivityIds()),
      ) as D1Statement,
    db
      .delete(inbox)
      .where(inArray(inbox.activityApId, targetActivityIds())) as D1Statement,
    db.delete(activities).where(activityWhere) as D1Statement,
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
