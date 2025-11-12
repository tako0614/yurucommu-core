-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "is_private" INTEGER NOT NULL DEFAULT 1,
    "profile_completed_at" DATETIME
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
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "memberships" (
    "community_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "nickname" TEXT NOT NULL DEFAULT '',
    "joined_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',

    PRIMARY KEY ("community_id", "user_id")
);

-- CreateTable
CREATE TABLE "invites" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT NOT NULL,
    "expires_at" DATETIME,
    "created_by" TEXT NOT NULL,
    "max_uses" INTEGER NOT NULL DEFAULT 0,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "member_invites" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT NOT NULL,
    "invited_user_id" TEXT NOT NULL,
    "invited_by" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "channels" (
    "id" TEXT NOT NULL,
    "community_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,

    PRIMARY KEY ("id", "community_id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "media_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL,
    "pinned" INTEGER NOT NULL DEFAULT 0,
    "broadcast_all" INTEGER NOT NULL DEFAULT 0,
    "visible_to_friends" INTEGER NOT NULL DEFAULT 0,
    "attributed_community_id" TEXT
);

-- CreateTable
CREATE TABLE "post_reactions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "post_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL
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
    "attributed_community_id" TEXT
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
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "ref_type" TEXT NOT NULL,
    "ref_id" TEXT NOT NULL,
    "message" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "read" INTEGER NOT NULL DEFAULT 0
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
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL,
    "last_seen" DATETIME NOT NULL,
    "expires_at" DATETIME
);

-- CreateIndex
CREATE INDEX "user_accounts_user_id_idx" ON "user_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_accounts_provider_provider_account_id_key" ON "user_accounts"("provider", "provider_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_devices_token_key" ON "push_devices"("token");

-- CreateIndex
CREATE INDEX "push_devices_user_id_idx" ON "push_devices"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

