/**
 * Story-related tables: storyViews, storyVotes, storyShares
 */

import {
  sqliteTable,
  text,
  integer,
  index,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils";

// ---------------------------------------------------------------------------
// STORY_VIEWS
// ---------------------------------------------------------------------------

export const storyViews = sqliteTable(
  "story_views",
  {
    actorApId: text("actor_ap_id").notNull(),
    storyApId: text("story_ap_id").notNull(),
    viewedAt: text("viewed_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.storyApId] }),
    index("story_views_actor_idx").on(t.actorApId),
    index("story_views_story_idx").on(t.storyApId),
  ],
);

// ---------------------------------------------------------------------------
// STORY_VOTES
// ---------------------------------------------------------------------------

export const storyVotes = sqliteTable(
  "story_votes",
  {
    id: text("id").primaryKey(),
    storyApId: text("story_ap_id").notNull(),
    actorApId: text("actor_ap_id").notNull(),
    optionIndex: integer("option_index").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("story_votes_story_actor_idx").on(t.storyApId, t.actorApId),
    index("story_votes_story_idx").on(t.storyApId),
    index("story_votes_actor_idx").on(t.actorApId),
  ],
);

// ---------------------------------------------------------------------------
// STORY_SHARES
// ---------------------------------------------------------------------------

export const storyShares = sqliteTable(
  "story_shares",
  {
    id: text("id").primaryKey(),
    storyApId: text("story_ap_id").notNull(),
    actorApId: text("actor_ap_id").notNull(),
    sharedAt: text("shared_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("story_shares_story_actor_idx").on(t.storyApId, t.actorApId),
    index("story_shares_story_idx").on(t.storyApId),
    index("story_shares_actor_idx").on(t.actorApId),
  ],
);
