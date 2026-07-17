/**
 * Mobile client tables.
 */

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowIsoUtc } from "./date-utils.ts";
import { actors } from "./actors.ts";

export const mobilePushRegistrations = sqliteTable(
  "mobile_push_registrations",
  {
    id: text("id").primaryKey(),
    actorApId: text("actor_ap_id")
      .notNull()
      .references(() => actors.apId),
    product: text("product").notNull(),
    token: text("token").notNull(),
    tokenHash: text("token_hash").notNull(),
    environment: text("environment").notNull().default("production"),
    hostUrl: text("host_url"),
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIsoUtc)
      .$onUpdateFn(nowIsoUtc),
    lastSeenAt: text("last_seen_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [
    uniqueIndex("mobile_push_registrations_actor_product_token_idx").on(
      t.actorApId,
      t.product,
      t.tokenHash,
    ),
    index("mobile_push_registrations_actor_idx").on(t.actorApId),
    index("mobile_push_registrations_last_seen_idx").on(t.lastSeenAt),
  ],
);

/**
 * Product-neutral notification pushers shared by yurucommu-family clients.
 *
 * `pushkey` is an opaque downstream-provider identifier. Provider credentials
 * never live in this table; they stay in the configured stateless gateway.
 *
 * NO foreign key on actor_ap_id: D1 ENFORCES declared FKs (0010/0011 dropped
 * the actors FKs for that reason) and cleanup is app-level
 * (routes/account-teardown.ts), matching the rest of the schema.
 */
export const notificationPushers = sqliteTable(
  "notification_pushers",
  {
    id: text("id").primaryKey(),
    actorApId: text("actor_ap_id").notNull(),
    product: text("product").notNull(),
    scope: text("scope"),
    kind: text("kind").notNull().default("http"),
    appId: text("app_id").notNull(),
    pushkey: text("pushkey").notNull(),
    pushkeyHash: text("pushkey_hash").notNull(),
    appDisplayName: text("app_display_name"),
    deviceDisplayName: text("device_display_name"),
    profileTag: text("profile_tag"),
    lang: text("lang"),
    dataJson: text("data_json").notNull().default("{}"),
    gatewayUrl: text("gateway_url").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIsoUtc)
      .$onUpdateFn(nowIsoUtc),
    lastSeenAt: text("last_seen_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [
    index("notification_pushers_actor_product_idx").on(t.actorApId, t.product),
    // Device uniqueness — strictly stronger than any actor-scoped unique
    // variant, so this is the ONLY unique index.
    uniqueIndex("notification_pushers_device_idx").on(
      t.product,
      t.appId,
      t.pushkeyHash,
    ),
    index("notification_pushers_last_seen_idx").on(t.lastSeenAt),
  ],
);

/**
 * Durable outbox for push delivery. A migration-owned trigger writes one row
 * whenever an unread inbox entry is created. Queue messages contain only `id`.
 */
export const notificationPushJobs = sqliteTable(
  "notification_push_jobs",
  {
    id: text("id").primaryKey(),
    actorApId: text("actor_ap_id").notNull(),
    activityApId: text("activity_ap_id").notNull(),
    // Explicit for notification sources that do not create an inbox row (for
    // example community talk). NULL means infer social/direct from the object.
    product: text("product"),
    status: text("status").notNull().default("pending"),
    // Per-claim fencing token. Every processing-state mutation must match this
    // value so an expired worker cannot overwrite a reclaimed job.
    processingToken: text("processing_token"),
    attempts: integer("attempts").notNull().default(0),
    pendingPusherIdsJson: text("pending_pusher_ids_json"),
    nextAttemptAt: text("next_attempt_at").notNull().$defaultFn(nowIsoUtc),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIsoUtc)
      .$onUpdateFn(nowIsoUtc),
    deliveredAt: text("delivered_at"),
  },
  (t) => [
    uniqueIndex("notification_push_jobs_actor_activity_idx").on(
      t.actorApId,
      t.activityApId,
    ),
    index("notification_push_jobs_status_next_idx").on(
      t.status,
      t.nextAttemptAt,
    ),
    index("notification_push_jobs_terminal_retention_idx").on(
      t.status,
      t.updatedAt,
    ),
    index("notification_push_jobs_actor_idx").on(t.actorApId),
  ],
);
