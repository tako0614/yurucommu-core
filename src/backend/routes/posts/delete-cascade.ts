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
import type { IObjectStorage } from "../../runtime/types.ts";
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
 *
 * When a `media` object-store binding is provided, the backing R2 blobs for the
 * reaped uploads are best-effort deleted by `r2_key` (mirroring the
 * account-delete teardown in `routes/actors.ts`). R2 errors never fail the DB
 * delete; without this the blobs leak forever (there is no orphaned-key GC).
 */
async function deleteAttachedMediaUploads(
  db: Database,
  objectApId: string,
  media?: IObjectStorage,
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

  const orphaned = candidates.filter((m) => attachmentsJson.includes(m.r2Key));

  if (orphaned.length === 0) return;

  const orphanedIds = orphaned.map((m) => m.id);

  await db.delete(mediaUploads).where(inArray(mediaUploads.id, orphanedIds));

  // Best-effort purge the backing R2 blobs so storage does not leak. The DB
  // rows are already gone regardless of object-store availability; never let an
  // R2 error fail the delete (there is no orphaned-key GC fallback).
  if (media) {
    const keys = orphaned.map((m) => m.r2Key);
    try {
      await media.delete(keys);
    } catch {
      // Swallow: storage purge is best-effort and must not fail the DB delete.
    }
  }
}

/**
 * Delete all child rows that reference `objectApId` (the object's `ap_id`).
 *
 * Mirrors the `ON DELETE CASCADE` edges declared in the migrations:
 *   likes, announces, bookmarks, object_recipients,
 *   story_views, story_votes, story_shares.
 *
 * Also reaps the object-attached `media_uploads` rows, which have no FK to
 * `objects` and would otherwise orphan (see `deleteAttachedMediaUploads`). When
 * a `media` binding is passed, the backing R2 blobs are best-effort deleted too
 * so storage does not leak; pass `c.env.MEDIA` from the request context.
 *
 * Does not touch the `objects` row or `activities` (SET NULL, not CASCADE).
 */
export async function deleteObjectCascade(
  db: Database,
  objectApId: string,
  media?: IObjectStorage,
): Promise<void> {
  // Reap attached media first, while the object row (and its attachments_json)
  // is still readable — the caller may delete the object row afterwards.
  await deleteAttachedMediaUploads(db, objectApId, media);
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
