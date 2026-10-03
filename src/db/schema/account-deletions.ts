/** Durable local actor deletion ownership and write-fence witnesses. */

import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { nowIsoUtc } from "./date-utils.ts";

/** A lease transfers the worker; the row itself reserves the root until final commit. */
export const accountDeletions = sqliteTable(
  "account_deletions",
  {
    id: text("id").primaryKey(),
    rootActorApId: text("root_actor_ap_id").notNull(),
    rootPublicKeyPem: text("root_public_key_pem").notNull(),
    workerToken: text("worker_token").notNull(),
    leaseExpiresAt: text("lease_expires_at").notNull(),
  },
  (t) => [uniqueIndex("account_deletions_root_idx").on(t.rootActorApId)],
);

/** Snapshot every local identity and its stable outbound Delete intent before teardown. */
export const accountDeletionTargets = sqliteTable(
  "account_deletion_targets",
  {
    actorApId: text("actor_ap_id").primaryKey(),
    operationId: text("operation_id").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    followersUrl: text("followers_url").notNull(),
    deleteActivityApId: text("delete_activity_ap_id").notNull(),
    cascadeComplete: integer("cascade_complete", { mode: "boolean" })
      .notNull()
      .default(false),
  },
  (t) => [index("account_deletion_targets_operation_idx").on(t.operationId)],
);

/** Snapshot authored object IDs so indirect writes remain fenced after hard deletion. */
export const accountDeletionObjectTargets = sqliteTable(
  "account_deletion_object_targets",
  {
    objectApId: text("object_ap_id").primaryKey(),
    operationId: text("operation_id").notNull(),
  },
  (t) => [
    index("account_deletion_object_targets_operation_idx").on(t.operationId),
  ],
);

/** Preserve the blob key before its external put can start. */
export const mediaUploadAttempts = sqliteTable(
  "media_upload_attempts",
  {
    id: text("id").primaryKey(),
    r2Key: text("r2_key").notNull(),
    uploaderApId: text("uploader_ap_id").notNull(),
    publicKeyPem: text("public_key_pem").notNull(),
    phase: text("phase", { enum: ["putting", "cleanup"] }).notNull(),
    createdAt: text("created_at").notNull().$defaultFn(nowIsoUtc),
  },
  (t) => [
    uniqueIndex("media_upload_attempts_r2_key_idx").on(t.r2Key),
    index("media_upload_attempts_uploader_idx").on(t.uploaderApId),
  ],
);

/**
 * An assertion row exists only inside an atomic write batch. Its NOT NULL
 * witness is a failing statement when the expected operation/lease is stale.
 */
export const actorWriteAssertions = sqliteTable("actor_write_assertions", {
  id: text("id").primaryKey(),
  witness: integer("witness").notNull(),
  operationId: text("operation_id"),
});
