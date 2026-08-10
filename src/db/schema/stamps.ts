/**
 * Stamp packs, immutable releases/revisions, Actor-scoped picker state, and
 * the snapshot owned by a sent Message.
 */

import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowIso } from "./date-utils.ts";

export const stampPacks = sqliteTable(
  "stamp_packs",
  {
    id: text("id").primaryKey(),
    publisherActorId: text("publisher_actor_id").notNull(),
    slug: text("slug").notNull(),
    nameJson: text("name_json").notNull(),
    descriptionJson: text("description_json"),
    iconUrl: text("icon_url"),
    currentReleaseId: text("current_release_id"),
    visibility: text("visibility").notNull().default("public"),
    status: text("status").notNull().default("draft"),
    license: text("license"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("stamp_packs_publisher_slug_idx").on(
      t.publisherActorId,
      t.slug,
    ),
    index("stamp_packs_status_visibility_updated_idx").on(
      t.status,
      t.visibility,
      t.updatedAt,
    ),
  ],
);

export const stampPackReleases = sqliteTable(
  "stamp_pack_releases",
  {
    id: text("id").primaryKey(),
    packId: text("pack_id").notNull(),
    releaseNumber: integer("release_number").notNull(),
    manifestSha256: text("manifest_sha256").notNull(),
    publishedAt: text("published_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("stamp_pack_releases_pack_number_idx").on(
      t.packId,
      t.releaseNumber,
    ),
    index("stamp_pack_releases_pack_published_idx").on(t.packId, t.publishedAt),
  ],
);

export const stamps = sqliteTable(
  "stamps",
  {
    id: text("id").primaryKey(),
    packId: text("pack_id").notNull(),
    key: text("stamp_key").notNull(),
    currentRevisionId: text("current_revision_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  },
  (t) => [
    uniqueIndex("stamps_pack_key_idx").on(t.packId, t.key),
    index("stamps_pack_enabled_sort_idx").on(t.packId, t.enabled, t.sortOrder),
  ],
);

export const stampRevisions = sqliteTable(
  "stamp_revisions",
  {
    id: text("id").primaryKey(),
    stampId: text("stamp_id").notNull(),
    revisionDigest: text("revision_digest").notNull(),
    assetUrl: text("asset_url").notNull(),
    assetR2Key: text("asset_r2_key"),
    mediaType: text("media_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    assetSha256: text("asset_sha256").notNull(),
    altJson: text("alt_json").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    animated: integer("animated", { mode: "boolean" }).notNull().default(false),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    uniqueIndex("stamp_revisions_stamp_digest_idx").on(
      t.stampId,
      t.revisionDigest,
    ),
    index("stamp_revisions_asset_sha_idx").on(t.assetSha256),
  ],
);

export const stampReleaseItems = sqliteTable(
  "stamp_release_items",
  {
    releaseId: text("release_id").notNull(),
    stampId: text("stamp_id").notNull(),
    revisionId: text("revision_id").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.releaseId, t.stampId] }),
    uniqueIndex("stamp_release_items_release_order_idx").on(
      t.releaseId,
      t.sortOrder,
      t.stampId,
    ),
    index("stamp_release_items_revision_idx").on(t.revisionId),
  ],
);

export const stampEntitlements = sqliteTable(
  "stamp_entitlements",
  {
    actorApId: text("actor_ap_id").notNull(),
    packId: text("pack_id").notNull(),
    canInstall: integer("can_install", { mode: "boolean" })
      .notNull()
      .default(false),
    canSend: integer("can_send", { mode: "boolean" }).notNull().default(false),
    source: text("source").notNull(),
    issuer: text("issuer"),
    externalGrantId: text("external_grant_id"),
    grantedAt: text("granted_at").notNull().$defaultFn(nowIso),
    expiresAt: text("expires_at"),
    revokedAt: text("revoked_at"),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.packId] }),
    index("stamp_entitlements_actor_send_idx").on(
      t.actorApId,
      t.canSend,
      t.revokedAt,
      t.expiresAt,
    ),
    index("stamp_entitlements_external_grant_idx").on(
      t.issuer,
      t.externalGrantId,
    ),
  ],
);

export const stampInstallations = sqliteTable(
  "stamp_installations",
  {
    actorApId: text("actor_ap_id").notNull(),
    packId: text("pack_id").notNull(),
    installedReleaseId: text("installed_release_id").notNull(),
    autoUpdate: integer("auto_update", { mode: "boolean" })
      .notNull()
      .default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    installedAt: text("installed_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at"),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.packId] }),
    index("stamp_installations_actor_sort_idx").on(
      t.actorApId,
      t.sortOrder,
      t.installedAt,
    ),
  ],
);

export const stampFavorites = sqliteTable(
  "stamp_favorites",
  {
    actorApId: text("actor_ap_id").notNull(),
    stampId: text("stamp_id").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.stampId] }),
    index("stamp_favorites_actor_created_idx").on(t.actorApId, t.createdAt),
  ],
);

export const stampRecents = sqliteTable(
  "stamp_recents",
  {
    actorApId: text("actor_ap_id").notNull(),
    stampId: text("stamp_id").notNull(),
    lastUsedAt: text("last_used_at").notNull().$defaultFn(nowIso),
    useCount: integer("use_count").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.actorApId, t.stampId] }),
    index("stamp_recents_actor_used_idx").on(t.actorApId, t.lastUsedAt),
  ],
);

export const messageStampRefs = sqliteTable(
  "message_stamp_refs",
  {
    messageId: text("message_id").primaryKey(),
    stampUri: text("stamp_uri").notNull(),
    packUri: text("pack_uri").notNull(),
    revisionId: text("revision_id"),
    revisionDigest: text("revision_digest").notNull(),
    remoteAssetUrl: text("remote_asset_url"),
    localAssetR2Key: text("local_asset_r2_key"),
    mediaType: text("media_type").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    assetSha256: text("asset_sha256").notNull(),
    altText: text("alt_text").notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    index("message_stamp_refs_pack_idx").on(t.packUri),
    index("message_stamp_refs_asset_sha_idx").on(t.assetSha256),
  ],
);

export const stampAssetMirrors = sqliteTable(
  "stamp_asset_mirrors",
  {
    assetSha256: text("asset_sha256").notNull(),
    remoteAssetUrl: text("remote_asset_url").notNull(),
    localAssetR2Key: text("local_asset_r2_key"),
    mediaType: text("media_type").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    nextAttemptAt: text("next_attempt_at"),
    verifiedAt: text("verified_at"),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.assetSha256, t.remoteAssetUrl] }),
    index("stamp_asset_mirrors_status_next_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const remoteStampPackCache = sqliteTable(
  "remote_stamp_pack_cache",
  {
    packId: text("pack_id").primaryKey(),
    manifestUrl: text("manifest_url").notNull(),
    etag: text("etag"),
    manifestSha256: text("manifest_sha256").notNull(),
    checkedAt: text("checked_at").notNull().$defaultFn(nowIso),
    createdAt: text("created_at").notNull().$defaultFn(nowIso),
    updatedAt: text("updated_at").notNull().$defaultFn(nowIso),
  },
  (t) => [index("remote_stamp_pack_cache_checked_idx").on(t.checkedAt)],
);
