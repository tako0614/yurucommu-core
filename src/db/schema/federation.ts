import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
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

/**
 * Durable negative-cache/backoff state for a remote actor document fetch.
 *
 * This is deliberately separate from actor_cache: a failed fetch is not an
 * actor and must never leak into actor search, signature verification, or
 * delivery planning as if it were a partially valid cached identity.
 */
export const remoteActorFetchFailures = sqliteTable(
  "remote_actor_fetch_failures",
  {
    actorApId: text("actor_ap_id").primaryKey(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    httpStatus: integer("http_status"),
    failureCount: integer("failure_count").notNull().default(1),
    retryAt: text("retry_at"),
    processingToken: text("processing_token"),
    leaseExpiresAt: text("lease_expires_at"),
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [
    index("remote_actor_fetch_failures_retry_idx").on(t.retryAt),
    index("remote_actor_fetch_failures_lease_idx").on(t.leaseExpiresAt),
    index("remote_actor_fetch_failures_updated_idx").on(t.updatedAt),
  ],
);

/**
 * Durable lifecycle authority established by a verified self-Delete(Actor).
 *
 * This is deliberately separate from actor_cache and fetch-failure backoff:
 * cache data is disposable, a remote fetch can recover, but a signed deletion
 * must fence late/concurrent cache writers and all subsequent inbound traffic.
 */
export const remoteActorTombstones = sqliteTable("remote_actor_tombstones", {
  actorApId: text("actor_ap_id").primaryKey(),
  deleteActivityApId: text("delete_activity_ap_id").notNull(),
  deletedAt: text("deleted_at").notNull().$defaultFn(nowIsoUtc),
});
