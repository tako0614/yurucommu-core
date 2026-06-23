/**
 * Messaging/DM tables: activities, inbox, deliveryQueue, deliveryCircuit,
 * notificationArchived, dmTyping, dmReadStatus, dmArchivedConversations, mediaUploads
 */

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { nowIso, nowIsoUtc } from "./date-utils.ts";

// ---------------------------------------------------------------------------
// ACTIVITIES
// ---------------------------------------------------------------------------

export const activities = sqliteTable(
  "activities",
  {
    apId: text("ap_id").primaryKey(),
    type: text("type").notNull(),
    actorApId: text("actor_ap_id").notNull(),
    objectApId: text("object_ap_id"),
    objectJson: text("object_json"),
    targetApId: text("target_ap_id"),
    rawJson: text("raw_json").notNull(),
    direction: text("direction"),
    processed: integer("processed").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("activities_actor_idx").on(t.actorApId),
    index("activities_object_idx").on(t.objectApId),
    index("activities_type_idx").on(t.type),
    index("activities_type_created_idx").on(t.type, t.createdAt),
    index("activities_dir_processed_idx").on(t.direction, t.processed),
    index("activities_dir_proc_created_idx").on(
      t.direction,
      t.processed,
      t.createdAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// DELIVERY_QUEUE
// ---------------------------------------------------------------------------

export const deliveryQueue = sqliteTable(
  "delivery_queue",
  {
    id: text("id").primaryKey(),
    activityApId: text("activity_ap_id").notNull(),
    inboxUrl: text("inbox_url").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: text("last_attempt_at"),
    processingStartedAt: text("processing_started_at"),
    nextAttemptAt: text("next_attempt_at").notNull().$defaultFn(nowIso),
    deliveredAt: text("delivered_at"),
    error: text("error"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("delivery_queue_activity_idx").on(t.activityApId),
    index("delivery_queue_next_attempt_idx").on(t.nextAttemptAt),
    index("delivery_queue_status_next_idx").on(t.status, t.nextAttemptAt),
  ],
);

// ---------------------------------------------------------------------------
// DELIVERY_CIRCUIT
// ---------------------------------------------------------------------------

export const deliveryCircuit = sqliteTable(
  "delivery_circuit",
  {
    endpoint: text("endpoint").primaryKey(),
    state: text("state").notNull().default("closed"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    recentOutcomesJson: text("recent_outcomes_json").notNull().default("[]"),
    openUntil: text("open_until"),
    halfOpenProbeAttempts: integer("half_open_probe_attempts")
      .notNull()
      .default(0),
    halfOpenProbeSuccesses: integer("half_open_probe_successes")
      .notNull()
      .default(0),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIso)
      .$onUpdateFn(nowIso),
  },
  (t) => [index("delivery_circuit_state_updated_idx").on(t.state, t.updatedAt)],
);

// ---------------------------------------------------------------------------
// INBOX
// ---------------------------------------------------------------------------

export const inbox = sqliteTable(
  "inbox",
  {
    actorApId: text("actor_ap_id").notNull(),
    activityApId: text("activity_ap_id").notNull(),
    read: integer("read").notNull().default(0),
    // Canonical UTC (…Z): this column is the notification feed's sort + cursor
    // key (`desc(created_at)`, `lt(created_at, before)`). The legacy
    // space-separated `nowIso` would sort below same-instant `…Z` rows written
    // by the explicit-`toISOString` insert paths (likes/reposts/replies),
    // mis-ordering the feed. See nowIsoUtc.
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.activityApId] }),
    index("inbox_actor_read_created_idx").on(t.actorApId, t.read, t.createdAt),
    // The notification-list query (WHERE actor_ap_id = ? ORDER BY created_at,
    // activity_ap_id — no `read` constraint) cannot use the index above (its
    // `read` column sits between the equality prefix and the sort key), so it
    // filesorted the whole inbox. This composite serves the seek + sort directly.
    index("inbox_actor_created_idx").on(
      t.actorApId,
      t.createdAt,
      t.activityApId,
    ),
    index("inbox_activity_idx").on(t.activityApId),
  ],
);

// ---------------------------------------------------------------------------
// NOTIFICATION_ARCHIVED
// ---------------------------------------------------------------------------

export const notificationArchived = sqliteTable(
  "notification_archived",
  {
    actorApId: text("actor_ap_id").notNull(),
    activityApId: text("activity_ap_id").notNull(),
    archivedAt: text("archived_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.activityApId] }),
    index("notification_archived_actor_idx").on(t.actorApId),
    index("notification_archived_actor_archived_idx").on(
      t.actorApId,
      t.archivedAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// DM_TYPING
// ---------------------------------------------------------------------------

export const dmTyping = sqliteTable(
  "dm_typing",
  {
    actorApId: text("actor_ap_id").notNull(),
    recipientApId: text("recipient_ap_id").notNull(),
    lastTypedAt: text("last_typed_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.recipientApId] }),
    index("dm_typing_recipient_typed_idx").on(t.recipientApId, t.lastTypedAt),
  ],
);

// ---------------------------------------------------------------------------
// DM_READ_STATUS
// ---------------------------------------------------------------------------

export const dmReadStatus = sqliteTable(
  "dm_read_status",
  {
    actorApId: text("actor_ap_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    lastReadAt: text("last_read_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.conversationId] }),
    index("dm_read_status_actor_idx").on(t.actorApId),
    index("dm_read_status_actor_read_idx").on(t.actorApId, t.lastReadAt),
  ],
);

// ---------------------------------------------------------------------------
// DM_COMMUNITY_READ_STATUS
// ---------------------------------------------------------------------------

export const dmCommunityReadStatus = sqliteTable(
  "dm_community_read_status",
  {
    actorApId: text("actor_ap_id").notNull(),
    communityApId: text("community_ap_id").notNull(),
    lastReadAt: text("last_read_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.communityApId] }),
    index("dm_community_read_status_actor_idx").on(t.actorApId),
  ],
);

// ---------------------------------------------------------------------------
// DM_ARCHIVED_CONVERSATIONS
// ---------------------------------------------------------------------------

export const dmArchivedConversations = sqliteTable(
  "dm_archived_conversations",
  {
    actorApId: text("actor_ap_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    archivedAt: text("archived_at").$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.conversationId] }),
    index("dm_archived_conversations_actor_idx").on(t.actorApId),
  ],
);

// ---------------------------------------------------------------------------
// MEDIA_UPLOADS
// ---------------------------------------------------------------------------

export const mediaUploads = sqliteTable(
  "media_uploads",
  {
    id: text("id").primaryKey(),
    r2Key: text("r2_key").notNull().unique(),
    uploaderApId: text("uploader_ap_id").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("media_uploads_uploader_idx").on(t.uploaderApId),
    index("media_uploads_r2_key_idx").on(t.r2Key),
  ],
);
