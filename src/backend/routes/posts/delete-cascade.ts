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

import { and, eq, inArray, ne, sql } from "drizzle-orm";
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

// Escape SQLite LIKE metacharacters so an r2_key containing `%`/`_`/`\` is
// matched literally (mirrors the helper in media.ts / search.ts).
function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

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
 *
 * A blob is only purged when its `r2_key` is no longer referenced by any OTHER
 * still-present object of the same author (an `r2_key`/media URL can be embedded
 * in more than one object's `attachments_json` even though the `media_uploads`
 * row is unique). Deleting the blob while another object still shows it would
 * data-loss the shared media, so the R2 delete is gated on the reference count
 * dropping to zero. The DB-row delete is unconditional (the reaped rows belong
 * to this object's reap set regardless).
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

  // Before any R2 purge, find which of these `r2_key`s are still referenced by
  // ANOTHER (different `ap_id`), still-present object of the same author. Such
  // a key must NOT have its blob deleted — another object still shows it. We
  // run this read while the rows are still present so an OTHER object whose
  // `attachments_json` happens to point back at this object's reap set is
  // honoured; the lookup is scoped to the author's own objects (indexed) and
  // excludes the object being reaped.
  const stillReferencedKeys = new Set<string>();
  if (media) {
    // For each orphaned key, ask SQL (escaped LIKE, indexed by attributedTo)
    // whether ANOTHER present object of this author still references it — instead
    // of loading EVERY other object's attachmentsJson into memory and substring-
    // scanning them all (O(objects × keys), unbounded for a prolific author).
    // `orphaned` is only this object's own attachments (a handful), so this is a
    // small, bounded set of indexed lookups. Mirrors media.ts findReferencingObject.
    for (const m of orphaned) {
      const keyLike = `%${escapeLike(m.r2Key)}%`;
      const ref = await db
        .select({ apId: objects.apId })
        .from(objects)
        .where(
          and(
            eq(objects.attributedTo, obj.attributedTo),
            ne(objects.apId, objectApId),
            sql`${objects.attachmentsJson} LIKE ${keyLike} ESCAPE '\\'`,
          ),
        )
        .get();
      if (ref) stillReferencedKeys.add(m.r2Key);
    }
  }

  // Delete the media_uploads rows whose blob we are actually purging. Rows
  // whose `r2_key` is still referenced by another present object are KEPT (row
  // AND blob) so that, when that final referencer is later deleted, this same
  // candidates scan still finds the row and can GC the now-orphaned blob —
  // otherwise the shared blob would leak permanently once its DB row vanished.
  // Without a `media` binding there is no R2 to GC, so all rows are removed.
  const idsToDelete = media
    ? orphaned.filter((m) => !stillReferencedKeys.has(m.r2Key)).map((m) => m.id)
    : orphaned.map((m) => m.id);
  if (idsToDelete.length > 0) {
    await db.delete(mediaUploads).where(inArray(mediaUploads.id, idsToDelete));
  }

  // Best-effort purge the backing R2 blobs so storage does not leak. Never let
  // an R2 error fail the delete. Only purge keys whose reference count has
  // dropped to zero — keys still embedded in another present object's
  // `attachments_json` are kept (blob + media_uploads row) so shared media is
  // not lost and can still be GC'd when the last referencer is removed.
  if (media) {
    const keys = orphaned
      .map((m) => m.r2Key)
      .filter((k) => !stillReferencedKeys.has(k));
    if (keys.length > 0) {
      try {
        await media.delete(keys);
      } catch {
        // Swallow: storage purge is best-effort and must not fail the DB delete.
      }
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
