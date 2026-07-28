import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { nowIsoUtc } from "./date-utils.ts";

/**
 * Short-lived fencing leases for inbound ActivityPub dispatch.
 *
 * The durable activity remains in `activities`; this table only identifies the
 * Worker currently allowed to apply and commit its effects.
 */
export const inboundActivityClaims = sqliteTable(
  "inbound_activity_claims",
  {
    activityApId: text("activity_ap_id").primaryKey(),
    processingToken: text("processing_token"),
    leaseExpiresAt: text("lease_expires_at"),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [index("inbound_activity_claims_lease_idx").on(t.leaseExpiresAt)],
);
