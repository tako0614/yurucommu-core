-- CreateTable
CREATE TABLE "actors" (
    "ap_id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'Person',
    "preferred_username" TEXT NOT NULL,
    "name" TEXT,
    "summary" TEXT,
    "icon_url" TEXT,
    "header_url" TEXT,
    "inbox" TEXT NOT NULL,
    "outbox" TEXT NOT NULL,
    "followers_url" TEXT NOT NULL,
    "following_url" TEXT NOT NULL,
    "public_key_pem" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "takos_user_id" TEXT,
    "follower_count" INTEGER NOT NULL DEFAULT 0,
    "following_count" INTEGER NOT NULL DEFAULT 0,
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "is_private" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL DEFAULT 'member',
    "created_at" TEXT NOT NULL DEFAULT '',
    "updated_at" TEXT NOT NULL DEFAULT '',
    "deleted_at" TEXT,
    "owner_actor_ap_id" TEXT
);

-- CreateTable
CREATE TABLE "actor_cache" (
    "ap_id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'Person',
    "preferred_username" TEXT,
    "name" TEXT,
    "summary" TEXT,
    "icon_url" TEXT,
    "inbox" TEXT NOT NULL,
    "outbox" TEXT,
    "followers_url" TEXT,
    "following_url" TEXT,
    "shared_inbox" TEXT,
    "public_key_id" TEXT,
    "public_key_pem" TEXT,
    "raw_json" TEXT NOT NULL,
    "last_fetched_at" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "objects" (
    "ap_id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'Note',
    "attributed_to" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "summary" TEXT,
    "attachments_json" TEXT NOT NULL DEFAULT '[]',
    "in_reply_to" TEXT,
    "conversation" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "to_json" TEXT NOT NULL DEFAULT '[]',
    "cc_json" TEXT NOT NULL DEFAULT '[]',
    "audience_json" TEXT NOT NULL DEFAULT '[]',
    "community_ap_id" TEXT,
    "end_time" TEXT,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "reply_count" INTEGER NOT NULL DEFAULT 0,
    "announce_count" INTEGER NOT NULL DEFAULT 0,
    "share_count" INTEGER NOT NULL DEFAULT 0,
    "published" TEXT NOT NULL DEFAULT '',
    "updated" TEXT,
    "is_local" INTEGER NOT NULL DEFAULT 1,
    "raw_json" TEXT,
    "deleted_at" TEXT,
    CONSTRAINT "objects_attributed_to_fkey" FOREIGN KEY ("attributed_to") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "objects_community_ap_id_fkey" FOREIGN KEY ("community_ap_id") REFERENCES "communities" ("ap_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "follows" (
    "follower_ap_id" TEXT NOT NULL,
    "following_ap_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "activity_ap_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT '',
    "accepted_at" TEXT,

    PRIMARY KEY ("follower_ap_id", "following_ap_id"),
    CONSTRAINT "follows_follower_ap_id_fkey" FOREIGN KEY ("follower_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "follows_following_ap_id_fkey" FOREIGN KEY ("following_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "likes" (
    "actor_ap_id" TEXT NOT NULL,
    "object_ap_id" TEXT NOT NULL,
    "activity_ap_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "object_ap_id"),
    CONSTRAINT "likes_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "likes_object_ap_id_fkey" FOREIGN KEY ("object_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "announces" (
    "actor_ap_id" TEXT NOT NULL,
    "object_ap_id" TEXT NOT NULL,
    "activity_ap_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "object_ap_id"),
    CONSTRAINT "announces_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "announces_object_ap_id_fkey" FOREIGN KEY ("object_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "bookmarks" (
    "actor_ap_id" TEXT NOT NULL,
    "object_ap_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "object_ap_id"),
    CONSTRAINT "bookmarks_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "bookmarks_object_ap_id_fkey" FOREIGN KEY ("object_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "blocks" (
    "blocker_ap_id" TEXT NOT NULL,
    "blocked_ap_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT '',
    "updated_at" TEXT DEFAULT '',

    PRIMARY KEY ("blocker_ap_id", "blocked_ap_id"),
    CONSTRAINT "blocks_blocker_ap_id_fkey" FOREIGN KEY ("blocker_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "blocks_blocked_ap_id_fkey" FOREIGN KEY ("blocked_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "mutes" (
    "muter_ap_id" TEXT NOT NULL,
    "muted_ap_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT '',
    "updated_at" TEXT DEFAULT '',

    PRIMARY KEY ("muter_ap_id", "muted_ap_id"),
    CONSTRAINT "mutes_muter_ap_id_fkey" FOREIGN KEY ("muter_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "mutes_muted_ap_id_fkey" FOREIGN KEY ("muted_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activities" (
    "ap_id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "actor_ap_id" TEXT NOT NULL,
    "object_ap_id" TEXT,
    "object_json" TEXT,
    "target_ap_id" TEXT,
    "raw_json" TEXT NOT NULL,
    "direction" TEXT,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "activities_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "activities_object_ap_id_fkey" FOREIGN KEY ("object_ap_id") REFERENCES "objects" ("ap_id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "delivery_queue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_ap_id" TEXT NOT NULL,
    "inbox_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TEXT,
    "processing_started_at" TEXT,
    "next_attempt_at" TEXT NOT NULL DEFAULT '',
    "delivered_at" TEXT,
    "error" TEXT,
    "created_at" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "delivery_circuit" (
    "endpoint" TEXT NOT NULL PRIMARY KEY,
    "state" TEXT NOT NULL DEFAULT 'closed',
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "recent_outcomes_json" TEXT NOT NULL DEFAULT '[]',
    "open_until" TEXT,
    "half_open_probe_attempts" INTEGER NOT NULL DEFAULT 0,
    "half_open_probe_successes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT '',
    "updated_at" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "communities" (
    "ap_id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL DEFAULT 'Group',
    "preferred_username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "icon_url" TEXT,
    "inbox" TEXT NOT NULL,
    "outbox" TEXT NOT NULL,
    "followers_url" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "join_policy" TEXT NOT NULL DEFAULT 'open',
    "post_policy" TEXT NOT NULL DEFAULT 'members',
    "public_key_pem" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT '',
    "last_message_at" TEXT,
    "deleted_at" TEXT
);

-- CreateTable
CREATE TABLE "community_members" (
    "community_ap_id" TEXT NOT NULL,
    "actor_ap_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "joined_at" TEXT NOT NULL DEFAULT '',
    "updated_at" TEXT DEFAULT '',

    PRIMARY KEY ("community_ap_id", "actor_ap_id"),
    CONSTRAINT "community_members_community_ap_id_fkey" FOREIGN KEY ("community_ap_id") REFERENCES "communities" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "community_members_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "community_join_requests" (
    "community_ap_id" TEXT NOT NULL,
    "actor_ap_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TEXT NOT NULL DEFAULT '',
    "processed_at" TEXT,

    PRIMARY KEY ("community_ap_id", "actor_ap_id"),
    CONSTRAINT "community_join_requests_community_ap_id_fkey" FOREIGN KEY ("community_ap_id") REFERENCES "communities" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "community_join_requests_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "community_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_ap_id" TEXT NOT NULL,
    "invited_by_ap_id" TEXT NOT NULL,
    "invited_ap_id" TEXT,
    "created_at" TEXT NOT NULL DEFAULT '',
    "expires_at" TEXT,
    "used_at" TEXT,
    "used_by_ap_id" TEXT,
    CONSTRAINT "community_invites_community_ap_id_fkey" FOREIGN KEY ("community_ap_id") REFERENCES "communities" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "community_invites_invited_by_ap_id_fkey" FOREIGN KEY ("invited_by_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "object_recipients" (
    "object_ap_id" TEXT NOT NULL,
    "recipient_ap_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("object_ap_id", "recipient_ap_id"),
    CONSTRAINT "object_recipients_object_ap_id_fkey" FOREIGN KEY ("object_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "object_recipients_recipient_ap_id_fkey" FOREIGN KEY ("recipient_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "inbox" (
    "actor_ap_id" TEXT NOT NULL,
    "activity_ap_id" TEXT NOT NULL,
    "read" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "activity_ap_id"),
    CONSTRAINT "inbox_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "inbox_activity_ap_id_fkey" FOREIGN KEY ("activity_ap_id") REFERENCES "activities" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "member_id" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT '',
    "provider" TEXT,
    "provider_access_token" TEXT,
    "provider_refresh_token" TEXT,
    "provider_token_expires_at" TEXT,
    CONSTRAINT "sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "story_views" (
    "actor_ap_id" TEXT NOT NULL,
    "story_ap_id" TEXT NOT NULL,
    "viewed_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "story_ap_id"),
    CONSTRAINT "story_views_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_views_story_ap_id_fkey" FOREIGN KEY ("story_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "story_votes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "story_ap_id" TEXT NOT NULL,
    "actor_ap_id" TEXT NOT NULL,
    "option_index" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "story_votes_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_votes_story_ap_id_fkey" FOREIGN KEY ("story_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "story_shares" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "story_ap_id" TEXT NOT NULL,
    "actor_ap_id" TEXT NOT NULL,
    "shared_at" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "story_shares_actor_ap_id_fkey" FOREIGN KEY ("actor_ap_id") REFERENCES "actors" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "story_shares_story_ap_id_fkey" FOREIGN KEY ("story_ap_id") REFERENCES "objects" ("ap_id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notification_archived" (
    "actor_ap_id" TEXT NOT NULL,
    "activity_ap_id" TEXT NOT NULL,
    "archived_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "activity_ap_id")
);

-- CreateTable
CREATE TABLE "instance_actor" (
    "ap_id" TEXT NOT NULL PRIMARY KEY,
    "preferred_username" TEXT NOT NULL,
    "name" TEXT,
    "summary" TEXT,
    "public_key_pem" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "join_policy" TEXT NOT NULL DEFAULT 'open',
    "posting_policy" TEXT NOT NULL DEFAULT 'members',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "created_at" TEXT NOT NULL DEFAULT '',
    "updated_at" TEXT NOT NULL DEFAULT ''
);

-- CreateTable
CREATE TABLE "dm_typing" (
    "actor_ap_id" TEXT NOT NULL,
    "recipient_ap_id" TEXT NOT NULL,
    "last_typed_at" TEXT NOT NULL,

    PRIMARY KEY ("actor_ap_id", "recipient_ap_id")
);

-- CreateTable
CREATE TABLE "dm_read_status" (
    "actor_ap_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "last_read_at" TEXT NOT NULL DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "conversation_id")
);

-- CreateTable
CREATE TABLE "dm_archived_conversations" (
    "actor_ap_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "archived_at" TEXT DEFAULT '',

    PRIMARY KEY ("actor_ap_id", "conversation_id")
);

-- CreateTable
CREATE TABLE "media_uploads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "r2_key" TEXT NOT NULL,
    "uploader_ap_id" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE UNIQUE INDEX "actors_preferred_username_key" ON "actors"("preferred_username");

-- CreateIndex
CREATE UNIQUE INDEX "actors_takos_user_id_key" ON "actors"("takos_user_id");

-- CreateIndex
CREATE INDEX "actors_preferred_username_idx" ON "actors"("preferred_username");

-- CreateIndex
CREATE INDEX "actors_takos_user_id_idx" ON "actors"("takos_user_id");

-- CreateIndex
CREATE INDEX "actors_deleted_at_idx" ON "actors"("deleted_at");

-- CreateIndex
CREATE INDEX "objects_attributed_to_idx" ON "objects"("attributed_to");

-- CreateIndex
CREATE INDEX "objects_in_reply_to_idx" ON "objects"("in_reply_to");

-- CreateIndex
CREATE INDEX "objects_community_ap_id_idx" ON "objects"("community_ap_id");

-- CreateIndex
CREATE INDEX "objects_published_idx" ON "objects"("published" DESC);

-- CreateIndex
CREATE INDEX "objects_visibility_idx" ON "objects"("visibility");

-- CreateIndex
CREATE INDEX "objects_end_time_idx" ON "objects"("end_time");

-- CreateIndex
CREATE INDEX "objects_deleted_at_idx" ON "objects"("deleted_at");

-- CreateIndex
CREATE INDEX "objects_attributed_to_published_idx" ON "objects"("attributed_to", "published" DESC);

-- CreateIndex
CREATE INDEX "objects_visibility_published_idx" ON "objects"("visibility", "published" DESC);

-- CreateIndex
CREATE INDEX "objects_type_visibility_published_idx" ON "objects"("type", "visibility", "published" DESC);

-- CreateIndex
CREATE INDEX "objects_conversation_idx" ON "objects"("conversation");

-- CreateIndex
CREATE INDEX "objects_community_ap_id_published_idx" ON "objects"("community_ap_id", "published" DESC);

-- CreateIndex
CREATE INDEX "objects_is_local_idx" ON "objects"("is_local");

-- CreateIndex
CREATE INDEX "follows_follower_ap_id_status_idx" ON "follows"("follower_ap_id", "status");

-- CreateIndex
CREATE INDEX "follows_following_ap_id_status_idx" ON "follows"("following_ap_id", "status");

-- CreateIndex
CREATE INDEX "follows_following_ap_id_created_at_idx" ON "follows"("following_ap_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "follows_activity_ap_id_idx" ON "follows"("activity_ap_id");

-- CreateIndex
CREATE INDEX "likes_object_ap_id_idx" ON "likes"("object_ap_id");

-- CreateIndex
CREATE INDEX "likes_actor_ap_id_idx" ON "likes"("actor_ap_id");

-- CreateIndex
CREATE INDEX "likes_actor_ap_id_object_ap_id_idx" ON "likes"("actor_ap_id", "object_ap_id");

-- CreateIndex
CREATE INDEX "announces_object_ap_id_idx" ON "announces"("object_ap_id");

-- CreateIndex
CREATE INDEX "announces_actor_ap_id_idx" ON "announces"("actor_ap_id");

-- CreateIndex
CREATE INDEX "announces_actor_ap_id_object_ap_id_idx" ON "announces"("actor_ap_id", "object_ap_id");

-- CreateIndex
CREATE INDEX "bookmarks_actor_ap_id_idx" ON "bookmarks"("actor_ap_id");

-- CreateIndex
CREATE INDEX "blocks_blocker_ap_id_idx" ON "blocks"("blocker_ap_id");

-- CreateIndex
CREATE INDEX "blocks_blocked_ap_id_idx" ON "blocks"("blocked_ap_id");

-- CreateIndex
CREATE INDEX "mutes_muter_ap_id_idx" ON "mutes"("muter_ap_id");

-- CreateIndex
CREATE INDEX "mutes_muted_ap_id_idx" ON "mutes"("muted_ap_id");

-- CreateIndex
CREATE INDEX "activities_actor_ap_id_idx" ON "activities"("actor_ap_id");

-- CreateIndex
CREATE INDEX "activities_object_ap_id_idx" ON "activities"("object_ap_id");

-- CreateIndex
CREATE INDEX "activities_type_idx" ON "activities"("type");

-- CreateIndex
CREATE INDEX "activities_type_created_at_idx" ON "activities"("type", "created_at" DESC);

-- CreateIndex
CREATE INDEX "activities_direction_processed_idx" ON "activities"("direction", "processed");

-- CreateIndex
CREATE INDEX "activities_direction_processed_created_at_idx" ON "activities"("direction", "processed", "created_at");

-- CreateIndex
CREATE INDEX "delivery_queue_activity_ap_id_idx" ON "delivery_queue"("activity_ap_id");

-- CreateIndex
CREATE INDEX "delivery_queue_next_attempt_at_idx" ON "delivery_queue"("next_attempt_at");

-- CreateIndex
CREATE INDEX "delivery_queue_status_next_attempt_at_idx" ON "delivery_queue"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "delivery_circuit_state_updated_at_idx" ON "delivery_circuit"("state", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "communities_preferred_username_key" ON "communities"("preferred_username");

-- CreateIndex
CREATE INDEX "communities_deleted_at_idx" ON "communities"("deleted_at");

-- CreateIndex
CREATE INDEX "communities_visibility_idx" ON "communities"("visibility");

-- CreateIndex
CREATE INDEX "community_members_actor_ap_id_idx" ON "community_members"("actor_ap_id");

-- CreateIndex
CREATE INDEX "community_members_community_ap_id_role_joined_at_idx" ON "community_members"("community_ap_id", "role", "joined_at");

-- CreateIndex
CREATE INDEX "community_join_requests_community_ap_id_status_idx" ON "community_join_requests"("community_ap_id", "status");

-- CreateIndex
CREATE INDEX "community_join_requests_actor_ap_id_idx" ON "community_join_requests"("actor_ap_id");

-- CreateIndex
CREATE INDEX "community_invites_community_ap_id_idx" ON "community_invites"("community_ap_id");

-- CreateIndex
CREATE INDEX "community_invites_invited_by_ap_id_idx" ON "community_invites"("invited_by_ap_id");

-- CreateIndex
CREATE INDEX "object_recipients_recipient_ap_id_created_at_idx" ON "object_recipients"("recipient_ap_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inbox_actor_ap_id_read_created_at_idx" ON "inbox"("actor_ap_id", "read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inbox_activity_ap_id_idx" ON "inbox"("activity_ap_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_access_token_key" ON "sessions"("access_token");

-- CreateIndex
CREATE INDEX "sessions_member_id_idx" ON "sessions"("member_id");

-- CreateIndex
CREATE INDEX "sessions_provider_idx" ON "sessions"("provider");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "story_views_actor_ap_id_idx" ON "story_views"("actor_ap_id");

-- CreateIndex
CREATE INDEX "story_views_story_ap_id_idx" ON "story_views"("story_ap_id");

-- CreateIndex
CREATE INDEX "story_votes_story_ap_id_idx" ON "story_votes"("story_ap_id");

-- CreateIndex
CREATE INDEX "story_votes_actor_ap_id_idx" ON "story_votes"("actor_ap_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_votes_story_ap_id_actor_ap_id_key" ON "story_votes"("story_ap_id", "actor_ap_id");

-- CreateIndex
CREATE INDEX "story_shares_story_ap_id_idx" ON "story_shares"("story_ap_id");

-- CreateIndex
CREATE INDEX "story_shares_actor_ap_id_idx" ON "story_shares"("actor_ap_id");

-- CreateIndex
CREATE UNIQUE INDEX "story_shares_story_ap_id_actor_ap_id_key" ON "story_shares"("story_ap_id", "actor_ap_id");

-- CreateIndex
CREATE INDEX "notification_archived_actor_ap_id_idx" ON "notification_archived"("actor_ap_id");

-- CreateIndex
CREATE INDEX "notification_archived_actor_ap_id_archived_at_idx" ON "notification_archived"("actor_ap_id", "archived_at");

-- CreateIndex
CREATE INDEX "dm_typing_recipient_ap_id_last_typed_at_idx" ON "dm_typing"("recipient_ap_id", "last_typed_at" DESC);

-- CreateIndex
CREATE INDEX "dm_read_status_actor_ap_id_idx" ON "dm_read_status"("actor_ap_id");

-- CreateIndex
CREATE INDEX "dm_read_status_actor_ap_id_last_read_at_idx" ON "dm_read_status"("actor_ap_id", "last_read_at" DESC);

-- CreateIndex
CREATE INDEX "dm_archived_conversations_actor_ap_id_idx" ON "dm_archived_conversations"("actor_ap_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_uploads_r2_key_key" ON "media_uploads"("r2_key");

-- CreateIndex
CREATE INDEX "media_uploads_uploader_ap_id_idx" ON "media_uploads"("uploader_ap_id");

-- CreateIndex
CREATE INDEX "media_uploads_r2_key_idx" ON "media_uploads"("r2_key");
