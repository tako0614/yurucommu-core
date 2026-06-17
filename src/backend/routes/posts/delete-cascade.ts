/**
 * Shared object-delete cascade.
 *
 * Migrations declare `ON DELETE CASCADE` on the object's interaction/edge
 * tables (likes, announces, bookmarks, object_recipients, story_views,
 * story_votes, story_shares), but SQLite enforces foreign keys only when
 * `PRAGMA foreign_keys = ON` is set on the connection — which is NOT reliably
 * the case on every runtime/connection (D1 does not honour it, and the libsql
 * connection is not guaranteed to have it). Deleting an object row therefore
 * orphans those child rows on at least some runtimes.
 *
 * This helper deletes every child row keyed by `objectApId` deterministically,
 * independent of FK enforcement, so the data stays consistent on all runtimes.
 * It does NOT delete the `objects` row itself — callers do that (and own any
 * counter/fanout side effects) — and it intentionally leaves `activities`
 * alone, whose `object_ap_id` is `ON DELETE SET NULL`, not CASCADE.
 *
 * Used by BOTH the local post-delete path (routes.ts `DELETE /posts/:id`) and
 * the remote `handleDelete` inbox path so neither can orphan rows.
 */

import { eq, inArray } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  announces,
  bookmarks,
  likes,
  mediaUploads,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";

/**
 * Reap the `media_uploads` rows attached to a single object.
 *
 * `media_uploads` has no FK column to `objects` — the link is the same one the
 * media auth path uses (`routes/media.ts`): an object references its uploads by
 * embedding the media URL / `r2_key` in `attachments_json`, and each upload is
 * the unique, indexed `r2_key` (`media_uploads_r2_key_idx`) owned by the
 * object's author (`uploader_ap_id`, `media_uploads_uploader_idx`). So we scan
 * the author's uploads (indexed equality) and delete the ones whose `r2_key` is
 * substring-referenced in this object's `attachments_json`, mirroring the
 * `attachmentMatches` semantics. There is no engine-level CASCADE for this edge,
 * so without this the upload rows orphan on every runtime.
 *
 * Returns silently when the object row is already gone (caller may delete the
 * object before or after calling this) or has no attachments.
 */
async function deleteAttachedMediaUploads(
  db: Database,
  objectApId: string,
): Promise<void> {
  const obj = await db
    .select({
      attributedTo: objects.attributedTo,
      attachmentsJson: objects.attachmentsJson,
    })
    .from(objects)
    .where(eq(objects.apId, objectApId))
    .get();

  // No object row (already deleted) or no attachment payload: nothing to reap.
  if (!obj || !obj.attachmentsJson || obj.attachmentsJson === "[]") return;

  const attachmentsJson = obj.attachmentsJson;

  // Indexed scan over the author's own uploads, then substring-match the upload
  // identity (r2_key) against the object's attachment payload.
  const candidates = await db
    .select({ id: mediaUploads.id, r2Key: mediaUploads.r2Key })
    .from(mediaUploads)
    .where(eq(mediaUploads.uploaderApId, obj.attributedTo));

  const orphanedIds = candidates
    .filter((m) => attachmentsJson.includes(m.r2Key))
    .map((m) => m.id);

  if (orphanedIds.length === 0) return;

  await db.delete(mediaUploads).where(inArray(mediaUploads.id, orphanedIds));
}

/**
 * Delete all child rows that reference `objectApId` (the object's `ap_id`).
 *
 * Mirrors the `ON DELETE CASCADE` edges declared in the migrations:
 *   likes, announces, bookmarks, object_recipients,
 *   story_views, story_votes, story_shares.
 *
 * Also reaps the object-attached `media_uploads` rows, which have no FK to
 * `objects` and would otherwise orphan (see `deleteAttachedMediaUploads`).
 *
 * Does not touch the `objects` row or `activities` (SET NULL, not CASCADE).
 */
export async function deleteObjectCascade(
  db: Database,
  objectApId: string,
): Promise<void> {
  // Reap attached media first, while the object row (and its attachments_json)
  // is still readable — the caller may delete the object row afterwards.
  await deleteAttachedMediaUploads(db, objectApId);
  await db.delete(likes).where(eq(likes.objectApId, objectApId));
  await db.delete(announces).where(eq(announces.objectApId, objectApId));
  await db.delete(bookmarks).where(eq(bookmarks.objectApId, objectApId));
  await db
    .delete(objectRecipients)
    .where(eq(objectRecipients.objectApId, objectApId));
  await db.delete(storyViews).where(eq(storyViews.storyApId, objectApId));
  await db.delete(storyVotes).where(eq(storyVotes.storyApId, objectApId));
  await db.delete(storyShares).where(eq(storyShares.storyApId, objectApId));
}
