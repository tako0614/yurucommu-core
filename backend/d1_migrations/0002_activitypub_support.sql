-- Migration: Add ActivityPub support
-- Date: 2025-10-17

-- Add ActivityPub fields to existing tables
ALTER TABLE users ADD COLUMN summary TEXT;
ALTER TABLE users ADD COLUMN manually_approves_followers INTEGER DEFAULT 0;

ALTER TABLE communities ADD COLUMN ap_id TEXT;
CREATE UNIQUE INDEX idx_communities_ap_id ON communities(ap_id) WHERE ap_id IS NOT NULL;

ALTER TABLE posts ADD COLUMN ap_object_id TEXT;
ALTER TABLE posts ADD COLUMN ap_activity_id TEXT;
ALTER TABLE posts ADD COLUMN ap_attributed_to TEXT;
ALTER TABLE posts ADD COLUMN in_reply_to TEXT;
CREATE UNIQUE INDEX idx_posts_ap_object_id ON posts(ap_object_id) WHERE ap_object_id IS NOT NULL;
CREATE UNIQUE INDEX idx_posts_ap_activity_id ON posts(ap_activity_id) WHERE ap_activity_id IS NOT NULL;

ALTER TABLE post_reactions ADD COLUMN ap_activity_id TEXT;
CREATE UNIQUE INDEX idx_post_reactions_ap_activity_id ON post_reactions(ap_activity_id) WHERE ap_activity_id IS NOT NULL;

-- Create ActivityPub tables

-- Remote actors (federated users from other instances)
CREATE TABLE ap_actors (
    id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    domain TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Person',
    display_name TEXT NOT NULL,
    summary TEXT,
    icon_url TEXT,
    inbox_url TEXT NOT NULL,
    outbox_url TEXT NOT NULL,
    followers_url TEXT,
    following_url TEXT,
    public_key_pem TEXT NOT NULL,
    public_key_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_fetched_at TEXT
);

CREATE UNIQUE INDEX idx_ap_actors_handle_domain ON ap_actors(handle, domain);
CREATE INDEX idx_ap_actors_domain ON ap_actors(domain);

-- Following relationships (local user follows remote actor)
CREATE TABLE ap_follows (
    id TEXT PRIMARY KEY,
    local_user_id TEXT NOT NULL,
    remote_actor_id TEXT NOT NULL,
    activity_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    accepted_at TEXT
);

CREATE INDEX idx_ap_follows_local_user ON ap_follows(local_user_id);
CREATE INDEX idx_ap_follows_remote_actor ON ap_follows(remote_actor_id);

-- Follower relationships (remote actor follows local user)
CREATE TABLE ap_followers (
    id TEXT PRIMARY KEY,
    local_user_id TEXT NOT NULL,
    remote_actor_id TEXT NOT NULL,
    activity_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    accepted_at TEXT
);

CREATE INDEX idx_ap_followers_local_user ON ap_followers(local_user_id);
CREATE INDEX idx_ap_followers_remote_actor ON ap_followers(remote_actor_id);

-- Inbox activities (received from remote instances)
CREATE TABLE ap_inbox_activities (
    id TEXT PRIMARY KEY,
    local_user_id TEXT NOT NULL,
    remote_actor_id TEXT,
    activity_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    activity_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at TEXT NOT NULL,
    processed_at TEXT
);

CREATE INDEX idx_ap_inbox_user ON ap_inbox_activities(local_user_id);
CREATE INDEX idx_ap_inbox_status ON ap_inbox_activities(status);
CREATE INDEX idx_ap_inbox_activity_id ON ap_inbox_activities(activity_id);

-- Outbox activities (sent to remote instances)
CREATE TABLE ap_outbox_activities (
    id TEXT PRIMARY KEY,
    local_user_id TEXT NOT NULL,
    activity_id TEXT NOT NULL UNIQUE,
    activity_type TEXT NOT NULL,
    activity_json TEXT NOT NULL,
    object_id TEXT,
    object_type TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_ap_outbox_user ON ap_outbox_activities(local_user_id);
CREATE INDEX idx_ap_outbox_created ON ap_outbox_activities(created_at DESC);

-- Keypairs for HTTP Signatures (one per user)
CREATE TABLE ap_keypairs (
    user_id TEXT PRIMARY KEY,
    public_key_pem TEXT NOT NULL,
    private_key_pem TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Remote instance metadata
CREATE TABLE ap_instances (
    domain TEXT PRIMARY KEY,
    software TEXT,
    version TEXT,
    last_checked_at TEXT NOT NULL
);

-- Delivery queue for outgoing activities
CREATE TABLE ap_delivery_queue (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    target_inbox_url TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'pending',
    last_attempt_at TEXT,
    next_attempt_at TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL
);

CREATE INDEX idx_delivery_queue_status ON ap_delivery_queue(status);
CREATE INDEX idx_delivery_queue_next_attempt ON ap_delivery_queue(next_attempt_at);
