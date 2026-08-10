CREATE TABLE stamp_packs (
  id TEXT PRIMARY KEY NOT NULL,
  publisher_actor_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name_json TEXT NOT NULL,
  description_json TEXT,
  icon_url TEXT,
  current_release_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'unlisted', 'private', 'community')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'suspended', 'deleted')),
  license TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX stamp_packs_publisher_slug_idx
  ON stamp_packs (publisher_actor_id, slug);
CREATE INDEX stamp_packs_status_visibility_updated_idx
  ON stamp_packs (status, visibility, updated_at);

CREATE TABLE stamp_pack_releases (
  id TEXT PRIMARY KEY NOT NULL,
  pack_id TEXT NOT NULL,
  release_number INTEGER NOT NULL CHECK (release_number > 0),
  manifest_sha256 TEXT NOT NULL,
  published_at TEXT NOT NULL
);

CREATE UNIQUE INDEX stamp_pack_releases_pack_number_idx
  ON stamp_pack_releases (pack_id, release_number);
CREATE INDEX stamp_pack_releases_pack_published_idx
  ON stamp_pack_releases (pack_id, published_at);

CREATE TABLE stamps (
  id TEXT PRIMARY KEY NOT NULL,
  pack_id TEXT NOT NULL,
  stamp_key TEXT NOT NULL,
  current_revision_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
);

CREATE UNIQUE INDEX stamps_pack_key_idx ON stamps (pack_id, stamp_key);
CREATE INDEX stamps_pack_enabled_sort_idx
  ON stamps (pack_id, enabled, sort_order);

CREATE TABLE stamp_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  stamp_id TEXT NOT NULL,
  revision_digest TEXT NOT NULL,
  asset_url TEXT NOT NULL,
  asset_r2_key TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/webp', 'image/png')),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 512),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 512),
  asset_sha256 TEXT NOT NULL,
  alt_json TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  animated INTEGER NOT NULL DEFAULT 0 CHECK (animated = 0),
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX stamp_revisions_stamp_digest_idx
  ON stamp_revisions (stamp_id, revision_digest);
CREATE INDEX stamp_revisions_asset_sha_idx
  ON stamp_revisions (asset_sha256);

CREATE TABLE stamp_release_items (
  release_id TEXT NOT NULL,
  stamp_id TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (release_id, stamp_id)
);

CREATE UNIQUE INDEX stamp_release_items_release_order_idx
  ON stamp_release_items (release_id, sort_order, stamp_id);
CREATE INDEX stamp_release_items_revision_idx
  ON stamp_release_items (revision_id);

CREATE TABLE stamp_entitlements (
  actor_ap_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  can_install INTEGER NOT NULL DEFAULT 0 CHECK (can_install IN (0, 1)),
  can_send INTEGER NOT NULL DEFAULT 0 CHECK (can_send IN (0, 1)),
  source TEXT NOT NULL
    CHECK (source IN ('free', 'purchase', 'gift', 'community', 'admin', 'bundled')),
  issuer TEXT,
  external_grant_id TEXT,
  granted_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  PRIMARY KEY (actor_ap_id, pack_id)
);

CREATE INDEX stamp_entitlements_actor_send_idx
  ON stamp_entitlements (actor_ap_id, can_send, revoked_at, expires_at);
CREATE INDEX stamp_entitlements_external_grant_idx
  ON stamp_entitlements (issuer, external_grant_id);

CREATE TABLE stamp_installations (
  actor_ap_id TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  installed_release_id TEXT NOT NULL,
  auto_update INTEGER NOT NULL DEFAULT 1 CHECK (auto_update IN (0, 1)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  installed_at TEXT NOT NULL,
  updated_at TEXT,
  PRIMARY KEY (actor_ap_id, pack_id)
);

CREATE INDEX stamp_installations_actor_sort_idx
  ON stamp_installations (actor_ap_id, sort_order, installed_at);

CREATE TABLE stamp_favorites (
  actor_ap_id TEXT NOT NULL,
  stamp_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (actor_ap_id, stamp_id)
);

CREATE INDEX stamp_favorites_actor_created_idx
  ON stamp_favorites (actor_ap_id, created_at);

CREATE TABLE stamp_recents (
  actor_ap_id TEXT NOT NULL,
  stamp_id TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  use_count INTEGER NOT NULL DEFAULT 1 CHECK (use_count > 0),
  PRIMARY KEY (actor_ap_id, stamp_id)
);

CREATE INDEX stamp_recents_actor_used_idx
  ON stamp_recents (actor_ap_id, last_used_at);

CREATE TABLE message_stamp_refs (
  message_id TEXT PRIMARY KEY NOT NULL,
  stamp_uri TEXT NOT NULL,
  pack_uri TEXT NOT NULL,
  revision_id TEXT,
  revision_digest TEXT NOT NULL,
  remote_asset_url TEXT,
  local_asset_r2_key TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/webp', 'image/png')),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 512),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 512),
  asset_sha256 TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX message_stamp_refs_pack_idx ON message_stamp_refs (pack_uri);
CREATE INDEX message_stamp_refs_asset_sha_idx
  ON message_stamp_refs (asset_sha256);

CREATE TABLE stamp_asset_mirrors (
  asset_sha256 TEXT NOT NULL,
  remote_asset_url TEXT NOT NULL,
  local_asset_r2_key TEXT,
  media_type TEXT NOT NULL CHECK (media_type IN ('image/webp', 'image/png')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'fetching', 'ready', 'failed', 'blocked')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error TEXT,
  next_attempt_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (asset_sha256, remote_asset_url)
);

CREATE INDEX stamp_asset_mirrors_status_next_idx
  ON stamp_asset_mirrors (status, next_attempt_at);

CREATE TABLE remote_stamp_pack_cache (
  pack_id TEXT PRIMARY KEY NOT NULL,
  manifest_url TEXT NOT NULL,
  etag TEXT,
  manifest_sha256 TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX remote_stamp_pack_cache_checked_idx
  ON remote_stamp_pack_cache (checked_at);
