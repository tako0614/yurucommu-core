/**
 * Community-related tables: communities, communityMembers, communityJoinRequests, communityInvites
 */

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils.ts";

// ---------------------------------------------------------------------------
// COMMUNITIES
// ---------------------------------------------------------------------------

export const communities = sqliteTable(
  "communities",
  {
    apId: text("ap_id").primaryKey(),
    type: text("type").notNull().default("Group"),
    preferredUsername: text("preferred_username").notNull().unique(),
    name: text("name").notNull(),
    summary: text("summary"),
    iconUrl: text("icon_url"),
    inbox: text("inbox").notNull(),
    outbox: text("outbox").notNull(),
    followersUrl: text("followers_url").notNull(),
    visibility: text("visibility").notNull().default("public"),
    joinPolicy: text("join_policy").notNull().default("open"),
    postPolicy: text("post_policy").notNull().default("members"),
    publicKeyPem: text("public_key_pem").notNull(),
    privateKeyPem: text("private_key_pem").notNull(),
    createdBy: text("created_by").notNull(),
    memberCount: integer("member_count").notNull().default(0),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    lastMessageAt: text("last_message_at"),
    deletedAt: text("deleted_at"),
  },
  (t) => [
    index("communities_deleted_at_idx").on(t.deletedAt),
    index("communities_visibility_idx").on(t.visibility),
  ],
);

// ---------------------------------------------------------------------------
// COMMUNITY_MEMBERS
// ---------------------------------------------------------------------------

export const communityMembers = sqliteTable(
  "community_members",
  {
    communityApId: text("community_ap_id").notNull(),
    actorApId: text("actor_ap_id").notNull(),
    role: text("role").notNull().default("member"),
    joinedAt: text("joined_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").$defaultFn(nowIso).$onUpdateFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.communityApId, t.actorApId] }),
    index("community_members_actor_idx").on(t.actorApId),
    index("community_members_comm_role_joined_idx").on(
      t.communityApId,
      t.role,
      t.joinedAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// COMMUNITY_JOIN_REQUESTS
// ---------------------------------------------------------------------------

export const communityJoinRequests = sqliteTable(
  "community_join_requests",
  {
    communityApId: text("community_ap_id").notNull(),
    actorApId: text("actor_ap_id").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    processedAt: text("processed_at"),
  },
  (t) => [
    primaryKey({ columns: [t.communityApId, t.actorApId] }),
    index("community_join_requests_comm_status_idx").on(
      t.communityApId,
      t.status,
    ),
    index("community_join_requests_actor_idx").on(t.actorApId),
  ],
);

// ---------------------------------------------------------------------------
// COMMUNITY_INVITES
// ---------------------------------------------------------------------------

export const communityInvites = sqliteTable(
  "community_invites",
  {
    id: text("id").primaryKey(),
    communityApId: text("community_ap_id").notNull(),
    invitedByApId: text("invited_by_ap_id").notNull(),
    invitedApId: text("invited_ap_id"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    expiresAt: text("expires_at"),
    usedAt: text("used_at"),
    usedByApId: text("used_by_ap_id"),
  },
  (t) => [
    index("community_invites_comm_idx").on(t.communityApId),
    index("community_invites_invited_by_idx").on(t.invitedByApId),
  ],
);
