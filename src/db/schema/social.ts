/**
 * Social graph tables: follows, blocks, mutes
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
// FOLLOWS
// ---------------------------------------------------------------------------

export const follows = sqliteTable(
  "follows",
  {
    followerApId: text("follower_ap_id").notNull(),
    followingApId: text("following_ap_id").notNull(),
    status: text("status").notNull().default("pending"),
    activityApId: text("activity_ap_id"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    acceptedAt: text("accepted_at"),
  },
  (t) => [
    primaryKey({ columns: [t.followerApId, t.followingApId] }),
    index("follows_follower_status_idx").on(t.followerApId, t.status),
    index("follows_following_status_idx").on(t.followingApId, t.status),
    index("follows_following_created_idx").on(t.followingApId, t.createdAt),
    index("follows_activity_idx").on(t.activityApId),
  ],
);

// ---------------------------------------------------------------------------
// BLOCKS
// ---------------------------------------------------------------------------

export const blocks = sqliteTable(
  "blocks",
  {
    blockerApId: text("blocker_ap_id").notNull(),
    blockedApId: text("blocked_ap_id").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").$defaultFn(nowIso).$onUpdateFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.blockerApId, t.blockedApId] }),
    index("blocks_blocker_idx").on(t.blockerApId),
    index("blocks_blocked_idx").on(t.blockedApId),
  ],
);

// ---------------------------------------------------------------------------
// MUTES
// ---------------------------------------------------------------------------

export const mutes = sqliteTable(
  "mutes",
  {
    muterApId: text("muter_ap_id").notNull(),
    mutedApId: text("muted_ap_id").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").$defaultFn(nowIso).$onUpdateFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.muterApId, t.mutedApId] }),
    index("mutes_muter_idx").on(t.muterApId),
    index("mutes_muted_idx").on(t.mutedApId),
  ],
);

// ---------------------------------------------------------------------------
// BLOCKED_DOMAINS / BLOCKED_ACTORS (federation moderation blocklist)
// ---------------------------------------------------------------------------
//
// `blockedDomains` blocks every actor whose AP-ID hostname matches; the row
// is checked once per inbound activity. `blockedActors` blocks individual
// remote actors and exists alongside per-user `blocks` so that operator-level
// moderation can override what a single user can revoke.

export const blockedDomains = sqliteTable(
  "blocked_domains",
  {
    domain: text("domain").primaryKey(),
    reason: text("reason"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("blocked_domains_created_idx").on(t.createdAt)],
);

export const blockedActors = sqliteTable(
  "blocked_actors",
  {
    actorApId: text("actor_ap_id").primaryKey(),
    reason: text("reason"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("blocked_actors_created_idx").on(t.createdAt)],
);
