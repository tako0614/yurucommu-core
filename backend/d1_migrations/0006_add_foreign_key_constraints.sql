-- Migration: Add Foreign Key Constraints
-- Generated: 2025-10-19
-- 
-- This migration recreates all tables with proper foreign key constraints
-- and cascade delete behavior for data integrity.
--
-- ⚠️ WARNING: This will drop and recreate ALL tables!
-- Make sure to backup data before running in production.

-- Enable foreign key constraints
PRAGMA foreign_keys = ON;

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS ap_delivery_queue;
DROP TABLE IF EXISTS ap_instances;
DROP TABLE IF EXISTS ap_keypairs;
DROP TABLE IF EXISTS ap_outbox_activities;
DROP TABLE IF EXISTS ap_inbox_activities;
DROP TABLE IF EXISTS ap_followers;
DROP TABLE IF EXISTS ap_follows;
DROP TABLE IF EXISTS ap_actors;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS push_devices;
DROP TABLE IF EXISTS ap_announces;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS chat_channel_messages;
DROP TABLE IF EXISTS chat_dm_messages;
DROP TABLE IF EXISTS chat_dm_threads;
DROP TABLE IF EXISTS access_tokens;
DROP TABLE IF EXISTS user_accounts;
DROP TABLE IF EXISTS friendships;
DROP TABLE IF EXISTS stories;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS post_reactions;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS channels;
DROP TABLE IF EXISTS member_invites;
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS communities;
DROP TABLE IF EXISTS users;

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "is_private" INTEGER NOT NULL DEFAULT 1,
    "profile_completed_at" DATETIME,
    "summary" TEXT,
    "manually_approves_followers" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "communities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "icon_url" TEXT NOT NULL DEFAULT '',
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "description" TEXT NOT NULL DEFAULT '',
    "invite_policy" TEXT NOT NULL DEFAULT 'owner_mod',
    "created_by" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "ap_id" TEXT,
    CONSTRAINT "communities_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "memberships" (
    "community_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '',
    "joined_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    PRIMARY KEY ("community_id", "user_id"),
    CONSTRAINT "memberships_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "invites" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT NOT NULL,
    "expires_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "invites_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "invites_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "member_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT NOT NULL,
    "invited_user_id" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "member_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "member_invites_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,

    PRIMARY KEY ("id", "community_id"),
    CONSTRAINT "channels_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT,
    "author_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "media_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL,
    "pinned" INTEGER NOT NULL DEFAULT 0,
    "broadcast_all" INTEGER NOT NULL DEFAULT 0,
    "visible_to_friends" INTEGER NOT NULL DEFAULT 0,
    "attributed_community_id" TEXT,
    "ap_object_id" TEXT,
    "ap_attributed_to" TEXT,
    "in_reply_to" TEXT,
    "ap_activity_id" TEXT,
    CONSTRAINT "posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "posts_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "post_reactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "ap_activity_id" TEXT,
    CONSTRAINT "post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "post_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "ap_object_id" TEXT,
    "ap_activity_id" TEXT,
    CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT,
    "author_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "items_json" TEXT NOT NULL,
    "broadcast_all" INTEGER NOT NULL DEFAULT 1,
    "visible_to_friends" INTEGER NOT NULL DEFAULT 1,
    "attributed_community_id" TEXT,
    CONSTRAINT "stories_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "stories_community_id_fkey" FOREIGN KEY ("community_id") REFERENCES "communities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "friendships" (
    "requester_id" TEXT NOT NULL,
    "addressee_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,

    PRIMARY KEY ("requester_id", "addressee_id"),
    CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_accounts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "access_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    CONSTRAINT "access_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_dm_threads" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participants_hash" TEXT NOT NULL,
    "participants_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "chat_dm_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "thread_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content_html" TEXT NOT NULL,
    "raw_activity_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_dm_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "chat_dm_threads" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "chat_dm_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "chat_channel_messages" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "content_html" TEXT NOT NULL,
    "raw_activity_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "chat_channel_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "read" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ap_announces" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "object_id" TEXT NOT NULL,
    "local_post_id" TEXT,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "ap_announces_local_post_id_fkey" FOREIGN KEY ("local_post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "push_devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "device_name" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "push_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "last_seen" DATETIME NOT NULL,
    "expires_at" DATETIME,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ap_actors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Person',
    "display_name" TEXT NOT NULL,
    "summary" TEXT,
    "icon_url" TEXT,
    "inbox_url" TEXT NOT NULL,
    "outbox_url" TEXT NOT NULL,
    "followers_url" TEXT,
    "following_url" TEXT,
    "public_key_pem" TEXT NOT NULL,
    "public_key_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "last_fetched_at" DATETIME
);

-- CreateTable
CREATE TABLE "ap_follows" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "local_user_id" TEXT NOT NULL,
    "remote_actor_id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL,
    "accepted_at" DATETIME
);

