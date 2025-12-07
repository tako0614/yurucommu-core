-- takos v1.8 base schema (actors/objects centric)

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS actors;
CREATE TABLE actors (
  id TEXT PRIMARY KEY,
  local_id TEXT UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  display_name TEXT,
  summary TEXT,
  avatar_url TEXT,
  header_url TEXT,
  inbox TEXT,
  outbox TEXT,
  followers TEXT,
  following TEXT,
  public_key TEXT,
  private_key TEXT,
  is_local INTEGER DEFAULT 1,
  is_bot INTEGER DEFAULT 0,
  manually_approves_followers INTEGER DEFAULT 0,
  owner_id TEXT,
  visibility TEXT DEFAULT 'public',
  profile_completed_at TEXT,
  jwt_secret TEXT,
  metadata_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT,
  FOREIGN KEY (owner_id) REFERENCES actors(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX idx_actors_type ON actors(type);
CREATE INDEX idx_actors_is_local ON actors(is_local);

DROP TABLE IF EXISTS follows;
CREATE TABLE follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (following_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_follows_status ON follows(status);

DROP TABLE IF EXISTS blocks;
CREATE TABLE blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS mutes;
CREATE TABLE mutes (
  muter_id TEXT NOT NULL,
  muted_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (muter_id, muted_id),
  FOREIGN KEY (muter_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (muted_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS channels;
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'text',
  position INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_channels_actor_id ON channels(actor_id);

DROP TABLE IF EXISTS actor_roles;
CREATE TABLE actor_roles (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(actor_id, member_id),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (member_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS memberships;
CREATE TABLE memberships (
  community_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  status TEXT DEFAULT 'active',
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id, actor_id),
  FOREIGN KEY (community_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS invites;
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  expires_at TEXT,
  created_by TEXT NOT NULL,
  max_uses INTEGER DEFAULT 0,
  uses INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (community_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (created_by) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_invites_community ON invites(community_id);
CREATE INDEX idx_invites_creator ON invites(created_by);

DROP TABLE IF EXISTS member_invites;
CREATE TABLE member_invites (
  id TEXT PRIMARY KEY,
  community_id TEXT NOT NULL,
  invited_actor_id TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (community_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (invited_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (invited_by) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_member_invites_community ON member_invites(community_id);
CREATE INDEX idx_member_invites_target ON member_invites(invited_actor_id);

DROP TABLE IF EXISTS lists;
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_public INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_lists_owner_id ON lists(owner_id);

DROP TABLE IF EXISTS list_members;
CREATE TABLE list_members (
  list_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  added_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (list_id, actor_id),
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS user_accounts;
CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  password_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(provider, provider_account_id),
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_user_accounts_actor ON user_accounts(actor_id);

DROP TABLE IF EXISTS objects;
CREATE TABLE objects (
  id TEXT PRIMARY KEY,
  local_id TEXT UNIQUE,
  type TEXT NOT NULL,
  actor TEXT NOT NULL,
  published TEXT,
  updated TEXT,
  to JSON,
  cc JSON,
  bto JSON,
  bcc JSON,
  context TEXT,
  in_reply_to TEXT,
  content JSON NOT NULL,
  is_local INTEGER DEFAULT 1,
  visibility TEXT,
  deleted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  object_ref TEXT GENERATED ALWAYS AS (json_extract(content, '$.object')) VIRTUAL,
  in_reply_to_ref TEXT GENERATED ALWAYS AS (json_extract(content, '$.inReplyTo')) VIRTUAL
);
CREATE INDEX idx_objects_type ON objects(type);
CREATE INDEX idx_objects_actor ON objects(actor);
CREATE INDEX idx_objects_published ON objects(published DESC);
CREATE INDEX idx_objects_context ON objects(context);
CREATE INDEX idx_objects_in_reply_to ON objects(in_reply_to);
CREATE INDEX idx_objects_visibility ON objects(visibility);
CREATE INDEX idx_objects_is_local ON objects(is_local);
CREATE INDEX idx_objects_deleted_at ON objects(deleted_at);
CREATE INDEX idx_objects_object_ref ON objects(object_ref);
CREATE INDEX idx_objects_type_object ON objects(type, object_ref);
CREATE INDEX idx_objects_reply_to ON objects(in_reply_to_ref);
CREATE INDEX idx_objects_visibility_published ON objects(visibility, published);

DROP TABLE IF EXISTS object_recipients;
CREATE TABLE object_recipients (
  object_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  recipient_type TEXT NOT NULL,
  PRIMARY KEY (object_id, recipient, recipient_type),
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_object_recipients_recipient ON object_recipients(recipient);

DROP TABLE IF EXISTS object_bookmarks;
CREATE TABLE object_bookmarks (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(object_id, actor_id),
  FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_object_bookmarks_actor ON object_bookmarks(actor_id, created_at);

DROP TABLE IF EXISTS post_plans;
CREATE TABLE post_plans (
  id TEXT PRIMARY KEY,
  author_id TEXT NOT NULL,
  community_id TEXT,
  type TEXT NOT NULL,
  content_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  object_id TEXT,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (community_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_post_plans_status_schedule ON post_plans(status, scheduled_at);

DROP TABLE IF EXISTS notifications;
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL,
  type TEXT NOT NULL,
  actor_id TEXT,
  object_id TEXT,
  ref_type TEXT,
  ref_id TEXT,
  message TEXT DEFAULT '',
  data_json TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  read INTEGER DEFAULT 0,
  FOREIGN KEY (recipient_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX idx_notifications_recipient ON notifications(recipient_id);
CREATE INDEX idx_notifications_actor ON notifications(actor_id);
CREATE INDEX idx_notifications_object ON notifications(object_id);

DROP TABLE IF EXISTS media;
CREATE TABLE media (
  key TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT DEFAULT '',
  content_type TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_media_actor ON media(actor_id);

DROP TABLE IF EXISTS data_export_requests;
CREATE TABLE data_export_requests (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  format TEXT DEFAULT 'json',
  status TEXT DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  requested_at TEXT NOT NULL,
  processed_at TEXT,
  download_url TEXT,
  result_json TEXT,
  error_message TEXT,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_export_status ON data_export_requests(status);
CREATE INDEX idx_export_actor ON data_export_requests(actor_id, requested_at);

DROP TABLE IF EXISTS push_devices;
CREATE TABLE push_devices (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  device_name TEXT DEFAULT '',
  locale TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_push_devices_actor ON push_devices(actor_id);

DROP TABLE IF EXISTS sessions;
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_sessions_actor ON sessions(actor_id);

DROP TABLE IF EXISTS owner_password;
CREATE TABLE owner_password (
  id INTEGER PRIMARY KEY DEFAULT 1,
  password_hash TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS ap_outbox_activities;
CREATE TABLE ap_outbox_activities (
  id TEXT PRIMARY KEY,
  local_actor_id TEXT NOT NULL,
  activity_id TEXT NOT NULL UNIQUE,
  activity_type TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  object_id TEXT,
  object_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (local_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_ap_outbox_actor ON ap_outbox_activities(local_actor_id);
CREATE INDEX idx_ap_outbox_created ON ap_outbox_activities(created_at);

DROP TABLE IF EXISTS ap_follows;
CREATE TABLE ap_follows (
  id TEXT PRIMARY KEY,
  local_actor_id TEXT NOT NULL,
  remote_actor_id TEXT NOT NULL,
  activity_id TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  UNIQUE(local_actor_id, remote_actor_id),
  FOREIGN KEY (local_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (remote_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_ap_follows_local ON ap_follows(local_actor_id);
CREATE INDEX idx_ap_follows_remote ON ap_follows(remote_actor_id);

DROP TABLE IF EXISTS ap_followers;
CREATE TABLE ap_followers (
  id TEXT PRIMARY KEY,
  local_actor_id TEXT NOT NULL,
  remote_actor_id TEXT NOT NULL,
  activity_id TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL,
  accepted_at TEXT,
  UNIQUE(local_actor_id, remote_actor_id),
  FOREIGN KEY (local_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (remote_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_ap_followers_local ON ap_followers(local_actor_id);
CREATE INDEX idx_ap_followers_remote ON ap_followers(remote_actor_id);

DROP TABLE IF EXISTS ap_rate_limits;
CREATE TABLE ap_rate_limits (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_ap_rate_limits_key_window ON ap_rate_limits(key, window_start);

DROP TABLE IF EXISTS ap_inbox_activities;
CREATE TABLE ap_inbox_activities (
  id TEXT PRIMARY KEY,
  local_actor_id TEXT NOT NULL,
  remote_actor_id TEXT,
  activity_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  activity_json TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  UNIQUE(local_actor_id, activity_id),
  FOREIGN KEY (local_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (remote_actor_id) REFERENCES actors(id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX idx_ap_inbox_actor ON ap_inbox_activities(local_actor_id);
CREATE INDEX idx_ap_inbox_status ON ap_inbox_activities(status);
CREATE INDEX idx_ap_inbox_activity ON ap_inbox_activities(activity_id);

DROP TABLE IF EXISTS ap_delivery_queue;
CREATE TABLE ap_delivery_queue (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  target_inbox_url TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  status TEXT DEFAULT 'pending',
  last_attempt_at TEXT,
  next_attempt_at TEXT,
  error_message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  retry_count INTEGER DEFAULT 0,
  delivered_at TEXT,
  last_error TEXT,
  UNIQUE(activity_id, target_inbox_url)
);
CREATE INDEX idx_ap_delivery_status ON ap_delivery_queue(status);
CREATE INDEX idx_ap_delivery_next ON ap_delivery_queue(next_attempt_at);

DROP TABLE IF EXISTS ap_keypairs;
CREATE TABLE ap_keypairs (
  actor_id TEXT PRIMARY KEY,
  public_key_pem TEXT NOT NULL,
  private_key_pem TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS ap_instances;
CREATE TABLE ap_instances (
  domain TEXT PRIMARY KEY,
  software TEXT,
  version TEXT,
  last_checked_at TEXT NOT NULL
);

DROP TABLE IF EXISTS reports;
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  reporter_actor_id TEXT NOT NULL,
  target_actor_id TEXT NOT NULL,
  target_object_id TEXT,
  reason TEXT,
  category TEXT DEFAULT 'other',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (target_actor_id) REFERENCES actors(id) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX idx_reports_status ON reports(status);
CREATE INDEX idx_reports_target ON reports(target_actor_id);

DROP TABLE IF EXISTS app_revisions;
CREATE TABLE app_revisions (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  author_type TEXT NOT NULL,
  author_name TEXT,
  message TEXT,
  schema_version TEXT NOT NULL,
  manifest_snapshot TEXT NOT NULL,
  script_snapshot_ref TEXT NOT NULL
);

DROP TABLE IF EXISTS app_state;
CREATE TABLE app_state (
  id INTEGER PRIMARY KEY DEFAULT 1,
  active_revision_id TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (active_revision_id) REFERENCES app_revisions(id) ON DELETE SET NULL ON UPDATE CASCADE
);

DROP TABLE IF EXISTS app_workspaces;
CREATE TABLE app_workspaces (
  id TEXT PRIMARY KEY,
  base_revision_id TEXT,
  status TEXT DEFAULT 'draft',
  author_type TEXT NOT NULL,
  author_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (base_revision_id) REFERENCES app_revisions(id) ON DELETE SET NULL ON UPDATE CASCADE
);

DROP TABLE IF EXISTS app_workspace_files;
CREATE TABLE app_workspace_files (
  workspace_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content BLOB,
  content_type TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (workspace_id, path),
  FOREIGN KEY (workspace_id) REFERENCES app_workspaces(id) ON DELETE CASCADE ON UPDATE CASCADE
);

DROP TABLE IF EXISTS app_debug_logs;
CREATE TABLE app_debug_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  mode TEXT NOT NULL,
  workspace_id TEXT,
  run_id TEXT NOT NULL,
  handler TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT
);
CREATE INDEX app_debug_logs_timestamp_idx ON app_debug_logs(timestamp);
CREATE INDEX app_debug_logs_workspace_idx ON app_debug_logs(workspace_id);
CREATE INDEX app_debug_logs_handler_idx ON app_debug_logs(handler);

DROP TABLE IF EXISTS ai_config;
CREATE TABLE ai_config (
  id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

DROP TABLE IF EXISTS ai_proposals;
CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  content_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_comment TEXT
);
CREATE INDEX idx_ai_proposals_status ON ai_proposals(status);
CREATE INDEX idx_ai_proposals_type ON ai_proposals(type);
CREATE INDEX idx_ai_proposals_created ON ai_proposals(created_at);
CREATE INDEX idx_ai_proposals_expires ON ai_proposals(expires_at);
