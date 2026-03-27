/**
 * Post/Object-related tables: objects, likes, announces, bookmarks, objectRecipients
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils";

// ---------------------------------------------------------------------------
// OBJECTS
// ---------------------------------------------------------------------------

export const objects = sqliteTable(
  "objects",
  {
    apId: text("ap_id").primaryKey(),
    type: text("type").notNull().default("Note"),
    attributedTo: text("attributed_to").notNull(),
    content: text("content").notNull().default(""),
    summary: text("summary"),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
    inReplyTo: text("in_reply_to"),
    conversation: text("conversation"),
    visibility: text("visibility").notNull().default("public"),
    toJson: text("to_json").notNull().default("[]"),
    ccJson: text("cc_json").notNull().default("[]"),
    audienceJson: text("audience_json").notNull().default("[]"),
    communityApId: text("community_ap_id"),
    endTime: text("end_time"),
    likeCount: integer("like_count").notNull().default(0),
    replyCount: integer("reply_count").notNull().default(0),
    announceCount: integer("announce_count").notNull().default(0),
    shareCount: integer("share_count").notNull().default(0),
    published: text("published").notNull().$defaultFn(nowIso),
    updated: text("updated"),
    isLocal: integer("is_local").notNull().default(1),
    rawJson: text("raw_json"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("objects_attributed_to_idx").on(t.attributedTo),
    index("objects_in_reply_to_idx").on(t.inReplyTo),
    index("objects_community_ap_id_idx").on(t.communityApId),
    index("objects_published_idx").on(t.published),
    index("objects_visibility_idx").on(t.visibility),
    index("objects_end_time_idx").on(t.endTime),
    index("objects_deleted_at_idx").on(t.deletedAt),
    index("objects_attr_published_idx").on(t.attributedTo, t.published),
    index("objects_vis_published_idx").on(t.visibility, t.published),
    index("objects_type_vis_published_idx").on(t.type, t.visibility, t.published),
    index("objects_conversation_idx").on(t.conversation),
    index("objects_comm_published_idx").on(t.communityApId, t.published),
    index("objects_is_local_idx").on(t.isLocal),
  ],
);

// ---------------------------------------------------------------------------
// LIKES
// ---------------------------------------------------------------------------

export const likes = sqliteTable(
  "likes",
  {
    actorApId: text("actor_ap_id").notNull(),
    objectApId: text("object_ap_id").notNull(),
    activityApId: text("activity_ap_id"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.objectApId] }),
    index("likes_object_idx").on(t.objectApId),
    index("likes_actor_idx").on(t.actorApId),
    index("likes_actor_object_idx").on(t.actorApId, t.objectApId),
  ],
);

// ---------------------------------------------------------------------------
// ANNOUNCES
// ---------------------------------------------------------------------------

export const announces = sqliteTable(
  "announces",
  {
    actorApId: text("actor_ap_id").notNull(),
    objectApId: text("object_ap_id").notNull(),
    activityApId: text("activity_ap_id"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.objectApId] }),
    index("announces_object_idx").on(t.objectApId),
    index("announces_actor_idx").on(t.actorApId),
    index("announces_actor_object_idx").on(t.actorApId, t.objectApId),
  ],
);

// ---------------------------------------------------------------------------
// BOOKMARKS
// ---------------------------------------------------------------------------

export const bookmarks = sqliteTable(
  "bookmarks",
  {
    actorApId: text("actor_ap_id").notNull(),
    objectApId: text("object_ap_id").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.objectApId] }),
    index("bookmarks_actor_idx").on(t.actorApId),
  ],
);

// ---------------------------------------------------------------------------
// OBJECT_RECIPIENTS
// ---------------------------------------------------------------------------

export const objectRecipients = sqliteTable(
  "object_recipients",
  {
    objectApId: text("object_ap_id").notNull(),
    recipientApId: text("recipient_ap_id").notNull(),
    type: text("type").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.objectApId, t.recipientApId] }),
    index("object_recipients_recipient_created_idx").on(t.recipientApId, t.createdAt),
  ],
);