-- CreateTable
CREATE TABLE "ap_followers" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "local_user_id" TEXT NOT NULL,
    "remote_actor_id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL,
    "accepted_at" DATETIME
);

-- CreateTable
CREATE TABLE "ap_inbox_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "local_user_id" TEXT NOT NULL,
    "remote_actor_id" TEXT,
    "activity_id" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "activity_json" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL,
    "processed_at" DATETIME
);

-- CreateTable
CREATE TABLE "ap_outbox_activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "local_user_id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "activity_type" TEXT NOT NULL,
    "activity_json" TEXT NOT NULL,
    "object_id" TEXT,
    "object_type" TEXT,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ap_keypairs" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "public_key_pem" TEXT NOT NULL,
    "private_key_pem" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    CONSTRAINT "ap_keypairs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ap_instances" (
    "domain" TEXT NOT NULL PRIMARY KEY,
    "software" TEXT,
    "version" TEXT,
    "last_checked_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ap_delivery_queue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT NOT NULL,
    "target_inbox_url" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_attempt_at" DATETIME,
    "next_attempt_at" DATETIME,
    "error_message" TEXT,
    "created_at" DATETIME NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" DATETIME,
    "last_error" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "communities_ap_id_key" ON "communities"("ap_id");

-- CreateIndex
CREATE UNIQUE INDEX "posts_ap_object_id_key" ON "posts"("ap_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "posts_ap_activity_id_key" ON "posts"("ap_activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "post_reactions_ap_activity_id_key" ON "post_reactions"("ap_activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "comments_ap_object_id_key" ON "comments"("ap_object_id");

-- CreateIndex
CREATE UNIQUE INDEX "comments_ap_activity_id_key" ON "comments"("ap_activity_id");

-- CreateIndex
CREATE INDEX "user_accounts_user_id_idx" ON "user_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_provider_provider_account_id_key" ON "user_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_tokens_token_hash_key" ON "access_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "access_tokens_user_id_idx" ON "access_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_dm_threads_participants_hash_key" ON "chat_dm_threads"("participants_hash");

-- CreateIndex
CREATE INDEX "chat_dm_messages_thread_id_created_at_idx" ON "chat_dm_messages"("thread_id", "created_at");

-- CreateIndex
CREATE INDEX "chat_channel_messages_community_id_channel_id_created_at_idx" ON "chat_channel_messages"("community_id", "channel_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ap_announces_activity_id_key" ON "ap_announces"("activity_id");

-- CreateIndex
CREATE INDEX "ap_announces_local_post_id_idx" ON "ap_announces"("local_post_id");

-- CreateIndex
CREATE INDEX "ap_announces_actor_id_idx" ON "ap_announces"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "ap_actors_domain_idx" ON "ap_actors"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "ap_actors_handle_domain_key" ON "ap_actors"("handle", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "ap_follows_activity_id_key" ON "ap_follows"("activity_id");

-- CreateIndex
CREATE INDEX "ap_follows_local_user_id_idx" ON "ap_follows"("local_user_id");

-- CreateIndex
CREATE INDEX "ap_follows_remote_actor_id_idx" ON "ap_follows"("remote_actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_follows_local_user_id_remote_actor_id_key" ON "ap_follows"("local_user_id", "remote_actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_followers_activity_id_key" ON "ap_followers"("activity_id");

-- CreateIndex
CREATE INDEX "ap_followers_local_user_id_idx" ON "ap_followers"("local_user_id");

-- CreateIndex
CREATE INDEX "ap_followers_remote_actor_id_idx" ON "ap_followers"("remote_actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_followers_local_user_id_remote_actor_id_key" ON "ap_followers"("local_user_id", "remote_actor_id");

-- CreateIndex
CREATE INDEX "ap_inbox_activities_local_user_id_idx" ON "ap_inbox_activities"("local_user_id");

-- CreateIndex
CREATE INDEX "ap_inbox_activities_status_idx" ON "ap_inbox_activities"("status");

-- CreateIndex
CREATE INDEX "ap_inbox_activities_activity_id_idx" ON "ap_inbox_activities"("activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_inbox_activities_local_user_id_activity_id_key" ON "ap_inbox_activities"("local_user_id", "activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_outbox_activities_activity_id_key" ON "ap_outbox_activities"("activity_id");

-- CreateIndex
CREATE INDEX "ap_outbox_activities_local_user_id_idx" ON "ap_outbox_activities"("local_user_id");

-- CreateIndex
CREATE INDEX "ap_outbox_activities_created_at_idx" ON "ap_outbox_activities"("created_at");

-- CreateIndex
CREATE INDEX "ap_delivery_queue_status_idx" ON "ap_delivery_queue"("status");

-- CreateIndex
CREATE INDEX "ap_delivery_queue_next_attempt_at_idx" ON "ap_delivery_queue"("next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "ap_delivery_queue_activity_id_target_inbox_url_key" ON "ap_delivery_queue"("activity_id", "target_inbox_url");
