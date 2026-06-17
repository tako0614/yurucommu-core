/**
 * Actor-related tables: actors, actorCache, instanceActor, sessions
 */

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils.ts";

// ---------------------------------------------------------------------------
// ACTORS
// ---------------------------------------------------------------------------

export const actors = sqliteTable(
  "actors",
  {
    apId: text("ap_id").primaryKey(),
    type: text("type").notNull().default("Person"),
    preferredUsername: text("preferred_username").notNull().unique(),
    name: text("name"),
    summary: text("summary"),
    iconUrl: text("icon_url"),
    headerUrl: text("header_url"),
    inbox: text("inbox").notNull(),
    outbox: text("outbox").notNull(),
    followersUrl: text("followers_url").notNull(),
    followingUrl: text("following_url").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    privateKeyPem: text("private_key_pem").notNull(),
    takosUserId: text("takos_user_id").unique(),
    followerCount: integer("follower_count").notNull().default(0),
    followingCount: integer("following_count").notNull().default(0),
    postCount: integer("post_count").notNull().default(0),
    isPrivate: integer("is_private").notNull().default(0),
    role: text("role").notNull().default("member"),
    // Structured profile metadata (Mastodon PropertyValue): JSON array of
    // { name, value } rows rendered as `attachment` on the served actor doc.
    fieldsJson: text("fields_json").notNull().default("[]"),
    // Account-migration aliases: JSON array of AP IDs this account claims
    // (alsoKnownAs). `movedTo` is the migration target once the account moves.
    alsoKnownAsJson: text("also_known_as_json").notNull().default("[]"),
    movedTo: text("moved_to"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(nowIso)
      .$onUpdateFn(nowIso),
    deletedAt: text("deleted_at"),
    ownerActorApId: text("owner_actor_ap_id"),
  },
  (t) => [
    index("actors_preferred_username_idx").on(t.preferredUsername),
    index("actors_takos_user_id_idx").on(t.takosUserId),
    index("actors_deleted_at_idx").on(t.deletedAt),
  ],
);

// ---------------------------------------------------------------------------
// ACTOR_CACHE
// ---------------------------------------------------------------------------

export const actorCache = sqliteTable("actor_cache", {
  apId: text("ap_id").primaryKey(),
  type: text("type").notNull().default("Person"),
  preferredUsername: text("preferred_username"),
  name: text("name"),
  summary: text("summary"),
  iconUrl: text("icon_url"),
  inbox: text("inbox").notNull(),
  outbox: text("outbox"),
  followersUrl: text("followers_url"),
  followingUrl: text("following_url"),
  sharedInbox: text("shared_inbox"),
  publicKeyId: text("public_key_id"),
  publicKeyPem: text("public_key_pem"),
  rawJson: text("raw_json").notNull(),
  lastFetchedAt: text("last_fetched_at").notNull().$defaultFn(nowIso),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
});

// ---------------------------------------------------------------------------
// INSTANCE_ACTOR
// ---------------------------------------------------------------------------

export const instanceActor = sqliteTable("instance_actor", {
  apId: text("ap_id").primaryKey(),
  preferredUsername: text("preferred_username").notNull(),
  name: text("name"),
  summary: text("summary"),
  publicKeyPem: text("public_key_pem").notNull(),
  privateKeyPem: text("private_key_pem").notNull(),
  joinPolicy: text("join_policy").notNull().default("open"),
  postingPolicy: text("posting_policy").notNull().default("members"),
  visibility: text("visibility").notNull().default("public"),
  createdAt: text("created_at").notNull().$defaultFn(nowIso),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(nowIso)
    .$onUpdateFn(nowIso),
});

// ---------------------------------------------------------------------------
// SESSIONS
// ---------------------------------------------------------------------------

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    memberId: text("member_id").notNull(),
    accessToken: text("access_token").notNull().unique(),
    refreshToken: text("refresh_token"),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    provider: text("provider"),
    providerAccessToken: text("provider_access_token"),
    providerRefreshToken: text("provider_refresh_token"),
    providerTokenExpiresAt: text("provider_token_expires_at"),
  },
  (t) => [
    index("sessions_member_idx").on(t.memberId),
    index("sessions_provider_idx").on(t.provider),
    index("sessions_expires_idx").on(t.expiresAt),
  ],
);
